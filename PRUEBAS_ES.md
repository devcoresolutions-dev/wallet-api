# Reporte de pruebas — API de `wallet-api`

Fecha: 2026-08-07
Alcance: los 8 endpoints existentes bajo `/api`, probados contra el
servidor local (`npm run dev`) conectado a la base de datos real de
Supabase configurada en `.env`.

## Cómo se probó

Para cada endpoint: caso feliz, casos de error esperados (validación,
auth, datos inexistentes) y algún caso borde. Cuando hacía falta un
usuario con saldo (para `buy`/`sell`/`exchange`, que arrancan en 0), se
acreditó saldo directo en la tabla `balances` vía script. Todos los
usuarios de prueba se borraron de la DB al terminar cada ronda —no
quedan datos de prueba residuales.

## Resultado por endpoint

| Endpoint | Casos probados | Estado |
|---|---|---|
| `GET /api/health` | básico | ✅ OK |
| `POST /api/auth/register` | éxito, email duplicado (409), password corto (400) | ✅ OK |
| `POST /api/auth/login` | éxito, password incorrecto, email inexistente, usuario demo | ✅ OK (mismo error para email/password inválidos, correcto contra enumeración) |
| `GET /api/auth/me` | con token, sin token, token inválido, header sin `Bearer` | ✅ OK |
| `GET /api/rates/:base/:target` | par válido, minúsculas, código de 2 letras (400), par inexistente (502) | ✅ OK |
| `POST /api/transactions/buy` | sin fondos, sin token, misma moneda, monto negativo, con fondos reales | ✅ OK |
| `POST /api/transactions/sell` | sin fondos, con fondos reales | ✅ OK |
| `POST /api/transactions/exchange` | con fondos reales | 🔴 → ✅ **Tenía un bug crítico, arreglado (ver abajo)** |

Casos transversales: ruta inexistente → `404`; endpoints del contrato
viejo `GET /api/currencies` y `GET /api/wallet/balances` → `404` (no
están implementados, ver "Pendientes" al final).

## Errores encontrados y solución

### 1. `POST /transactions/exchange` fallaba siempre — 500 (crítico)

**Síntoma:** cualquier llamada, con o sin saldo, con cualquier par de
monedas, devolvía `500 INTERNAL_ERROR`.

**Causa raíz:** drift entre el código y el esquema real de la base.
`transaction.service.ts` inserta `fee_currency = NULL` a propósito para
`EXCHANGE` (no cobra comisión). La migración `004_create_transactions.sql`
define esa columna como nullable, pero la tabla ya existente en Supabase
había quedado creada con `NOT NULL` desde una versión anterior de ese
mismo archivo. Como el runner de migraciones usa
`CREATE TABLE IF NOT EXISTS`, el cambio posterior en el `.sql` nunca se
volvió a aplicar contra la tabla real.

```
error: null value in column "fee_currency" of relation "transactions"
violates not-null constraint
```

**Solución:** migración nueva `006_fix_fee_currency_nullable.sql`:

```sql
ALTER TABLE transactions ALTER COLUMN fee_currency DROP NOT NULL;
```

(se agregó como migración nueva, no editando `004`, porque esa ya corrió
y editarla no tiene efecto sobre la tabla existente).

**Verificación:** se corrió `npm run migrate` contra la DB real, se
confirmó `is_nullable = YES` en `information_schema.columns`, y se
repitió la prueba end-to-end (`USD → ARS`, con saldo) tres veces en
sesiones distintas: siempre `201 Created`, `feeAmount: "0.00000000"`,
balances correctos.

**Commit:** `fix(db): make fee_currency nullable to unblock EXCHANGE transactions`

### 2. Moneda inexistente en `/transactions/*` devolvía 500 en vez de 400

**Síntoma:** `POST /transactions/buy` con `fromCurrency: "ZZZ"` (o
cualquier código que no existe en la tabla `currencies`) devolvía
`500 INTERNAL_ERROR` en vez de un error de validación.

**Causa raíz:** en `routes/transactions.ts`, `getExchangeRate()` se
llamaba sin `try/catch` (a diferencia de `routes/rates.ts`, que sí lo
envuelve). Frankfurter rechaza el código con `422`, ese error subía
crudo hasta el `errorHandler` genérico.

**Solución:**
- `currency.model.ts`: nueva `assertCurrenciesActive(codes)` — valida
  contra la tabla `currencies` (existe y `is_active = true`) y lanza
  `400 INVALID_CURRENCY` si algún código no es válido.
- `transactions.ts`: se llama antes de resolver la wallet o pedir la
  tasa (falla rápido, sin gastar una llamada externa ni abrir
  transacción SQL). Además se envolvió `getExchangeRate` en
  `try/catch`, igual que en `rates.ts`, para que cualquier otra falla
  del proveedor de tasas responda `502 RATE_UNAVAILABLE` en vez de 500.

**Verificación:** `npx tsc --noEmit` limpio, `npm test` 28/28 en verde,
y contra el servidor real: `ZZZ`/`QQQ` en `buy`, `sell` y `exchange`
ahora dan `400 INVALID_CURRENCY`; los pares válidos con fondos siguen
respondiendo `201` sin cambios.

**Commit:** `fix(transactions): reject unknown currency codes with 400 instead of 500`

## Pendientes (no bloquean nada, quedan para después)

No se tocaron en esta ronda — quedan documentados para decidir prioridad:

- **No hay forma de fondear una wallet.** Usuarios nuevos (y el demo del
  seed) arrancan en 0 en las 8 monedas; no existe un endpoint de
  depósito. Sin eso, nadie puede probar `buy`/`sell`/`exchange` sin
  tocar la DB a mano.
- **`docs/api-contract.md` desactualizado.** Documenta `GET /api/currencies`
  y `GET /api/wallet/balances`, que no existen (dan 404), y no documenta
  los que sí existen (`/rates`, `/transactions/*`).
- **`GET /api/auth/me` devuelve solo `{ userId }`.** El resto de la app
  (register/login) devuelve `{ id, email, fullName }`.
- **`FRANKFURTER_API_URL` (env var) no se usa.** `exchangeRate.service.ts`
  hardcodea la URL en vez de leer `env.FRANKFURTER_API_URL`.
- **`.env` local no usa el Session pooler** que el propio README pide
  usar siempre (apunta a conexión directa `db.<proyecto>.supabase.co`).
- **Sin tests de integración contra la DB real.** Los 28 tests actuales
  mockean la base — por eso el bug #1 (drift de esquema) no se detectó
  ahí. Al menos un test de integración liviano para `transactions`
  hubiera atrapado esto antes.

## Comandos usados (para repetir la verificación)

```bash
npm run migrate          # aplica migraciones pendientes contra DATABASE_URL
npm run dev               # levanta el servidor en :3000
npx tsc --noEmit          # chequeo de tipos
npm run lint               # eslint (1 error preexistente en errorHandler.ts, no relacionado)
npm test                   # 28 tests unitarios (mockeados, no tocan la DB real)
curl -i http://localhost:3000/api/health
```
