import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { ratesRouter } from './rates';
import { transactionsRouter } from './transactions';
import { currenciesRouter } from './currencies';
import { walletRouter } from './wallet';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/rates', ratesRouter);
router.use('/transactions', transactionsRouter);
router.use('/currencies', currenciesRouter);
router.use('/wallet', walletRouter);