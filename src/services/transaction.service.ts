import type { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { AppError } from '../utils/AppError';
import { getDecimals } from '../models/currency.model';

interface Balance {
  id: string;
  amount: string; // pg devuelve NUMERIC como string para no perder precisión
}

/**
 * Busca el balance de una wallet en una moneda específica y lo bloquea
 * (FOR UPDATE) hasta que termine la transacción SQL actual.
 * Esto evita que dos operaciones simultáneas lean el mismo saldo
 * antes de que la primera lo haya descontado (race condition).
 */
export async function getBalanceForUpdate(
  client: PoolClient,
  walletId: string,
  currencyCode: string
): Promise<Balance> {
  const result = await client.query<Balance>(
    `SELECT id, amount
     FROM balances
     WHERE wallet_id = $1 AND currency_code = $2
     FOR UPDATE`,
    [walletId, currencyCode]
  );

  if (result.rows.length === 0) {
    throw new AppError(
      404,
      'BALANCE_NOT_FOUND',
      `No balance found for currency ${currencyCode}`
    );
  }

  return result.rows[0];
}

/**
 * Valida que el balance alcance para cubrir el monto + comisión,
 * y lo descuenta. Debe llamarse dentro de una transacción (client),
 * después de getBalanceForUpdate para asegurar el lock.
 */
export async function debitBalance(
  client: PoolClient,
  balance: Balance,
  totalToDebit: Decimal
): Promise<string> {
  const currentAmount = new Decimal(balance.amount);

  if (currentAmount.lessThan(totalToDebit)) {
    throw new AppError(
      400,
      'INSUFFICIENT_BALANCE',
      `Insufficient balance: have ${currentAmount}, need ${totalToDebit}`
    );
  }

  const newAmount = currentAmount.minus(totalToDebit);

  await client.query(
    `UPDATE balances SET amount = $1 WHERE id = $2`,
    [newAmount.toFixed(8), balance.id]
  );

  return newAmount.toFixed(8);
}

/**
 * Acredita un monto al balance de destino. No valida saldo
 * (a un balance siempre se le puede sumar). Debe llamarse dentro
 * de una transacción, después de getBalanceForUpdate para el lock.
 */
export async function creditBalance(
  client: PoolClient,
  balance: Balance,
  amountToCredit: Decimal
): Promise<string> {
  const currentAmount = new Decimal(balance.amount);
  const newAmount = currentAmount.plus(amountToCredit);

  await client.query(
    `UPDATE balances SET amount = $1 WHERE id = $2`,
    [newAmount.toFixed(8), balance.id]
  );

  return newAmount.toFixed(8);
}

/**
 * Inserta un movimiento del ledger (transaction_entries).
 * Cada transacción genera varios de estos: débito de origen,
 * débito de la comisión, crédito de destino.
 */
export async function insertTransactionEntry(
  client: PoolClient,
  transactionId: string,
  balanceId: string,
  direction: 'DEBIT' | 'CREDIT',
  entryType: 'PRINCIPAL' | 'FEE',
  amount: Decimal,
  balanceAfter: string
): Promise<void> {
  await client.query(
    `INSERT INTO transaction_entries
       (transaction_id, balance_id, direction, entry_type, amount, balance_after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [transactionId, balanceId, direction, entryType, amount.toFixed(8), balanceAfter]
  );
}

export interface ConversionParams {
  walletId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: Decimal; // lo que el usuario quiere gastar / convertir
  exchangeRate: Decimal;
  rateSource: string;
}

export type TransactionType = 'BUY' | 'SELL' | 'EXCHANGE';

export interface TransactionSummary {
  id: string;
  type: TransactionType;
  status: 'COMPLETED';
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string;
  toAmount: string;
  feeAmount: string;
  feeRate: string;
  exchangeRate: string;
  rateSource: string;
  rateFetchedAt: string;
  createdAt: string;
}

export interface ConversionResult {
  transaction: TransactionSummary;
}

const FEE_RATE = new Decimal('0.005'); // 0.5%
const NO_FEE = new Decimal(0);

/**
 * Tipos que cobran comisión. EXCHANGE queda afuera a propósito: por
 * definición no debe alterar el patrimonio total del usuario (ver
 * business-rules.md, sección 1 y 2).
 */
function chargesFee(type: TransactionType): boolean {
  return type === 'BUY' || type === 'SELL';
}

/**
 * Calcula la comisión (0.5%) sobre el monto de origen y la redondea
 * hacia arriba a la unidad mínima de esa moneda (`decimals`). Nunca la
 * deja en cero por redondeo silencioso: eso descuadraría el ledger
 * (business-rules.md, sección 2, "Redondeo").
 */
function calculateFee(amount: Decimal, decimals: number): Decimal {
  const rawFee = amount.times(FEE_RATE);
  if (rawFee.isZero()) {
    return rawFee;
  }
  return rawFee.toDecimalPlaces(decimals, Decimal.ROUND_UP);
}

async function executeConversion(
  client: PoolClient,
  type: TransactionType,
  params: ConversionParams
): Promise<ConversionResult> {
  const { walletId, fromCurrency, toCurrency, fromAmount, exchangeRate, rateSource } = params;
  const applyFee = chargesFee(type);

  // 1. Calcular comisión (0 para EXCHANGE) y monto neto a convertir
  let feeAmount = NO_FEE;
  if (applyFee) {
    const fromDecimals = await getDecimals(client, fromCurrency);
    feeAmount = calculateFee(fromAmount, fromDecimals);
  }
  const netAmount = fromAmount.minus(feeAmount);
  const toAmount = netAmount.times(exchangeRate);
  const totalToDebit = fromAmount; // neto + comisión (si la hay) = fromAmount original

  // 2. Bloquear ambos balances, siempre en el mismo orden alfabético.
  //    Si dos operaciones cruzadas sobre el mismo par (USD→EUR y EUR→USD)
  //    tomaran los locks en orden distinto, cada una quedaría esperando el
  //    que tiene la otra: deadlock. Con un orden fijo, la segunda espera a
  //    que la primera termine.
  const [firstCurrency] = [fromCurrency, toCurrency].sort();
  const secondCurrency = firstCurrency === fromCurrency ? toCurrency : fromCurrency;

  const firstBalance = await getBalanceForUpdate(client, walletId, firstCurrency);
  const secondBalance = await getBalanceForUpdate(client, walletId, secondCurrency);

  const fromBalance = firstCurrency === fromCurrency ? firstBalance : secondBalance;
  const toBalance = firstCurrency === fromCurrency ? secondBalance : firstBalance;

  // 3. Crear el registro cabecera de la transacción
  const feeRate = applyFee ? FEE_RATE : NO_FEE;
  const feeCurrency = applyFee ? fromCurrency : null;

  const txResult = await client.query<{
    id: string;
    rate_fetched_at: Date;
    created_at: Date;
  }>(
    `INSERT INTO transactions
       (wallet_id, type, from_currency, to_currency, from_amount, to_amount,
        exchange_rate, fee_amount, fee_currency, fee_rate, rate_source,
        rate_fetched_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 'COMPLETED')
     RETURNING id, rate_fetched_at, created_at`,
    [
      walletId,
      type,
      fromCurrency,
      toCurrency,
      fromAmount.toFixed(8),
      toAmount.toFixed(8),
      exchangeRate.toFixed(8),
      feeAmount.toFixed(8),
      feeCurrency,
      feeRate.toFixed(5),
      rateSource,
    ]
  );
  const transactionId = txResult.rows[0].id;
  const rateFetchedAt = txResult.rows[0].rate_fetched_at.toISOString();
  const createdAt = txResult.rows[0].created_at.toISOString();

  // 4. Descontar el balance de origen (neto + comisión, si la hay)
  const fromBalanceAfter = await debitBalance(client, fromBalance, totalToDebit);

  // 5. Acreditar el balance de destino
  const toBalanceAfter = await creditBalance(client, toBalance, toAmount);

  // 6. Registrar los movimientos del ledger. La entrada de FEE se omite
  //    cuando no hay comisión (EXCHANGE): un monto en cero violaría el
  //    CHECK (amount > 0) de transaction_entries, y conceptualmente no
  //    hubo ningún movimiento de comisión que registrar.
  await insertTransactionEntry(
    client,
    transactionId,
    fromBalance.id,
    'DEBIT',
    'PRINCIPAL',
    netAmount,
    fromBalanceAfter
  );
  if (feeAmount.greaterThan(0)) {
    await insertTransactionEntry(
      client,
      transactionId,
      fromBalance.id,
      'DEBIT',
      'FEE',
      feeAmount,
      fromBalanceAfter
    );
  }
  await insertTransactionEntry(
    client,
    transactionId,
    toBalance.id,
    'CREDIT',
    'PRINCIPAL',
    toAmount,
    toBalanceAfter
  );

  return {
    transaction: {
      id: transactionId,
      type,
      status: 'COMPLETED',
      fromCurrency,
      toCurrency,
      fromAmount: fromAmount.toFixed(8),
      toAmount: toAmount.toFixed(8),
      feeAmount: feeAmount.toFixed(8),
      feeRate: feeRate.toFixed(5),
      exchangeRate: exchangeRate.toFixed(8),
      rateSource,
      rateFetchedAt,
      createdAt,
    },
  };
}

/** Compra: debita `fromAmount` (neto + comisión) y acredita `toAmount`. */
export async function executeBuy(
  client: PoolClient,
  params: ConversionParams
): Promise<ConversionResult> {
  return executeConversion(client, 'BUY', params);
}

/** Venta: misma mecánica que BUY (comisión 0.5% sobre la moneda de origen). */
export async function executeSell(
  client: PoolClient,
  params: ConversionParams
): Promise<ConversionResult> {
  return executeConversion(client, 'SELL', params);
}

/**
 * Intercambio entre monedas de la misma cuenta: sin comisión, reexpresa
 * el valor de una moneda en otra sin alterar el patrimonio total del
 * usuario (toAmount = fromAmount * exchangeRate, exacto).
 */
export async function executeExchange(
  client: PoolClient,
  params: ConversionParams
): Promise<ConversionResult> {
  return executeConversion(client, 'EXCHANGE', params);
}