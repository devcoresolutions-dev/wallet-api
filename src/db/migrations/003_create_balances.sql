-- Migration: balances table

CREATE TABLE IF NOT EXISTS balances (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id     UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    amount        NUMERIC(20,8) NOT NULL DEFAULT 0,
    UNIQUE (wallet_id, currency_code),
    CONSTRAINT balances_amount_non_negative CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_balances_wallet ON balances(wallet_id);