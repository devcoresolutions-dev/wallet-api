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

// El SELECT del caché trae también `provider`, que alimenta el campo
// `source` del resultado.
function cacheRow(rate: string, fetchedAt: Date, provider = 'frankfurter') {
  return { rows: [{ rate, fetched_at: fetchedAt, provider }] };
}

const EMPTY_CACHE = { rows: [] };

// El UPSERT devuelve la fila guardada (RETURNING rate, fetched_at, provider),
// así el service usa el timestamp real de Postgres y el rate tal como quedó
// en la columna NUMERIC.
function savedRow(rate: string, provider = 'frankfurter') {
  return { rows: [{ rate, fetched_at: new Date(), provider }] };
}

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

// Frankfurter falla, el proveedor de respaldo responde. Se distinguen por
// la URL: el primero pega a api.frankfurter.dev, el segundo a open.er-api.com.
function mockFrankfurterFailsErApiOk(rate: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('frankfurter')) {
        throw new Error('network down');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: 'success',
          base_code: 'USD',
          rates: { ARS: rate, EUR: rate, BRL: rate, MXN: rate, COP: rate, PEN: rate, CLP: rate },
        }),
      };
    })
  );
}

// Los dos proveedores caídos: es el único caso en que se recurre al caché
// rancio o se bloquea la operación.
function mockBothProvidersFail() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
}

describe('exchangeRate.service — getExchangeRate', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('expiración del caché', () => {
    it('usa la tasa cacheada sin llamar a ningún proveedor si tiene menos de 1 hora', async () => {
      const fetchedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min, dentro del TTL
      mockedQuery.mockResolvedValueOnce(cacheRow('1420.50000000', fetchedAt));
      mockFrankfurterOk(9999); // si se llamara, lo notaríamos por el valor devuelto

      const result = await getExchangeRate('USD', 'ARS');

      expect(result.rate).toBe('1420.50000000');
      expect(result.source).toBe('frankfurter');
      expect(result.ageMinutes).toBe(30);
      expect(fetch).not.toHaveBeenCalled();
      // Tampoco debería haber intentado actualizar el caché.
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('vuelve a consultar el proveedor cuando el caché tiene más de 1 hora', async () => {
      const fetchedAt = new Date(Date.now() - 90 * 60 * 1000); // 90 min, vencido
      mockedQuery
        .mockResolvedValueOnce(cacheRow('1420.50000000', fetchedAt)) // SELECT
        .mockResolvedValueOnce(savedRow('1450.75000000')); // UPSERT

      mockFrankfurterOk(1450.75);

      const result = await getExchangeRate('USD', 'ARS');

      expect(result.rate).toBe('1450.75000000');
      expect(result.ageMinutes).toBe(0); // recién traído
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
      mockedQuery
        .mockResolvedValueOnce(cacheRow('1000', fetchedAt))
        .mockResolvedValueOnce(savedRow('1111'));

      mockFrankfurterOk(1111);

      const result = await getExchangeRate('USD', 'EUR');

      expect(result.rate).toBe('1111');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('sin caché previo, consulta el proveedor y guarda el resultado', async () => {
      mockedQuery
        .mockResolvedValueOnce(EMPTY_CACHE)
        .mockResolvedValueOnce(savedRow('1234.50000000'));

      mockFrankfurterOk(1234.5);

      const result = await getExchangeRate('USD', 'BRL');

      expect(result.rate).toBe('1234.50000000');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('fallback al proveedor de respaldo', () => {
    it('si Frankfurter falla, consulta ExchangeRate-API y marca el source', async () => {
      mockedQuery
        .mockResolvedValueOnce(EMPTY_CACHE)
        .mockResolvedValueOnce(savedRow('1500.00000000', 'exchangerate-api'));

      mockFrankfurterFailsErApiOk(1500);

      const result = await getExchangeRate('USD', 'ARS');

      expect(result.rate).toBe('1500.00000000');
      expect(result.source).toBe('exchangerate-api');
      // Los dos proveedores se intentaron, en orden.
      expect(fetch).toHaveBeenCalledTimes(2);

      const upsertCall = mockedQuery.mock.calls[1];
      expect(upsertCall[1]).toEqual(['USD', 'ARS', 1500, 'exchangerate-api']);
    });
  });

  describe('comportamiento cuando los dos proveedores fallan', () => {
    it('usa la tasa cacheada rancia si tiene menos de 24 horas, informando la antigüedad', async () => {
      const fetchedAt = new Date(Date.now() - 5 * ONE_HOUR_MS); // vencido pero dentro de las 24h
      mockedQuery.mockResolvedValueOnce(cacheRow('999.99000000', fetchedAt));

      mockBothProvidersFail();

      const result = await getExchangeRate('USD', 'MXN');

      expect(result.rate).toBe('999.99000000');
      expect(result.ageMinutes).toBe(300); // 5 horas
      // No debe intentar escribir en el caché: el valor rancio no cambia.
      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('bloquea con RATE_UNAVAILABLE si el caché supera las 24 horas', async () => {
      const fetchedAt = new Date(Date.now() - 25 * ONE_HOUR_MS);
      mockedQuery.mockResolvedValueOnce(cacheRow('500.00000000', fetchedAt));

      mockBothProvidersFail();

      // Nunca se estima ni se extrapola una tasa: es preferible no operar.
      await expect(getExchangeRate('USD', 'COP')).rejects.toMatchObject({
        statusCode: 503,
        code: 'RATE_UNAVAILABLE',
      });
    });

    it('bloquea con RATE_UNAVAILABLE si no hay ningún caché', async () => {
      mockedQuery.mockResolvedValueOnce(EMPTY_CACHE);

      mockBothProvidersFail();

      await expect(getExchangeRate('USD', 'PEN')).rejects.toMatchObject({
        statusCode: 503,
        code: 'RATE_UNAVAILABLE',
      });

      expect(mockedQuery).toHaveBeenCalledTimes(1);
    });

    it('bloquea con RATE_UNAVAILABLE si los proveedores responden con error HTTP y no hay caché', async () => {
      mockedQuery.mockResolvedValueOnce(EMPTY_CACHE);

      mockFrankfurterHttpError(503);

      await expect(getExchangeRate('EUR', 'CLP')).rejects.toMatchObject({
        code: 'RATE_UNAVAILABLE',
      });
    });
  });
});
