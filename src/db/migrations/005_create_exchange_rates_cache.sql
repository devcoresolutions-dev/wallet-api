-- Migration: create exchange_rates_cache table

CREATE TABLE IF NOT EXISTS exchange_rates_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_currency   CHAR(3) NOT NULL REFERENCES currencies(code),
    target_currency CHAR(3) NOT NULL REFERENCES currencies(code),
    rate            NUMERIC(20,8) NOT NULL,
    provider        VARCHAR(50) NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (base_currency, target_currency, provider)
);

CREATE INDEX IF NOT EXISTS idx_rates_cache_lookup
    ON exchange_rates_cache(base_currency, target_currency, provider);