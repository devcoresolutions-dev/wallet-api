import type { PoolClient } from 'pg';
import { pool } from '../config/database';
import { AppError } from '../utils/AppError';

export interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  is_active: boolean;
}

/**
 * Devuelve todas las monedas activas, para que el frontend pueda mostrar
 * el listado y formatear montos según los decimales de cada una.
 */
export async function findAllActive(): Promise<CurrencyRow[]> {
  const result = await pool.query<CurrencyRow>(
    'SELECT code, name, symbol, decimals, is_active FROM currencies WHERE is_active = true ORDER BY code'
  );
  return result.rows;
}

/**
 * Devuelve la cantidad de decimales que se muestran para una moneda —
 * la "unidad mínima" que se usa para redondear comisiones hacia arriba
 * (ver business-rules.md, sección 2). No confundir con la precisión
 * interna de almacenamiento, que siempre es 8 (NUMERIC(20,8)).
 */
export async function getDecimals(client: PoolClient, currencyCode: string): Promise<number> {
  const result = await client.query<{ decimals: number }>(
    `SELECT decimals FROM currencies WHERE code = $1`,
    [currencyCode]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'CURRENCY_NOT_FOUND', `Currency ${currencyCode} not found`);
  }

  return result.rows[0].decimals;
}

/**
 * Valida que todos los códigos recibidos existan y estén activos, antes de
 * pedir la tasa de cambio o tocar balances. Sin este chequeo, un código
 * inválido (typo del cliente, moneda dada de baja) llegaba crudo hasta
 * Frankfurter o hasta un INSERT/UPDATE contra la DB y terminaba en un 500
 * genérico en vez de un error 400 claro para quien llama a la API.
 */
export async function assertCurrenciesActive(codes: string[]): Promise<void> {
  const uniqueCodes = [...new Set(codes)];

  const result = await pool.query<{ code: string }>(
    `SELECT code FROM currencies WHERE code = ANY($1) AND is_active = true`,
    [uniqueCodes]
  );

  const found = new Set(result.rows.map((row) => row.code));
  const missing = uniqueCodes.filter((code) => !found.has(code));

  if (missing.length > 0) {
    throw new AppError(
      400,
      'INVALID_CURRENCY',
      `Unknown or inactive currency code(s): ${missing.join(', ')}`
    );
  }
}
/**
 * Igual que getDecimals pero sin transacción: se usa desde contextos que no
 * están dentro de un withTransaction, como el armado de emails.
 */
export async function getDecimalsFor(currencyCode: string): Promise<number> {
  const result = await pool.query<{ decimals: number }>(
    `SELECT decimals FROM currencies WHERE code = $1`,
    [currencyCode]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'CURRENCY_NOT_FOUND', `Currency ${currencyCode} not found`);
  }

  return result.rows[0].decimals;
}
