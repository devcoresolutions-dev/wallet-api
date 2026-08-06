import type { PoolClient } from 'pg';
import { AppError } from '../utils/AppError';

interface CurrencyRow {
  decimals: number;
}

/**
 * Devuelve la cantidad de decimales que se muestran para una moneda —
 * la "unidad mínima" que se usa para redondear comisiones hacia arriba
 * (ver business-rules.md, sección 2). No confundir con la precisión
 * interna de almacenamiento, que siempre es 8 (NUMERIC(20,8)).
 */
export async function getDecimals(client: PoolClient, currencyCode: string): Promise<number> {
  const result = await client.query<CurrencyRow>(
    `SELECT decimals FROM currencies WHERE code = $1`,
    [currencyCode]
  );

  if (result.rows.length === 0) {
    throw new AppError(404, 'CURRENCY_NOT_FOUND', `Currency ${currencyCode} not found`);
  }

  return result.rows[0].decimals;
}
