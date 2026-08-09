import { Router } from 'express';
import { AppError } from '../utils/AppError';
import { authenticate } from '../middlewares/authenticate';
import * as walletModel from '../models/wallet.model';

const router = Router();

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

export { router as walletRouter };
