import { pool } from '../config/database';

export type NotificationType =
    | 'WELCOME'
    | 'TRANSACTION_CONFIRMATION'
    | 'NEW_DEVICE_LOGIN'
    | 'PASSWORD_RESET';

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface NotificationRow {
    id: string;
    user_id: string | null;
    type: NotificationType;
    recipient: string;
    subject: string;
    status: NotificationStatus;
    attempts: number;
    last_error: string | null;
    provider_id: string | null;
    created_at: Date;
    sent_at: Date | null;
}

/**
 * Registra la intención de enviar un email, antes de intentarlo.
 *
 * El orden importa: primero se guarda como PENDING y después se intenta el
 * envío. Si el proceso se cae en el medio, queda constancia de que ese email
 * quedó pendiente. Al revés (guardar después de enviar) perdería el rastro de
 * cualquier envío que falle antes de escribirse.
 */
export async function create(params: {
    userId: string | null;
    type: NotificationType;
    recipient: string;
    subject: string;
}): Promise<NotificationRow> {
    const result = await pool.query<NotificationRow>(
        `INSERT INTO notifications (user_id, type, recipient, subject)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
        [params.userId, params.type, params.recipient, params.subject]
    );

    return result.rows[0];
}

/**
 * Marca la notificación como enviada y guarda el id que devolvió el proveedor,
 * para poder rastrear el mensaje en los logs de SES si alguien reclama que no
 * le llegó.
 */
export async function markAsSent(id: string, providerId: string): Promise<void> {
    await pool.query(
        `UPDATE notifications
     SET status = 'SENT',
         attempts = attempts + 1,
         provider_id = $2,
         sent_at = NOW(),
         last_error = NULL
     WHERE id = $1`,
        [id, providerId]
    );
}

/**
 * Marca el intento como fallido y guarda la causa. Sin el error registrado, un
 * reintento a ciegas repetiría el mismo problema sin que nadie sepa cuál es.
 */
export async function markAsFailed(id: string, error: string): Promise<void> {
    await pool.query(
        `UPDATE notifications
     SET status = 'FAILED',
         attempts = attempts + 1,
         last_error = $2
     WHERE id = $1`,
        [id, error]
    );
}

/**
 * Devuelve las notificaciones fallidas que todavía no agotaron los reintentos.
 * Pensado para un proceso de reenvío: sin un tope, un email con un destinatario
 * inválido se reintentaría para siempre.
 */
export async function findRetryable(maxAttempts = 3, limit = 50): Promise<NotificationRow[]> {
    const result = await pool.query<NotificationRow>(
        `SELECT * FROM notifications
     WHERE status = 'FAILED' AND attempts < $1
     ORDER BY created_at ASC
     LIMIT $2`,
        [maxAttempts, limit]
    );

    return result.rows;
}