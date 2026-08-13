import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '../config/env';
import * as notificationModel from '../models/notification.model';
import type { NotificationType } from '../models/notification.model';
import { getDecimalsFor } from '../models/currency.model';

const ses = new SESClient({
    region: env.AWS_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
});

interface EmailContent {
    subject: string;
    body: string;
}

/**
 * Escapa el contenido dinámico antes de meterlo en el HTML del email.
 * El fullName lo elige el usuario al registrarse: sin escapar, alguien podría
 * registrarse con un nombre que contenga etiquetas y esas etiquetas viajarían
 * dentro del mail.
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function layout(title: string, content: string): string {
    return `<!DOCTYPE html>
<html lang="es">
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, Helvetica, sans-serif; background:#f4f4f4; padding:24px; margin:0;">
    <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:12px; padding:32px;">
      <h1 style="font-size:20px; color:#1C1C1C; margin:0 0 16px 0;">${title}</h1>
      ${content}
      <hr style="border:none; border-top:1px solid #e5e5e5; margin:24px 0;">
      <p style="font-size:12px; color:#888; margin:0;">
        Neto Wallet — Devcore Solutions<br>
        Este es un mensaje automático, no respondas a esta dirección.
      </p>
    </div>
  </body>
</html>`;
}

export function welcomeEmail(fullName: string): EmailContent {
    const name = escapeHtml(fullName);

    return {
        subject: 'Bienvenido a Neto Wallet',
        body: layout(
            `Hola, ${name}`,
            `<p style="font-size:14px; color:#444; line-height:1.6;">
        Tu billetera ya está lista. Podés operar con 8 monedas: dólar, euro, peso
        argentino, real, peso chileno, peso colombiano, peso mexicano y sol peruano.
      </p>
      <p style="font-size:14px; color:#444; line-height:1.6;">
        Las conversiones se hacen con cotizaciones actualizadas y una comisión del
        0,5% en compras y ventas. El intercambio entre tus propias monedas no
        tiene costo.
      </p>`
        ),
    };
}

/**
 * Formatea un monto para mostrarlo a una persona.
 *
 * En la base los montos son NUMERIC(20,8) porque las operaciones necesitan esa
 * precisión, pero "100.00000000 USD" no es legible. Se recorta a los decimales
 * que usa cada moneda y se aplica el formato local: el peso chileno no usa
 * decimales, así que se muestra $15.000 y no $15.000,00.
 */
function formatAmount(amount: string, decimals: number): string {
    return Number(amount).toLocaleString('es-AR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}



export async function transactionEmail(params: {
    fullName: string;
    type: string;
    fromAmount: string;
    fromCurrency: string;
    toAmount: string;
    toCurrency: string;
    feeAmount: string;
}): Promise<EmailContent> {
    const name = escapeHtml(params.fullName);

    const [fromDecimals, toDecimals] = await Promise.all([
        getDecimalsFor(params.fromCurrency),
        getDecimalsFor(params.toCurrency),
    ]);

    const fromAmount = formatAmount(params.fromAmount, fromDecimals);
    const toAmount = formatAmount(params.toAmount, toDecimals);

    const typeLabel =
        params.type === 'BUY'
            ? 'Compra'
            : params.type === 'SELL'
                ? 'Venta'
                : params.type === 'DEPOSIT'
                    ? 'Depósito'
                    : 'Intercambio';

    const feeRow =
        Number(params.feeAmount) > 0
            ? `<tr><td style="padding:6px 0; color:#888;">Comisión</td>
           <td style="padding:6px 0; text-align:right;">${formatAmount(params.feeAmount, fromDecimals)} ${params.fromCurrency}</td></tr>`
            : `<tr><td style="padding:6px 0; color:#888;">Comisión</td>
           <td style="padding:6px 0; text-align:right;">Sin costo</td></tr>`;

    return {
        subject:
            params.type === 'DEPOSIT'
                ? 'Depósito confirmado — Neto Wallet'
                : `${typeLabel} confirmada — Neto Wallet`,
        body: layout(
            params.type === 'DEPOSIT'
                ? 'Depósito confirmado'
                : `${typeLabel} confirmada`,
            `<p style="font-size:14px; color:#444;">Hola ${name}, tu operación se completó.</p>
      <table style="width:100%; font-size:14px; color:#444; border-collapse:collapse;">
        <tr><td style="padding:6px 0; color:#888;">Enviaste</td>
            <td style="padding:6px 0; text-align:right;">${fromAmount} ${params.fromCurrency}</td></tr>
        <tr><td style="padding:6px 0; color:#888;">Recibiste</td>
            <td style="padding:6px 0; text-align:right;"><strong>${toAmount} ${params.toCurrency}</strong></td></tr>
        ${feeRow}
      </table>
      <p style="font-size:13px; color:#888; margin-top:16px;">
        Si no reconocés esta operación, ingresá a tu cuenta y revisá tu historial.
      </p>`
        ),
    };
}

/**
 * Envía un email y registra el intento en la tabla notifications.
 *
 * No lanza excepciones: un fallo de SES no debe interrumpir la operación que
 * disparó el envío. Devuelve true o false para que quien llame pueda decidir,
 * pero el registro del fallo ya queda persistido con su causa.
 */
export async function sendEmail(params: {
    userId: string | null;
    type: NotificationType;
    recipient: string;
    content: EmailContent;
}): Promise<boolean> {
    const notification = await notificationModel.create({
        userId: params.userId,
        type: params.type,
        recipient: params.recipient,
        subject: params.content.subject,
    });

    try {
        const result = await ses.send(
            new SendEmailCommand({
                Source: env.SES_FROM_EMAIL,
                Destination: { ToAddresses: [params.recipient] },
                Message: {
                    Subject: { Data: params.content.subject, Charset: 'UTF-8' },
                    Body: { Html: { Data: params.content.body, Charset: 'UTF-8' } },
                },
            })
        );

        await notificationModel.markAsSent(notification.id, result.MessageId ?? 'unknown');
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        console.error(`[email] Falló el envío de ${params.type} a ${params.recipient}:`, message);
        await notificationModel.markAsFailed(notification.id, message);

        return false;
    }
}