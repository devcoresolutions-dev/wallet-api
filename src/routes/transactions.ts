import type { PoolClient } from 'pg';
import { Router } from 'express';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { AppError } from '../utils/AppError';
import { getExchangeRate } from '../services/exchangeRate.service';
import { executeBuy } from '../services/transaction.service';
import { withTransaction } from '../config/database';

const router = Router();

const buySchema = z.object({
  walletId: z.string().uuid(),
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

router.post('/buy', async (req, res) => {
  const { walletId, fromCurrency, toCurrency, fromAmount } = buySchema.parse(req.body);

  const baseCurrency = fromCurrency.toUpperCase();
  const targetCurrency = toCurrency.toUpperCase();

  if (baseCurrency === targetCurrency) {
    throw new AppError(400, 'VALIDATION_ERROR', 'fromCurrency and toCurrency must be different');
  }

  const transactionResult = await withTransaction(async (client) => {
    const exchangeRate = new Decimal(await getExchangeRate(baseCurrency, targetCurrency));
    const buyResult = await executeBuy(client, {
      walletId,
      fromCurrency: baseCurrency,
      toCurrency: targetCurrency,
      fromAmount: new Decimal(fromAmount),
      exchangeRate,
      rateSource: 'frankfurter',
    });

    const balances = await getUpdatedBalances(client, walletId, [baseCurrency, targetCurrency]);

    return { buyResult, balances };
  });

  return res.status(201).json({
    transaction: transactionResult.buyResult.transaction,
    balances: transactionResult.balances,
  });
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