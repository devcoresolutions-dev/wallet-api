import { pool } from '../config/database';

export interface CurrencyRow {
    code: string;
    name: string;
    symbol: string;
    decimals: number;
    is_active: boolean;
}

export async function findAllActive(): Promise<CurrencyRow[]> {
    const result = await pool.query<CurrencyRow>(
        'SELECT code, name, symbol, decimals, is_active FROM currencies WHERE is_active = true ORDER BY code'
    );
    return result.rows;
}
