-- Migration: create balances, transactions and transaction_entries tables

CREATE TABLE IF NOT EXISTS balances (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id    UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
    amount       NUMERIC(20,8) NOT NULL DEFAULT 0,
    UNIQUE (wallet_id, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_balances_wallet_currency
    ON balances(wallet_id, currency_code);

CREATE TABLE IF NOT EXISTS transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id       UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type            VARCHAR(10) NOT NULL,
    from_currency   CHAR(3) NOT NULL REFERENCES currencies(code),
    to_currency     CHAR(3) NOT NULL REFERENCES currencies(code),
    from_amount     NUMERIC(20,8) NOT NULL,
    to_amount       NUMERIC(20,8) NOT NULL,
    exchange_rate   NUMERIC(20,8) NOT NULL,
    fee_amount      NUMERIC(20,8) NOT NULL,
    fee_currency    CHAR(3) NOT NULL REFERENCES currencies(code),
    fee_rate        NUMERIC(10,5) NOT NULL,
    rate_source     VARCHAR(50) NOT NULL,
    rate_fetched_at TIMESTAMPTZ NOT NULL,
    status          VARCHAR(20) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_created_at
    ON transactions(wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transaction_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    balance_id     UUID NOT NULL REFERENCES balances(id) ON DELETE CASCADE,
    direction      VARCHAR(6) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    entry_type     VARCHAR(10) NOT NULL CHECK (entry_type IN ('PRINCIPAL', 'FEE')),
    amount         NUMERIC(20,8) NOT NULL,
    balance_after  NUMERIC(20,8) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_entries_transaction_id
    ON transaction_entries(transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_entries_balance_id
    ON transaction_entries(balance_id);
