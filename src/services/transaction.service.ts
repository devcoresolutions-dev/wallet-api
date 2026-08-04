import type { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { AppError } from '../utils/AppError';

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

interface BuyParams {
  walletId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: Decimal; // lo que el usuario quiere gastar
  exchangeRate: Decimal;
  rateSource: string;
}

export interface TransactionSummary {
  id: string;
  type: 'BUY';
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

export interface BuyResult {
  transaction: TransactionSummary;
}

const FEE_RATE = new Decimal('0.005'); // 0.5%

export async function executeBuy(client: PoolClient, params: BuyParams): Promise<BuyResult> {
  const { walletId, fromCurrency, toCurrency, fromAmount, exchangeRate, rateSource } = params;

  // 1. Calcular comisión y monto neto
  const feeAmount = fromAmount.times(FEE_RATE);
  const netAmount = fromAmount.minus(feeAmount);
  const toAmount = netAmount.times(exchangeRate);
  const totalToDebit = fromAmount; // neto + comisión = fromAmount original

  // 2. Bloquear ambos balances (origen y destino)
  const fromBalance = await getBalanceForUpdate(client, walletId, fromCurrency);
  const toBalance = await getBalanceForUpdate(client, walletId, toCurrency);

  // 3. Crear el registro cabecera de la transacción
  const txResult = await client.query<{
    id: string;
    rate_fetched_at: Date;
    created_at: Date;
  }>(
    `INSERT INTO transactions
       (wallet_id, type, from_currency, to_currency, from_amount, to_amount,
        exchange_rate, fee_amount, fee_currency, fee_rate, rate_source,
        rate_fetched_at, status)
     VALUES ($1, 'BUY', $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'COMPLETED')
     RETURNING id, rate_fetched_at, created_at`,
    [
      walletId,
      fromCurrency,
      toCurrency,
      fromAmount.toFixed(8),
      toAmount.toFixed(8),
      exchangeRate.toFixed(8),
      feeAmount.toFixed(8),
      fromCurrency,
      FEE_RATE.toFixed(5),
      rateSource,
    ]
  );
  const transactionId = txResult.rows[0].id;
  const rateFetchedAt = txResult.rows[0].rate_fetched_at.toISOString();
  const createdAt = txResult.rows[0].created_at.toISOString();

  // 4. Descontar el balance de origen (neto + comisión)
  const fromBalanceAfter = await debitBalance(client, fromBalance, totalToDebit);

  // 5. Acreditar el balance de destino
  const toBalanceAfter = await creditBalance(client, toBalance, toAmount);

  // 6. Registrar los 3 movimientos del ledger
  await insertTransactionEntry(client, transactionId, fromBalance.id, 'DEBIT', 'PRINCIPAL', netAmount, fromBalanceAfter);
  await insertTransactionEntry(client, transactionId, fromBalance.id, 'DEBIT', 'FEE', feeAmount, fromBalanceAfter);
  await insertTransactionEntry(client, transactionId, toBalance.id, 'CREDIT', 'PRINCIPAL', toAmount, toBalanceAfter);

  return {
    transaction: {
      id: transactionId,
      type: 'BUY',
      status: 'COMPLETED',
      fromCurrency,
      toCurrency,
      fromAmount: fromAmount.toFixed(8),
      toAmount: toAmount.toFixed(8),
      feeAmount: feeAmount.toFixed(8),
      feeRate: FEE_RATE.toFixed(5),
      exchangeRate: exchangeRate.toFixed(8),
      rateSource,
      rateFetchedAt,
      createdAt,
    },
  };
}