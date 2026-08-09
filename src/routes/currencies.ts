import { Router } from 'express';
import * as currencyModel from '../models/currency.model';

const router = Router();

router.get('/', async (_req, res) => {
  const currencies = await currencyModel.findAllActive();

  return res.json({
    currencies: currencies.map((currency) => ({
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol,
      decimals: currency.decimals,
    })),
  });
});

export { router as currenciesRouter };
