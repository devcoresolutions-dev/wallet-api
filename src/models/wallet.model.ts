import { PoolClient } from 'pg';
import { pool } from '../config/database';

/**
 * Busca la wallet de un usuario a partir de su id.
 * Se usa para derivar walletId del token en vez de confiar en el body.
 */
export async function findByUserId(userId: string): Promise<{ id: string } | null> {
    const result = await pool.query<{ id: string }>(
        'SELECT id FROM wallets WHERE user_id = $1',
        [userId]
    );
    return result.rows[0] ?? null;
}

export interface BalanceRow {
    currency_code: string;
    currency_name: string;
    symbol: string;
    decimals: number;
    amount: string;
}

/**
 * Devuelve el balance de la wallet en cada moneda activa. Siempre incluye
 * las 8 monedas (aunque el amount sea cero) porque se crean todas al
 * registrar el usuario, en createWithBalances.
 */
export async function findBalances(walletId: string): Promise<BalanceRow[]> {
    const result = await pool.query<BalanceRow>(
        `SELECT c.code AS currency_code, c.name AS currency_name, c.symbol, c.decimals, b.amount
     FROM balances b
     JOIN currencies c ON c.code = b.currency_code
     WHERE b.wallet_id = $1 AND c.is_active = true
     ORDER BY c.code`,
        [walletId]
    );
    return result.rows;
}

export async function createWithBalances(
    client: PoolClient,
    userId: string
): Promise<string> {
    const walletResult = await client.query<{ id: string }>(
        'INSERT INTO wallets (user_id) VALUES ($1) RETURNING id',
        [userId]
    );
    const walletId = walletResult.rows[0].id;

    await client.query(
        `INSERT INTO balances (wallet_id, currency_code, amount)
     SELECT $1, code, 0 FROM currencies WHERE is_active = true`,
        [walletId]
    );

    return walletId;
}