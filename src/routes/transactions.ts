import type { PoolClient } from 'pg';
import { Router } from 'express';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { AppError } from '../utils/AppError';
import { getExchangeRate } from '../services/exchangeRate.service';
import {
  executeBuy,
  executeExchange,
  executeSell,
  listTransactions,
  type ConversionParams,
  type ConversionResult,
} from '../services/transaction.service';
import { withTransaction } from '../config/database';
import { authenticate } from '../middlewares/authenticate';
import * as walletModel from '../models/wallet.model';
import { assertCurrenciesActive } from '../models/currency.model';
import * as userModel from '../models/user.model';
import * as emailService from '../services/email.service';

const router = Router();

const conversionSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  fromAmount: z.string().refine((value) => {
    try {
      return new Decimal(value).gt(0);
    } catch {
      return false;
    }
  }, { message: 'fromAmount must be a positive decimal string' }),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['BUY', 'SELL', 'EXCHANGE']).optional(),
  currency: z.string().length(3).optional(),
});

type ConversionExecutor = (
  client: PoolClient,
  params: ConversionParams
) => Promise<ConversionResult>;

/**
 * Da de alta una ruta de conversión (BUY/SELL/EXCHANGE). Las tres comparten
 * la misma validación, la misma resolución de wallet y la misma garantía de
 * atomicidad: bloquear balances, insertar la cabecera, debitar, acreditar y
 * escribir el ledger corren dentro de una única transacción SQL vía
 * `withTransaction` — o se confirma todo, o no se confirma nada.
 */
function registerConversionRoute(path: string, execute: ConversionExecutor): void {
  router.post(path, authenticate, async (req, res) => {
    const { fromCurrency, toCurrency, fromAmount } = conversionSchema.parse(req.body);

    const baseCurrency = fromCurrency.toUpperCase();
    const targetCurrency = toCurrency.toUpperCase();

    if (baseCurrency === targetCurrency) {
      throw new AppError(400, 'VALIDATION_ERROR', 'fromCurrency and toCurrency must be different');
    }

    // Falla rápido y con un 400 claro si el cliente mandó un código que no
    // existe o que dimos de baja, en vez de dejar que el typo llegue crudo
    // hasta Frankfurter o hasta un INSERT/UPDATE contra la DB.
    await assertCurrenciesActive([baseCurrency, targetCurrency]);

    // walletId se deriva del usuario autenticado, nunca del body: así nadie
    // puede operar una wallet ajena aunque conozca su UUID.
    const wallet = await walletModel.findByUserId(req.userId as string);
    if (!wallet) {
      throw new AppError(404, 'WALLET_NOT_FOUND', 'No wallet found for the authenticated user');
    }
    const walletId = wallet.id;

    // La cotización se pide fuera de la transacción SQL: si la API externa
    // tarda, no queremos mantener abierta una transacción reteniendo una
    // conexión del pool ni los locks de los balances.
    //
    // El rate viene como string desde el service: construir el Decimal
    // directamente desde ahí evita degradar el NUMERIC(20,8) al punto
    // flotante de JavaScript. El source es dinámico — puede ser el proveedor
    // principal o el de respaldo, según cuál respondió.
    const { rate, source } = await getExchangeRate(baseCurrency, targetCurrency);
    const exchangeRate = new Decimal(rate);

    const result = await withTransaction(async (client) => {
      const conversionResult = await execute(client, {
        walletId,
        fromCurrency: baseCurrency,
        toCurrency: targetCurrency,
        fromAmount: new Decimal(fromAmount),
        exchangeRate,
        rateSource: source,
      });

      // Los balances actualizados se leen dentro de la misma transacción,
      // después de debitar/acreditar: reflejan el valor que se acaba de
      // escribir directamente en `balances`, no una suma del ledger.
      const balances = await getUpdatedBalances(client, walletId, [baseCurrency, targetCurrency]);

      return { conversionResult, balances };
    });

    const tx = result.conversionResult.transaction;

    // El email va después de que la transacción SQL se confirmó y sin await:
    // la operación financiera ya está hecha, así que una demora o una caída de
    // SES no debe hacer esperar al usuario ni afectar el resultado.
    void (async () => {
      const user = await userModel.findById(req.userId as string);
      if (!user) return;

      await emailService.sendEmail({
        userId: user.id,
        type: 'TRANSACTION_CONFIRMATION',
        recipient: user.email,
        content: await emailService.transactionEmail({
          fullName: user.full_name,
          type: tx.type,
          fromAmount: tx.fromAmount,
          fromCurrency: tx.fromCurrency,
          toAmount: tx.toAmount,
          toCurrency: tx.toCurrency,
          feeAmount: tx.feeAmount,
        }),
      });
    })();

    return res.status(201).json({
      transaction: tx,
      balances: result.balances,
    });
  });
}

registerConversionRoute('/buy', executeBuy);
registerConversionRoute('/sell', executeSell);
registerConversionRoute('/exchange', executeExchange);

router.get('/', authenticate, async (req, res) => {
  const { page, limit, type, currency } = listQuerySchema.parse(req.query);

  const wallet = await walletModel.findByUserId(req.userId as string);
  if (!wallet) {
    throw new AppError(404, 'WALLET_NOT_FOUND', 'No wallet found for the authenticated user');
  }

  const result = await listTransactions(wallet.id, {
    page,
    limit,
    type,
    currency: currency?.toUpperCase(),
  });

  return res.json(result);
});

async function getUpdatedBalances(
  client: PoolClient,
  walletId: string,
  currencyCodes: string[]
): Promise<Array<{ currencyCode: string; amount: string }>> {
  const result = await client.query<{ currency_code: string; amount: string }>(
    `SELECT currency_code, amount
     FROM balances
     WHERE wallet_id = $1 AND currency_code = ANY($2)
     ORDER BY currency_code`,
    [walletId, currencyCodes]
  );

  return result.rows.map((row) => ({
    currencyCode: row.currency_code,
    amount: row.amount,
  }));
}

export { router as transactionsRouter };