import { PoolClient } from 'pg';
import { pool } from '../config/database';

export interface UserRow {
    id: string;
    email: string;
    password_hash: string;
    full_name: string;
    created_at: Date;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
    const result = await pool.query<UserRow>(
        'SELECT * FROM users WHERE email = $1',
        [email]
    );
    return result.rows[0] ?? null;
}

export async function findById(id: string): Promise<UserRow | null> {
    const result = await pool.query<UserRow>(
        'SELECT * FROM users WHERE id = $1',
        [id]
    );
    return result.rows[0] ?? null;
}

export async function create(
    client: PoolClient,
    email: string,
    passwordHash: string,
    fullName: string
): Promise<UserRow> {
    const result = await client.query<UserRow>(
        `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
        [email, passwordHash, fullName]
    );
    return result.rows[0];
}