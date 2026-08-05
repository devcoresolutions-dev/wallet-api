-- Seed: example user for testing
-- password: "password123" (hashed with bcryptjs, 10 rounds)

INSERT INTO users (email, password_hash, full_name) VALUES
    ('demo@devcore.test', '$2b$10$jJHxdQjlzGxHB1Ka88c9neXjoV9HtVF636K0/2Pbf0FOdo8tMHikK', 'Usuario Demo')
ON CONFLICT (email) DO NOTHING;

INSERT INTO wallets (user_id)
SELECT u.id
FROM users u
WHERE u.email = 'demo@devcore.test'
 AND NOT EXISTS(
    SELECT 1 FROM wallets w WHERE w.user_id = u.id
 );

INSERT INTO balances (wallet_id, currency_code, amount)
SELECT w.id, c.code, 0.00000000
FROM wallets w
JOIN users u ON u.id = w.user_id
CROSS JOIN currencies c
WHERE u.email = 'demo@devcore.test'
ON CONFLICT (wallet_id, currency_code) DO NOTHING;