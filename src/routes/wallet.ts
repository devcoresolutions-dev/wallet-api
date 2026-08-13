import { Router } from 'express';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { AppError } from '../utils/AppError';
import { authenticate } from '../middlewares/authenticate';
import { withTransaction } from '../config/database';
import * as walletModel from '../models/wallet.model';
import { assertCurrenciesActive } from '../models/currency.model';
import { executeDeposit } from '../services/transaction.service';
import * as userModel from '../models/user.model';
import * as emailService from '../services/email.service';

const router = Router();

const depositSchema = z.object({
  currency: z.string().length(3),
  amount: z.string().refine((value) => {
    try {
      return new Decimal(value).gt(0);
    } catch {
      return false;
    }
  }, { message: 'amount must be a positive decimal string' }),
});

router.get('/balances', authenticate, async (req, res) => {
  // La wallet se deriva del usuario autenticado, nunca de un parámetro: así
  // nadie puede pedir los balances de una wallet ajena conociendo su UUID.
  const wallet = await walletModel.findByUserId(req.userId as string);
  if (!wallet) {
    throw new AppError(404, 'WALLET_NOT_FOUND', 'No wallet found for the authenticated user');
  }

  const balances = await walletModel.findBalances(wallet.id);

  return res.json({
    walletId: wallet.id,
    balances: balances.map((balance) => ({
      currencyCode: balance.currency_code,
      currencyName: balance.currency_name,
      symbol: balance.symbol,
      decimals: balance.decimals,
      amount: balance.amount,
    })),
  });
});

/**
 * Acredita fondos en una moneda de la wallet del usuario autenticado.
 *
 * En una billetera real esto vendría de una transferencia o una tarjeta; acá
 * es una acreditación directa, para que un usuario nuevo pueda cargar saldo y
 * operar sin depender de que alguien le escriba la base a mano.
 */
router.post('/deposit', authenticate, async (req, res) => {
  const { currency, amount } = depositSchema.parse(req.body);
  const currencyCode = currency.toUpperCase();

  // Falla rápido con un 400 claro si la moneda no existe o está dada de baja,
  // en vez de dejar que el código inválido llegue hasta el INSERT.
  await assertCurrenciesActive([currencyCode]);

  const wallet = await walletModel.findByUserId(req.userId as string);
  if (!wallet) {
    throw new AppError(404, 'WALLET_NOT_FOUND', 'No wallet found for the authenticated user');
  }

  const depositResult = await withTransaction((client) =>
    executeDeposit(client, {
      walletId: wallet.id,
      currency: currencyCode,
      amount: new Decimal(amount),
    })
  );

  // El COMMIT ya terminó cuando llegamos acá.
  // Ahora sí consultamos el balance usando pool.query().
  const tx = depositResult.transaction;

  // El email se envía después del COMMIT.
  // Si SES falla, no afecta al depósito ya realizado.
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

  const balances = await walletModel.findBalances(wallet.id);

  return res.status(201).json({
    transaction: tx,
    balances: balances.map((balance) => ({
      currencyCode: balance.currency_code,
      currencyName: balance.currency_name,
      symbol: balance.symbol,
      decimals: balance.decimals,
      amount: balance.amount,
    })),
  });
});

export { router as walletRouter };
