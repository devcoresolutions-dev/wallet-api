-- Migration: create notifications table
--
-- Centraliza el registro de todos los emails que la aplicación intenta enviar.
-- El envío es asíncrono respecto de la operación que lo dispara: si SES falla,
-- la operación principal (registro, transacción) no se ve afectada, pero queda
-- constancia del fallo para poder reintentar.

CREATE TABLE IF NOT EXISTS notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    type          VARCHAR(40) NOT NULL,
    recipient     VARCHAR(255) NOT NULL,
    subject       VARCHAR(255) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    provider_id   VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at       TIMESTAMPTZ
);

-- Para buscar los pendientes que hay que reintentar
CREATE INDEX IF NOT EXISTS idx_notifications_status
    ON notifications(status, created_at);

-- Para consultar el historial de notificaciones de un usuario
CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications(user_id, created_at DESC);