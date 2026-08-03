import { Router } from 'express';
import { z } from 'zod';
import { getExchangeRate } from '../services/exchangeRate.service';
import { AppError } from '../utils/AppError';

const router = Router();

const currencyParamsSchema = z.object({
  base: z.string().length(3),
  target: z.string().length(3),
});

router.get('/:base/:target', async (req, res) => {
  const { base, target } = currencyParamsSchema.parse(req.params);

  const baseCurrency = base.toUpperCase();
  const targetCurrency = target.toUpperCase();

  try {
    const rate = await getExchangeRate(baseCurrency, targetCurrency);
    return res.json({ base: baseCurrency, target: targetCurrency, rate });
  } catch {
    throw new AppError(
      502,
      'RATE_UNAVAILABLE',
      'Could not fetch exchange rate at this time'
    );
  }
});

export { router as ratesRouter };