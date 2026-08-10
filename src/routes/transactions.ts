import type { PoolClient } from 'pg';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { AppError } from '../utils/AppError';
import { getExchangeRate } from '../services/exchangeRate.service';
import { executeTransaction, listTransactions } from '../services/transaction.service';
import type { TransactionType } from '../services/transaction.service';
import { withTransaction } from '../config/database';
import { authenticate } from '../middlewares/authenticate';
import * as walletModel from '../models/wallet.model';

const router = Router();

const operationSchema = z.object({
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

/**
 * Las tres operaciones (comprar, vender, intercambiar) comparten el mismo
 * flujo: validar, derivar la wallet del token, cotizar y ejecutar dentro de
 * una transacción SQL. Lo único que cambia es el tipo, que determina la
 * comisión y la etiqueta del registro.
 *
 * Esta función genera el handler correspondiente a cada tipo.
 */
function makeOperationHandler(type: TransactionType) {
  return async (req: Request, res: Response) => {
    const { fromCurrency, toCurrency, fromAmount } = operationSchema.parse(req.body);

    const baseCurrency = fromCurrency.toUpperCase();
    const targetCurrency = toCurrency.toUpperCase();

    if (baseCurrency === targetCurrency) {
      throw new AppError(400, 'VALIDATION_ERROR', 'fromCurrency and toCurrency must be different');
    }

    // La wallet se deriva del usuario autenticado, nunca del body: así nadie
    // puede operar una wallet ajena aunque conozca su UUID.
    const wallet = await walletModel.findByUserId(req.userId as string);
    if (!wallet) {
      throw new AppError(404, 'WALLET_NOT_FOUND', 'No wallet found for the authenticated user');
    }
    const walletId = wallet.id;

    // La cotización se pide FUERA de la transacción SQL: si la API externa
    // tarda, no queremos mantener abierta una transacción ni retener una
    // conexión del pool mientras esperamos.
    const { rate, source } = await getExchangeRate(baseCurrency, targetCurrency);
    const exchangeRate = new Decimal(rate);

    const result = await withTransaction(async (client) => {
      const transactionResult = await executeTransaction(client, {
        walletId,
        type,
        fromCurrency: baseCurrency,
        toCurrency: targetCurrency,
        fromAmount: new Decimal(fromAmount),
        exchangeRate,
        rateSource: source,
      });

      const balances = await getUpdatedBalances(client, walletId, [baseCurrency, targetCurrency]);

      return { transactionResult, balances };
    });

    return res.status(201).json({
      transaction: result.transactionResult.transaction,
      balances: result.balances,
    });
  };
}

router.post('/buy', authenticate, makeOperationHandler('BUY'));
router.post('/sell', authenticate, makeOperationHandler('SELL'));
router.post('/exchange', authenticate, makeOperationHandler('EXCHANGE'));

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