import type { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/utils/AppError';
import {
  debitBalance,
  executeBuy,
  executeExchange,
  executeSell,
} from '../../src/services/transaction.service';

interface Balance {
  id: string;
  amount: string;
}

interface MockClientOptions {
  balances?: Record<string, Balance>;
  decimals?: Record<string, number>;
  txId?: string;
}

interface RecordedCall {
  sql: string;
  params: unknown[];
}

/**
 * PoolClient falso: en vez de mockear módulos, aprovechamos que
 * executeBuy/Sell/Exchange reciben el `client` como parámetro (se inyecta
 * desde withTransaction). Le damos balances y decimales fijos por moneda y
 * registramos cada `query` para poder inspeccionar qué se intentó escribir.
 */
function createMockClient(options: MockClientOptions = {}) {
  const { balances = {}, decimals = {}, txId = 'tx-1' } = options;
  const calls: RecordedCall[] = [];

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
            id: txId,
            rate_fetched_at: new Date('2026-08-06T12:00:00.000Z'),
            created_at: new Date('2026-08-06T12:00:00.000Z'),
          },
        ],
      };
    }

    // UPDATE balances / INSERT INTO transaction_entries: no se lee el resultado.
    return { rows: [] };
  };

  const client = { query } as unknown as PoolClient;
  return { client, calls };
}

const WALLET_ID = 'wallet-1';

