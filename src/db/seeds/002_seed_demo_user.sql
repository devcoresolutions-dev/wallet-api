-- Seed: example user for testing
-- password: "password123" (hashed with bcryptjs, 10 rounds)

INSERT INTO users (email, password_hash, full_name) VALUES
    ('demo@devcore.test', '$2b$10$jJHxdQjlzGxHB1Ka88c9neXjoV9HtVF636K0/2Pbf0FOdo8tMHikK', 'Usuario Demo');