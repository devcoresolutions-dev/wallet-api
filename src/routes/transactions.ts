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
  type ConversionParams,
  type ConversionResult,
} from '../services/transaction.service';
import { withTransaction } from '../config/database';
import { authenticate } from '../middlewares/authenticate';
import * as walletModel from '../models/wallet.model';
import { assertCurrenciesActive } from '../models/currency.model';

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

type ConversionExecutor = (
  client: PoolClient,
  params: ConversionParams
) => Promise<ConversionResult>;

/**
 * Da de alta una ruta de conversión (BUY/SELL/EXCHANGE). Las tres comparten
 * la misma validación, la misma resolución de wallet/tasa y, sobre todo, la
 * misma garantía de atomicidad: todo el trabajo (leer la tasa recién
 * obtenida, bloquear balances, insertar la cabecera, debitar, acreditar y
 * escribir el ledger) corre dentro de una única transacción SQL vía
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

    const result = await withTransaction(async (client) => {
      let exchangeRate: Decimal;
      try {
        exchangeRate = new Decimal(await getExchangeRate(baseCurrency, targetCurrency));
      } catch {
        throw new AppError(502, 'RATE_UNAVAILABLE', 'Could not fetch exchange rate at this time');
      }
      const conversionResult = await execute(client, {
        walletId,
        fromCurrency: baseCurrency,
        toCurrency: targetCurrency,
        fromAmount: new Decimal(fromAmount),
        exchangeRate,
        rateSource: 'frankfurter',
      });

      // Los balances actualizados se leen dentro de la misma transacción,
      // después de debitar/acreditar: reflejan el valor que se acaba de
      // escribir directamente en `balances`, no una suma del ledger.
      const balances = await getUpdatedBalances(client, walletId, [baseCurrency, targetCurrency]);

      return { conversionResult, balances };
    });

    return res.status(201).json({
      transaction: result.conversionResult.transaction,
      balances: result.balances,
    });
  });
}

registerConversionRoute('/buy', executeBuy);
registerConversionRoute('/sell', executeSell);
registerConversionRoute('/exchange', executeExchange);

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
