import type { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `withTransaction` (src/config/database.ts) crea el Pool real de `pg` al
// importarse. Mockeamos el módulo `pg` para controlar qué cliente entrega
// `pool.connect()`, y así probar la implementación REAL de withTransaction
// (BEGIN/COMMIT/ROLLBACK/release) sin necesitar una base de datos.
// vi.mock se "hoistea" por encima de todo el archivo, así que `connect`
// tiene que crearse dentro de vi.hoisted para existir cuando el factory corre.
const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('pg', () => ({
  // Debe ser una `function` (no arrow function): se invoca con `new Pool(...)`
  // y una arrow function no puede usarse como constructor.
  Pool: vi.fn().mockImplementation(function FakePool() {
    return { connect, on: vi.fn() };
  }),
}));

import { withTransaction } from '../../src/config/database';
import { executeBuy } from '../../src/services/transaction.service';

interface Balance {
  id: string;
  amount: string;
}

interface RecordedCall {
  sql: string;
  params: unknown[];
}

function createTrackedClient(options: {
  balances?: Record<string, Balance>;
  decimals?: Record<string, number>;
}) {
  const { balances = {}, decimals = {} } = options;
  const calls: RecordedCall[] = [];
  const release = vi.fn();

  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('FROM currencies')) {
      const code = params[0] as string;
      const d = decimals[code];
      return { rows: d === undefined ? [] : [{ decimals: d }] };
    }

    if (text.includes('FOR UPDATE')) {
      const code = params[1] as string;
      const balance = balances[code];
      return { rows: balance ? [balance] : [] };
    }

    if (text.startsWith('INSERT INTO transactions')) {
      return {
        rows: [
          {
            id: 'tx-1',
            rate_fetched_at: new Date('2026-08-06T12:00:00.000Z'),
            created_at: new Date('2026-08-06T12:00:00.000Z'),
          },
        ],
      };
    }

    return { rows: [] };
  };

  const client = { query, release } as unknown as PoolClient;
  return { client, calls, release };
}

const params = {
  walletId: 'wallet-1',
  fromCurrency: 'USD',
  toCurrency: 'ARS',
  fromAmount: new Decimal('1000'),
  exchangeRate: new Decimal('1420.50'),
  rateSource: 'frankfurter',
};

describe('withTransaction — atomicidad (todo o nada)', () => {
  beforeEach(() => {
    connect.mockReset();
  });

  it('confirma (COMMIT) débito, crédito y ledger juntos cuando la operación se completa', async () => {
    const { client, calls, release } = createTrackedClient({
      balances: {
        USD: { id: 'bal-usd', amount: '10000.00000000' },
        ARS: { id: 'bal-ars', amount: '0.00000000' },
      },
      decimals: { USD: 2 },
    });
    connect.mockResolvedValue(client);

    await withTransaction((c) => executeBuy(c, params));

    expect(calls[0].sql).toBe('BEGIN');
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(false);
    // Todo el trabajo (débito, crédito, ledger) quedó entre el BEGIN y el COMMIT.
    expect(calls.some((c) => c.sql.includes('UPDATE balances'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('transaction_entries'))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('revierte (ROLLBACK) todo si la operación falla a mitad de camino (saldo insuficiente)', async () => {
    const { client, calls, release } = createTrackedClient({
      balances: {
        USD: { id: 'bal-usd', amount: '10.00000000' }, // no alcanza para 1000
        ARS: { id: 'bal-ars', amount: '0.00000000' },
      },
      decimals: { USD: 2 },
    });
    connect.mockResolvedValue(client);

    await expect(withTransaction((c) => executeBuy(c, params))).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });

    expect(calls[0].sql).toBe('BEGIN');
    expect(calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(false);
    // Nada de balances ni ledger llegó a escribirse: "todo o nada".
    expect(calls.some((c) => c.sql.includes('UPDATE balances'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('transaction_entries'))).toBe(false);
    // El cliente siempre se libera, haya fallado o no.
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('revierte todo si falla la escritura del ledger, aun después de haber debitado y acreditado', async () => {
    const { client, release } = createTrackedClient({
      balances: {
        USD: { id: 'bal-usd', amount: '10000.00000000' },
        ARS: { id: 'bal-ars', amount: '0.00000000' },
      },
      decimals: { USD: 2 },
    });
    const calls: RecordedCall[] = [];
    const originalQuery = client.query.bind(client);
    // Simulamos que la última escritura del ledger (el crédito de destino,
    // dirección CREDIT) falla, por ejemplo por una caída de conexión a
    // mitad de la transacción.
    client.query = (async (sql: string, queryParams: unknown[] = []) => {
      calls.push({ sql, params: queryParams });
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text.includes('INSERT INTO transaction_entries') && queryParams[2] === 'CREDIT') {
        throw new Error('connection lost');
      }
      return originalQuery(sql, queryParams);
    }) as typeof client.query;
    connect.mockResolvedValue(client);

    await expect(withTransaction((c) => executeBuy(c, params))).rejects.toThrow('connection lost');

    expect(calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('actualiza los balances con aritmética directa dentro de la transacción, no recalculando desde el ledger', async () => {
    const { client, calls } = createTrackedClient({
      balances: {
        USD: { id: 'bal-usd', amount: '10000.00000000' },
        ARS: { id: 'bal-ars', amount: '0.00000000' },
      },
      decimals: { USD: 2 },
    });
    connect.mockResolvedValue(client);

    await withTransaction((c) => executeBuy(c, params));

    const balanceUpdates = calls.filter((c) => c.sql.includes('UPDATE balances'));
    expect(balanceUpdates.length).toBe(2); // débito de origen + crédito de destino

    // Ninguna actualización de balance depende de sumar/leer transaction_entries:
    // el nuevo monto se calcula en memoria (Decimal) y se escribe directo.
    for (const update of balanceUpdates) {
      expect(update.sql).not.toMatch(/transaction_entries|SUM\(/i);
      expect(update.sql).toContain('SET amount = $1');
    }
  });
});
