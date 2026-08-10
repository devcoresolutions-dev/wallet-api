import { Router } from 'express';
import { z } from 'zod';
import { getExchangeRate } from '../services/exchangeRate.service';


const router = Router();

const currencyParamsSchema = z.object({
  base: z.string().length(3),
  target: z.string().length(3),
});

router.get('/:base/:target', async (req, res) => {
  const { base, target } = currencyParamsSchema.parse(req.params);

  const baseCurrency = base.toUpperCase();
  const targetCurrency = target.toUpperCase();

  // Ahora getExchangeRate devuelve el objeto RateResult completo
  const { rate, ageMinutes, source } = await getExchangeRate(baseCurrency, targetCurrency);

  return res.json({
    base: baseCurrency,
    target: targetCurrency,
    rate,
    rateAgeMinutes: ageMinutes,
    source
  });
});

export { router as ratesRouter };