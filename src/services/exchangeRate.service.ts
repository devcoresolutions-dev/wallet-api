import { pool } from '../config/database';
import { AppError } from '../utils/AppError';

const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v2';
const ER_API_BASE_URL = 'https://open.er-api.com/v6';

const CACHE_TTL_MS = 60 * 60 * 1000;        // 1 hora: se considera fresco
const MAX_STALE_MS = 24 * 60 * 60 * 1000;   // 24 horas: más viejo que esto no se usa

const PROVIDER_FRANKFURTER = 'frankfurter';
const PROVIDER_ER_API = 'exchangerate-api';

interface CachedRate {
  rate: string;
  fetched_at: Date;
  provider: string;
}

interface FrankfurterRateResponse {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

interface ErApiResponse {
  result: string;
  base_code: string;
  rates: Record<string, number>;
}

/**
 * Resultado de una consulta de tasa.
 * `rate` viaja como string para no perder precisión: la columna es NUMERIC(20,8)
 * y convertirla a number la degradaría al punto flotante de JavaScript.
 */
export interface RateResult {
  rate: string;
  fetchedAt: Date;
  ageMinutes: number;
  source: string;
}

/**
 * Devuelve la tasa de cambio base -> target.
 *
 * Orden de resolución:
 *   1. Caché fresco (< 1h) — se devuelve sin consultar ninguna API
 *   2. Frankfurter — proveedor principal
 *   3. ExchangeRate-API — fallback si el principal falla
 *   4. Caché rancio (< 24h) — último recurso si ambas APIs fallan
 *   5. Error 503 — no hay dato utilizable
 *
 * Nunca se estiman ni se interpolan tasas.
 */
export async function getExchangeRate(
  baseCurrency: string,
  targetCurrency: string
): Promise<RateResult> {
  const cached = await getCachedRate(baseCurrency, targetCurrency);

  if (cached && ageMs(cached.fetched_at) < CACHE_TTL_MS) {
    return toResult(cached);
  }

  // Proveedor principal
  try {
    const rate = await fetchFromFrankfurter(baseCurrency, targetCurrency);
    const saved = await saveToCache(baseCurrency, targetCurrency, rate, PROVIDER_FRANKFURTER);
    return toResult(saved);
  } catch (error) {
    console.error(
      `[rates] Frankfurter falló para ${baseCurrency}/${targetCurrency}:`,
      error
    );
  }

  // Fallback
  try {
    const rate = await fetchFromErApi(baseCurrency, targetCurrency);
    const saved = await saveToCache(baseCurrency, targetCurrency, rate, PROVIDER_ER_API);
    console.warn(
      `[rates] Usando proveedor de respaldo para ${baseCurrency}/${targetCurrency}`
    );
    return toResult(saved);
  } catch (error) {
    console.error(
      `[rates] ExchangeRate-API falló para ${baseCurrency}/${targetCurrency}:`,
      error
    );
  }

  // Último recurso: caché rancio, siempre que no supere las 24h
  if (cached && ageMs(cached.fetched_at) < MAX_STALE_MS) {
    const result = toResult(cached);
    console.warn(
      `[rates] Ambos proveedores caídos. Usando tasa cacheada de ${result.ageMinutes} minutos para ${baseCurrency}/${targetCurrency}`
    );
    return result;
  }

  throw new AppError(
    503,
    'RATE_UNAVAILABLE',
    'No hay cotización disponible en este momento'
  );
}

function ageMs(fetchedAt: Date): number {
  return Date.now() - new Date(fetchedAt).getTime();
}

function toResult(cached: CachedRate): RateResult {
  return {
    rate: cached.rate,
    fetchedAt: new Date(cached.fetched_at),
    ageMinutes: Math.floor(ageMs(cached.fetched_at) / 60000),
    source: cached.provider,
  };
}

/**
 * Trae la tasa cacheada más reciente para el par, sin importar qué proveedor
 * la haya guardado. Si un proveedor falla y el otro responde, la fila más
 * fresca es la que vale.
 */
async function getCachedRate(
  baseCurrency: string,
  targetCurrency: string
): Promise<CachedRate | null> {
  const result = await pool.query<CachedRate>(
    `SELECT rate, fetched_at, provider FROM exchange_rates_cache
     WHERE base_currency = $1 AND target_currency = $2
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [baseCurrency, targetCurrency]
  );

  return result.rows[0] ?? null;
}

async function fetchFromFrankfurter(
  baseCurrency: string,
  targetCurrency: string
): Promise<number> {
  const url = `${FRANKFURTER_BASE_URL}/rate/${baseCurrency}/${targetCurrency}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Frankfurter API error: ${response.status}`);
  }

  const data = (await response.json()) as FrankfurterRateResponse;
  return data.rate;
}

/**
 * Proveedor de respaldo. Devuelve todas las tasas contra la base en un solo
 * request, así que hay que extraer la moneda destino del objeto `rates`.
 */
async function fetchFromErApi(
  baseCurrency: string,
  targetCurrency: string
): Promise<number> {
  const url = `${ER_API_BASE_URL}/latest/${baseCurrency}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ExchangeRate-API error: ${response.status}`);
  }

  const data = (await response.json()) as ErApiResponse;

  if (data.result !== 'success') {
    throw new Error(`ExchangeRate-API devolvió result="${data.result}"`);
  }

  const rate = data.rates?.[targetCurrency];

  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(
      `ExchangeRate-API no devolvió tasa para ${baseCurrency}/${targetCurrency}`
    );
  }

  return rate;
}

/**
 * Guarda la tasa y devuelve la fila resultante, para no depender
 * de un segundo query ni de reconstruir el timestamp a mano.
 */
async function saveToCache(
  baseCurrency: string,
  targetCurrency: string,
  rate: number,
  provider: string
): Promise<CachedRate> {
  const result = await pool.query<CachedRate>(
    `INSERT INTO exchange_rates_cache (base_currency, target_currency, rate, provider, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (base_currency, target_currency, provider)
     DO UPDATE SET rate = $3, fetched_at = NOW()
     RETURNING rate, fetched_at, provider`,
    [baseCurrency, targetCurrency, rate, provider]
  );

  return result.rows[0];
}