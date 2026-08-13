-- Migration: permitir transacciones de tipo DEPOSIT
--
-- Un depósito acredita fondos en una moneda sin conversión: no hay moneda de
-- origen distinta ni tasa de cambio. Se registra en la misma tabla que las
-- conversiones para que el historial del usuario sea uno solo, con
-- from_currency = to_currency y exchange_rate = 1.
--
-- Eso choca con dos restricciones pensadas solo para conversiones, así que se
-- reemplazan por versiones que contemplan el nuevo tipo.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('BUY', 'SELL', 'EXCHANGE', 'DEPOSIT'));

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_different_currencies;

-- Las conversiones siguen exigiendo monedas distintas; el depósito no.
ALTER TABLE transactions
    ADD CONSTRAINT transactions_different_currencies
    CHECK (type = 'DEPOSIT' OR from_currency <> to_currency);