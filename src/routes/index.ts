import { Router } from 'express';
import { authRoutes } from './auth.routes';
import { ratesRouter } from './rates';
import { transactionsRouter } from './transactions';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/rates', ratesRouter);
router.use('/transactions', transactionsRouter);