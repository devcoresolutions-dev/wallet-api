import { PoolClient } from 'pg';

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