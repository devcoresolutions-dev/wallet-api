import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/database';
import { AppError } from '../utils/AppError';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
});

router.post('/register', async (req, res) => {
  const { email, password, full_name } = registerSchema.parse(req.body);

  const existingUser = await pool.query<{ id: string }>(
  'SELECT id FROM users WHERE email = $1',
  [email]
);

if (existingUser.rows.length > 0) {
  throw new AppError(400, 'EMAIL_EXISTS', 'Email already registered');
}

  const password_hash = await bcrypt.hash(password, 10);

  const user = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, created_at`,
      [email, password_hash, full_name]
    );

    const userId = result.rows[0].id;

  await client.query(
  `INSERT INTO wallets (user_id)
   VALUES ($1)`,
  [userId]
);

    return result.rows[0];
  });

  return res.status(201).json({ user });
});

export { router as authRouter };