-- Migration: transactions and ledger entries

CREATE TABLE IF NOT EXISTS transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id       UUID NOT NULL REFERENCES wallets(id),
    type            VARCHAR(10) NOT NULL CHECK (type IN ('BUY','SELL','EXCHANGE')),
    from_currency   CHAR(3) NOT NULL REFERENCES currencies(code),
    to_currency     CHAR(3) NOT NULL REFERENCES currencies(code),
    from_amount     NUMERIC(20,8) NOT NULL,
    to_amount       NUMERIC(20,8) NOT NULL,
    exchange_rate   NUMERIC(20,8) NOT NULL,
    fee_amount      NUMERIC(20,8) NOT NULL DEFAULT 0,
    fee_currency    CHAR(3) REFERENCES currencies(code),
    fee_rate        NUMERIC(6,5)  NOT NULL DEFAULT 0,
    rate_source     VARCHAR(50),
    rate_fetched_at TIMESTAMPTZ,
    status          VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','COMPLETED','FAILED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT transactions_amounts_positive
        CHECK (from_amount > 0 AND to_amount > 0),
    CONSTRAINT transactions_different_currencies
        CHECK (from_currency <> to_currency)
);

CREATE TABLE IF NOT EXISTS transaction_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    balance_id     UUID NOT NULL REFERENCES balances(id),
    direction      VARCHAR(6)  NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
    entry_type     VARCHAR(10) NOT NULL CHECK (entry_type IN ('PRINCIPAL','FEE')),
    amount         NUMERIC(20,8) NOT NULL CHECK (amount > 0),
    balance_after  NUMERIC(20,8) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_created
    ON transactions(wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_entries_transaction
    ON transaction_entries(transaction_id);