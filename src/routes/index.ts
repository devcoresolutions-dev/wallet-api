import { Router } from 'express';
import { authRouter } from './auth';
import { ratesRouter } from './rates';
import { transactionsRouter } from './transactions';

export const router = Router();
router.use('/auth', authRouter);
router.use('/rates', ratesRouter);
router.use('/transactions', transactionsRouter);

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});