describe('transaction.service', () => {
  describe('cálculo de conversión, comisión y redondeo', () => {
    it('BUY descuenta 0.5% de comisión del origen antes de convertir (ejemplo de business-rules.md)', async () => {
      const { client } = createMockClient({
        balances: {
          USD: { id: 'bal-usd', amount: '10000.00000000' },
          ARS: { id: 'bal-ars', amount: '0.00000000' },
        },
        decimals: { USD: 2 },
      });

      const result = await executeBuy(client, {
        walletId: WALLET_ID,
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        fromAmount: new Decimal('1000'),
        exchangeRate: new Decimal('1420.50'),
        rateSource: 'frankfurter',
      });

      expect(result.transaction.feeAmount).toBe('5.00000000');
      expect(result.transaction.toAmount).toBe('1413397.50000000'); // 995 * 1420.50
      expect(result.transaction.feeRate).toBe('0.00500');
      expect(result.transaction.type).toBe('BUY');
    });

    it('SELL aplica exactamente la misma fórmula de comisión que BUY', async () => {
      const { client } = createMockClient({
        balances: {
          USD: { id: 'bal-usd', amount: '10000.00000000' },
          ARS: { id: 'bal-ars', amount: '0.00000000' },
        },
        decimals: { USD: 2 },
      });

      const result = await executeSell(client, {
        walletId: WALLET_ID,
        fromCurrency: 'USD',
        toCurrency: 'ARS',
        fromAmount: new Decimal('1000'),
        exchangeRate: new Decimal('1420.50'),
        rateSource: 'frankfurter',
      });

      expect(result.transaction.feeAmount).toBe('5.00000000');
      expect(result.transaction.toAmount).toBe('1413397.50000000');
      expect(result.transaction.type).toBe('SELL');
    });

    it('redondea la comisión hacia arriba (ROUND_UP), no al valor más cercano', async () => {
      const { client } = createMockClient({
        balances: {
          USD: { id: 'bal-usd', amount: '10000.00000000' },
          EUR: { id: 'bal-eur', amount: '0.00000000' },
        },
        decimals: { USD: 2 },
      });

      // 200.02 * 0.005 = 1.0001 -> a 2 decimales, ROUND_HALF_UP daría 1.00,
      // pero la regla de negocio exige redondear siempre hacia arriba: 1.01.
      const result = await executeBuy(client, {
        walletId: WALLET_ID,
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        fromAmount: new Decimal('200.02'),
        exchangeRate: new Decimal('1'),
        rateSource: 'frankfurter',
      });

      expect(result.transaction.feeAmount).toBe('1.01000000');
    });

    it('nunca deja la comisión en cero por redondeo silencioso, aun siendo menor a la unidad mínima', async () => {
      const { client } = createMockClient({
        balances: {
          USD: { id: 'bal-usd', amount: '10000.00000000' },
          EUR: { id: 'bal-eur', amount: '0.00000000' },
        },
        decimals: { USD: 2 },
      });

      // 1.00 * 0.005 = 0.005: por debajo del centavo (unidad mínima de USD),
      // pero nunca debe quedar en 0.00.
      const result = await executeBuy(client, {
        walletId: WALLET_ID,
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        fromAmount: new Decimal('1.00'),
        exchangeRate: new Decimal('1'),
        rateSource: 'frankfurter',
      });

      expect(result.transaction.feeAmount).toBe('0.01000000');
    });

    it('redondea al entero superior en monedas sin decimales (CLP)', async () => {
      const { client } = createMockClient({
        balances: {
          CLP: { id: 'bal-clp', amount: '100000.00000000' },
          USD: { id: 'bal-usd', amount: '0.00000000' },
        },
        decimals: { CLP: 0 },
      });

      // 100 * 0.005 = 0.5 -> redondeado hacia arriba, 1 CLP.
      const result = await executeBuy(client, {
        walletId: WALLET_ID,
        fromCurrency: 'CLP',
        toCurrency: 'USD',
        fromAmount: new Decimal('100'),
        exchangeRate: new Decimal('0.001'),
        rateSource: 'frankfurter',
      });

      expect(result.transaction.feeAmount).toBe('1.00000000');
    });
  });

  describe('validación de saldo suficiente', () => {
    it('debitBalance rechaza con INSUFFICIENT_BALANCE (400) cuando el saldo no alcanza', async () => {
      await expect(
        debitBalance(
          createMockClient().client,
          { id: 'bal-1', amount: '10.00000000' },
          new Decimal('10.00000001')
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INSUFFICIENT_BALANCE',
      });
    });

    it('debitBalance permite un débito exacto que deja el saldo en cero', async () => {
      const newAmount = await debitBalance(
        createMockClient().client,
        { id: 'bal-1', amount: '10.00000000' },
        new Decimal('10.00000000')
      );

      expect(newAmount).toBe('0.00000000');
    });

    it('executeBuy rechaza toda la operación si el saldo no cubre monto + comisión', async () => {
      const { client, calls } = createMockClient({
        balances: {
          USD: { id: 'bal-usd', amount: '999.99999999' }, // falta un centésimo de centavo
          ARS: { id: 'bal-ars', amount: '0.00000000' },
        },
        decimals: { USD: 2 },
      });

      await expect(
        executeBuy(client, {
          walletId: WALLET_ID,
          fromCurrency: 'USD',
          toCurrency: 'ARS',
          fromAmount: new Decimal('1000'),
          exchangeRate: new Decimal('1420.50'),
          rateSource: 'frankfurter',
        })
      ).rejects.toBeInstanceOf(AppError);

      // Al fallar el débito, no se llegó a tocar ningún balance.
      expect(calls.some((c) => c.sql.includes('UPDATE balances'))).toBe(false);
    });

    it('executeExchange también respeta la validación de saldo suficiente', async () => {
      const { client } = createMockClient({
        balances: {
          USD: { id: 'bal-usd', amount: '50.00000000' },
          EUR: { id: 'bal-eur', amount: '0.00000000' },
        },
      });

      await expect(
        executeExchange(client, {
          walletId: WALLET_ID,
          fromCurrency: 'USD',
          toCurrency: 'EUR',
          fromAmount: new Decimal('100'),
          exchangeRate: new Decimal('0.9'),
          rateSource: 'frankfurter',
        })
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    });
  });

  describe('diferencia entre compra/venta e intercambio', () => {
    const balances = {
      USD: { id: 'bal-usd', amount: '10000.00000000' },
      ARS: { id: 'bal-ars', amount: '0.00000000' },
    };
    const decimals = { USD: 2 };
    const params = {
      walletId: WALLET_ID,
      fromCurrency: 'USD',
      toCurrency: 'ARS',
      fromAmount: new Decimal('1000'),
      exchangeRate: new Decimal('1420.50'),
      rateSource: 'frankfurter',
    };

    it('EXCHANGE no cobra comisión y convierte el monto completo', async () => {
      const { client } = createMockClient({ balances, decimals });

      const result = await executeExchange(client, params);

      expect(result.transaction.feeAmount).toBe('0.00000000');
      expect(result.transaction.feeRate).toBe('0.00000');
      expect(result.transaction.toAmount).toBe('1420500.00000000'); // 1000 * 1420.50, sin descuento
    });

    it('EXCHANGE preserva el patrimonio total: reconvertir toAmount da exactamente fromAmount', async () => {
      const { client } = createMockClient({ balances, decimals });

      const result = await executeExchange(client, params);
      const toAmount = new Decimal(result.transaction.toAmount);
      const roundTrip = toAmount.dividedBy(params.exchangeRate);

      expect(roundTrip.equals(params.fromAmount)).toBe(true);
    });

    it('BUY/SELL sí reducen el patrimonio: reconvertir toAmount da fromAmount menos la comisión', async () => {
      const { client } = createMockClient({ balances, decimals });

      const result = await executeBuy(client, params);
      const toAmount = new Decimal(result.transaction.toAmount);
      const feeAmount = new Decimal(result.transaction.feeAmount);
      const roundTrip = toAmount.dividedBy(params.exchangeRate);

      // fromAmount - toAmount/rate === feeAmount (se "perdió" exactamente la comisión)
      expect(params.fromAmount.minus(roundTrip).equals(feeAmount)).toBe(true);
      expect(roundTrip.equals(params.fromAmount)).toBe(false);
    });

    it('para el mismo monto y tasa, EXCHANGE entrega más que BUY (la diferencia es la comisión convertida)', async () => {
      const { client: exchangeClient } = createMockClient({ balances, decimals });
      const { client: buyClient } = createMockClient({ balances, decimals });

      const exchangeResult = await executeExchange(exchangeClient, params);
      const buyResult = await executeBuy(buyClient, params);

      const exchangeToAmount = new Decimal(exchangeResult.transaction.toAmount);
      const buyToAmount = new Decimal(buyResult.transaction.toAmount);
      const feeAmount = new Decimal(buyResult.transaction.feeAmount);

      expect(exchangeToAmount.minus(buyToAmount).equals(feeAmount.times(params.exchangeRate))).toBe(
        true
      );
    });

    it('EXCHANGE no genera un asiento FEE en el ledger; BUY sí', async () => {
      const { client: exchangeClient, calls: exchangeCalls } = createMockClient({
        balances,
        decimals,
      });
      const { client: buyClient, calls: buyCalls } = createMockClient({ balances, decimals });

      await executeExchange(exchangeClient, params);
      await executeBuy(buyClient, params);

      const hasFeeEntry = (calls: RecordedCall[]) =>
        calls.some((c) => c.sql.includes('transaction_entries') && c.params[3] === 'FEE');

      expect(hasFeeEntry(exchangeCalls)).toBe(false);
      expect(hasFeeEntry(buyCalls)).toBe(true);
    });

    it('EXCHANGE guarda fee_currency = null; BUY guarda la moneda de origen', async () => {
      const { client: exchangeClient, calls: exchangeCalls } = createMockClient({
        balances,
        decimals,
      });
      const { client: buyClient, calls: buyCalls } = createMockClient({ balances, decimals });

      await executeExchange(exchangeClient, params);
      await executeBuy(buyClient, params);

      const txInsertParams = (calls: RecordedCall[]) =>
        calls.find((c) => c.sql.includes('INSERT INTO transactions'))?.params ?? [];

      // orden de columnas: wallet_id, type, from, to, fromAmount, toAmount,
      // rate, feeAmount, feeCurrency, feeRate, rateSource
      expect(txInsertParams(exchangeCalls)[8]).toBeNull();
      expect(txInsertParams(buyCalls)[8]).toBe('USD');
    });

    it('cada función persiste el `type` correspondiente', async () => {
      const { client: buyClient } = createMockClient({ balances, decimals });
      const { client: sellClient } = createMockClient({ balances, decimals });
      const { client: exchangeClient } = createMockClient({ balances, decimals });

      const buy = await executeBuy(buyClient, params);
      const sell = await executeSell(sellClient, params);
      const exchange = await executeExchange(exchangeClient, params);

      expect(buy.transaction.type).toBe('BUY');
      expect(sell.transaction.type).toBe('SELL');
      expect(exchange.transaction.type).toBe('EXCHANGE');
    });
  });
});
