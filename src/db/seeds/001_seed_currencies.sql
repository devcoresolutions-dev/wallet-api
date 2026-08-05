-- Seed: 8 required currencies

INSERT INTO currencies (code, name, symbol, decimals, is_active) VALUES
    ('USD', 'US Dollar',        '$',  2, TRUE),
    ('EUR', 'Euro',              '€',  2, TRUE),
    ('ARS', 'Argentine Peso',    '$',  2, TRUE),
    ('BRL', 'Brazilian Real',    'R$', 2, TRUE),
    ('CLP', 'Chilean Peso',      '$',  0, TRUE),
    ('COP', 'Colombian Peso',    '$',  2, TRUE),
    ('MXN', 'Mexican Peso',      '$',  2, TRUE),
    ('PEN', 'Peruvian Sol',      'S/', 2, TRUE)
ON CONFLICT (code) DO NOTHING;