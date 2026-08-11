import { Router } from 'express';
import { AppError } from '../utils/AppError';
import { authenticate } from '../middlewares/authenticate';
import { chatSchema } from '../schemas/chat.schemas';
import { chat } from '../services/chat.service';
import * as walletModel from '../models/wallet.model';

const router = Router();

const RATE_LIMIT = 20;              // mensajes permitidos
const RATE_WINDOW_MS = 60 * 1000;   // por minuto

/**
 * Rate limiting en memoria, por usuario.
 *
 * Se guarda en un Map en vez de en la base porque el proyecto corre en una
 * sola instancia: un query por mensaje sería costo sin beneficio. La contra es
 * que un reinicio del servidor resetea los contadores, lo cual es aceptable
 * para este caso. Con varias instancias habría que moverlo a la DB o a Redis.
 */
const requestLog = new Map<string, number[]>();

function checkRateLimit(userId: string): void {
    const now = Date.now();
    const timestamps = requestLog.get(userId) ?? [];

    // Solo interesan los mensajes dentro de la ventana actual
    const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);

    if (recent.length >= RATE_LIMIT) {
        throw new AppError(
            429,
            'RATE_LIMIT_EXCEEDED',
            'Demasiados mensajes. Esperá un momento antes de seguir.'
        );
    }

    recent.push(now);
    requestLog.set(userId, recent);
}

/**
 * Limpieza periódica: sin esto, el Map acumularía una entrada por cada usuario
 * que alguna vez usó el chat y nunca liberaría esa memoria.
 */
setInterval(() => {
    const now = Date.now();
    for (const [userId, timestamps] of requestLog) {
        const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
        if (recent.length === 0) {
            requestLog.delete(userId);
        } else {
            requestLog.set(userId, recent);
        }
    }
}, 5 * RATE_WINDOW_MS).unref(); // unref: no impide que el proceso termine

router.post('/', authenticate, async (req, res) => {
    const { message, history } = chatSchema.parse(req.body);

    const userId = req.userId as string;
    checkRateLimit(userId);

    // La wallet se deriva del token: el asistente solo puede ver los datos de
    // quien está autenticado, nunca los de otra cuenta.
    const wallet = await walletModel.findByUserId(userId);
    if (!wallet) {
        throw new AppError(404, 'WALLET_NOT_FOUND', 'No wallet found for the authenticated user');
    }

    const reply = await chat(wallet.id, message, history);

    return res.json({ reply });
});

export { router as chatRouter };