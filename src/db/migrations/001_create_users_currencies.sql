-- Migration: create users and currencies tables

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS currencies (
    code       CHAR(3) PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    symbol     VARCHAR(5)  NOT NULL,
    decimals   SMALLINT    NOT NULL DEFAULT 2,
    is_active  BOOLEAN     NOT NULL DEFAULT TRUE
);