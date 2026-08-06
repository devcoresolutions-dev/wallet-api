import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mockeamos el módulo de conexión a la DB para no depender de una base real:
// getExchangeRate solo usa `pool.query`, así que con esto alcanza para
// controlar por completo qué hay "cacheado".
vi.mock('../../src/config/database', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../src/config/database';
import { getExchangeRate } from '../../src/services/exchangeRate.service';

type FetchMock = ReturnType<typeof vi.fn>;

const mockedQuery = pool.query as unknown as FetchMock;

const ONE_HOUR_MS = 60 * 60 * 1000;

function cacheRow(rate: string, fetchedAt: Date) {
  return { rows: [{ rate, fetched_at: fetchedAt }] };
}

const EMPTY_CACHE = { rows: [] };

function mockFrankfurterOk(rate: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ date: '2026-08-06', base: 'USD', quote: 'ARS', rate }),
    })
  );
}

function mockFrankfurterHttpError(status = 500) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({}),
    })
  );
}

function mockFrankfurterNetworkError() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
}

describe('exchangeRate.service — getExchangeRate', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('expiración del caché', () => {
    it('usa la tasa cacheada sin llamar a Frankfurter si tiene menos de 1 hora', async () => {
      const fetchedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min, dentro del TTL
      mockedQuery.mockResolvedValueOnce(cacheRow('1420.50000000', fetchedAt));
      mockFrankfurterOk(9999); // si se llamara, lo notaríamos por el valor devuelto

      const rate = await getExchangeRate('USD', 'ARS');

      expect(rate).toBe(1420.5);
      expect(fetch).not.toHaveBeenCalled();
      // Tampoco debería haber intentado actualizar el caché.
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('vuelve a consultar Frankfurter cuando el caché tiene más de 1 hora', async () => {
      const fetchedAt = new Date(Date.now() - 90 * 60 * 1000); // 90 min, vencido
      mockedQuery
        .mockResolvedValueOnce(cacheRow('1420.50000000', fetchedAt)) // SELECT
        .mockResolvedValueOnce({ rows: [] }); // UPSERT del nuevo valor
      mockFrankfurterOk(1450.75);

      const rate = await getExchangeRate('USD', 'ARS');

      expect(rate).toBe(1450.75);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rate/USD/ARS');
      // SELECT + UPSERT: el caché se refrescó con el valor nuevo.
      expect(mockedQuery).toHaveBeenCalledTimes(2);
      const upsertCall = mockedQuery.mock.calls[1];
      expect(upsertCall[0]).toContain('INSERT INTO exchange_rates_cache');
      expect(upsertCall[1]).toEqual(['USD', 'ARS', 1450.75, 'frankfurter']);
    });

    it('trata como vencido un caché de exactamente 1 hora (el límite no es "fresco")', async () => {
      const fetchedAt = new Date(Date.now() - ONE_HOUR_MS - 1);
      mockedQuery.mockResolvedValueOnce(cacheRow('1000', fetchedAt)).mockResolvedValueOnce({
        rows: [],
      });
      mockFrankfurterOk(1111);

      const rate = await getExchangeRate('USD', 'EUR');

      expect(rate).toBe(1111);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('sin caché previo, consulta Frankfurter y guarda el resultado', async () => {
      mockedQuery.mockResolvedValueOnce(EMPTY_CACHE).mockResolvedValueOnce({ rows: [] });
      mockFrankfurterOk(1234.5);

      const rate = await getExchangeRate('USD', 'BRL');

      expect(rate).toBe(1234.5);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('comportamiento cuando Frankfurter falla', () => {
    it('si Frankfurter responde con error HTTP y hay un caché vencido, usa la tasa vieja como último recurso', async () => {
      const fetchedAt = new Date(Date.now() - 5 * ONE_HOUR_MS); // muy vencido, igual se usa
      mockedQuery.mockResolvedValueOnce(cacheRow('999.99000000', fetchedAt));
      mockFrankfurterHttpError(500);

      const rate = await getExchangeRate('USD', 'MXN');

      expect(rate).toBe(999.99);
      expect(console.warn).toHaveBeenCalledTimes(1);
      // No debe intentar escribir en el caché: el valor stale no cambia.
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('si Frankfurter falla por red y hay un caché vencido, usa la tasa vieja sin lanzar error', async () => {
      const fetchedAt = new Date(Date.now() - 2 * ONE_HOUR_MS);
      mockedQuery.mockResolvedValueOnce(cacheRow('500.00000000', fetchedAt));
      mockFrankfurterNetworkError();

      const rate = await getExchangeRate('USD', 'COP');

      expect(rate).toBe(500);
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('si Frankfurter falla y no hay ningún caché, propaga el error (la ruta lo traduce a RATE_UNAVAILABLE)', async () => {
      mockedQuery.mockResolvedValueOnce(EMPTY_CACHE);
      mockFrankfurterNetworkError();

      await expect(getExchangeRate('USD', 'PEN')).rejects.toThrow('network down');
      // Nunca se estima ni se inventa una tasa, y no hay nada que cachear.
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('si Frankfurter responde con error HTTP y no hay ningún caché, propaga el error', async () => {
      mockedQuery.mockResolvedValueOnce(EMPTY_CACHE);
      mockFrankfurterHttpError(503);

      await expect(getExchangeRate('EUR', 'CLP')).rejects.toThrow('Frankfurter API error: 503');
    });
  });
});
