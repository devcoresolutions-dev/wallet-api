import { z } from 'zod';

/**
 * Límites de entrada como primera barrera anti prompt-injection: un mensaje
 * acotado deja poco espacio para inyectar instrucciones largas, y el historial
 * limitado evita que alguien "entrene" al modelo a lo largo de la conversación.
 */
export const chatSchema = z.object({
    message: z.string().min(1, 'El mensaje no puede estar vacío').max(500),
    history: z
        .array(
            z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string().max(500),
            })
        )
        .max(10)
        .optional()
        .default([]),
});

export type ChatInput = z.infer<typeof chatSchema>;