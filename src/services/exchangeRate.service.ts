import { pool } from '../config/database';

const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v2';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const PROVIDER = 'frankfurter';

interface CachedRate {
  rate: string;
  fetched_at: Date;
}

interface FrankfurterRateResponse {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

/**
 * Devuelve la tasa de cambio base -> target.
 * Usa el caché si tiene menos de 1 hora; si no, consulta Frankfurter y actualiza el caché.
 */
export async function getExchangeRate(
  baseCurrency: string,
  targetCurrency: string
): Promise<number> {
  const cached = await getCachedRate(baseCurrency, targetCurrency);

  if (cached && isFresh(cached.fetched_at)) {
    return Number(cached.rate);
  }

  try {
    const freshRate = await fetchFromFrankfurter(baseCurrency, targetCurrency);
    await saveToCache(baseCurrency, targetCurrency, freshRate);
    return freshRate;
  } catch (error) {
    // Frankfurter falló: si hay algo en caché aunque esté vencido, lo usamos como último recurso
    if (cached) {
      console.warn(
        `Frankfurter unavailable, using stale cached rate for ${baseCurrency}/${targetCurrency} (fetched at ${cached.fetched_at.toISOString()})`
      );
      return Number(cached.rate);
    }
    throw error;
  }
}

async function getCachedRate(
  baseCurrency: string,
  targetCurrency: string
): Promise<CachedRate | null> {
  const result = await pool.query<CachedRate>(
    `SELECT rate, fetched_at FROM exchange_rates_cache
     WHERE base_currency = $1 AND target_currency = $2 AND provider = $3`,
    [baseCurrency, targetCurrency, PROVIDER]
  );

  return result.rows[0] ?? null;
}

function isFresh(fetchedAt: Date): boolean {
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs < CACHE_TTL_MS;
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

async function saveToCache(
  baseCurrency: string,
  targetCurrency: string,
  rate: number
): Promise<void> {
  await pool.query(
    `INSERT INTO exchange_rates_cache (base_currency, target_currency, rate, provider, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (base_currency, target_currency, provider)
     DO UPDATE SET rate = $3, fetched_at = NOW()`,
    [baseCurrency, targetCurrency, rate, PROVIDER]
  );
}