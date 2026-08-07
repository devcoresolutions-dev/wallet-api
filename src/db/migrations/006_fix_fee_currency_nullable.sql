-- Migration: fix fee_currency nullability drift
--
-- 004_create_transactions.sql define fee_currency como nullable (EXCHANGE
-- no cobra comisión y guarda NULL a propósito), pero la tabla real en la DB
-- quedó creada con NOT NULL desde una versión anterior de esa migración.
-- Como el runner usa CREATE TABLE IF NOT EXISTS, el cambio nunca se aplicó.
-- Resultado: todo POST /api/transactions/exchange fallaba con 500
-- (null value in column "fee_currency" violates not-null constraint).

ALTER TABLE transactions ALTER COLUMN fee_currency DROP NOT NULL;
