# Reglas de negocio

Define el comportamiento de las operaciones de la billetera. Complementa
`api-contract.md`, que define la forma de los datos.

⚠️ Todas las transacciones son simuladas. No se opera con dinero real y los
balances son ficticios.

---

## 1. Tipos de operación

| Tipo | Qué hace | ¿Modifica el patrimonio? |
|---|---|---|
| `BUY` | Compra una moneda debitando de otra del balance | Sí, por la comisión |
| `SELL` | Vende una moneda acreditando en otra | Sí, por la comisión |
| `EXCHANGE` | Convierte entre monedas de la misma cuenta | No |

La diferencia entre `EXCHANGE` y las otras dos es conceptual y viene de la
consigna: el intercambio reexpresa el valor de una moneda en otra sin alterar
el total que posee el usuario.

---

## 2. Comisiones

**Tasa: 0,5 %** (`0.00500`)

### Dónde se aplica

| Operación | Comisión |
|---|---|
| `BUY` | Sí |
| `SELL` | Sí |
| `EXCHANGE` | **No** |

El intercambio no cobra comisión porque, por definición, no debe modificar el
patrimonio total del usuario. Cobrarla lo modificaría y rompería la
funcionalidad obligatoria.

### Cómo se calcula

La comisión se descuenta de la **moneda de origen, antes de convertir**.

    monto ingresado:      1000.00 USD
    comisión (0.5%):         5.00 USD
    monto a convertir:     995.00 USD
    × tasa (1 USD = 1420.50 ARS)
    monto recibido:    1413397.50 ARS

### Persistencia

Cada transacción guarda tres campos:

| Campo | Contenido |
|---|---|
| `fee_amount` | Monto cobrado |
| `fee_currency` | Moneda en que se cobró (siempre la de origen) |
| `fee_rate` | Tasa aplicada — `0.00500` |

Se guarda `fee_rate` y no solo el monto para que, si la política de comisiones
cambia en el futuro, las transacciones históricas sigan reflejando la tasa que
efectivamente se les aplicó. Mismo criterio que con `exchange_rate`.

### Redondeo

Si la comisión calculada resulta menor a la unidad mínima de la moneda, se
redondea hacia arriba a esa unidad. Nunca se deja en cero por redondeo
silencioso: eso descuadraría los totales del ledger.

### Registro en el ledger

La comisión se registra como un `transaction_entry` independiente con
`entry_type = 'FEE'`, separado del movimiento principal (`PRINCIPAL`). Así el
asiento de doble entrada sigue cuadrando.

---

## 3. Validaciones previas

Ninguna operación se ejecuta sin verificar, **en este orden**:

1. **Monedas distintas** — origen y destino no pueden ser iguales
2. **Monedas activas** — ambas deben existir en `currencies` con `is_active = true`
3. **Monto positivo** — estrictamente mayor a cero
4. **Saldo suficiente** — el balance en la moneda de origen debe cubrir
   `monto + comisión`

Si alguna falla, la operación se rechaza sin tocar la base de datos.

### Errores correspondientes

| Validación | Código |
|---|---|
| Monedas iguales | `VALIDATION_ERROR` |
| Moneda inexistente o inactiva | `CURRENCY_NOT_FOUND` |
| Monto no positivo | `VALIDATION_ERROR` |
| Saldo insuficiente | `INSUFFICIENT_BALANCE` |

---

## 4. Precisión de montos

**En base de datos:** `NUMERIC(20,8)`. Nunca punto flotante.

**En las respuestas de la API:** string, nunca number. JavaScript no representa
decimales con precisión — `0.1 + 0.2` da `0.30000000000000004` — y eso es
inaceptable en una aplicación financiera.

**En los cálculos:** librería de precisión decimal, nunca aritmética nativa de
JavaScript.

Ocho decimales cubren cualquier moneda fiat con margen y permiten incorporar
criptomonedas sin cambiar el tipo de dato.

### Decimales por moneda

El campo `decimals` de la tabla `currencies` define cómo se **muestra** cada
moneda, no cómo se almacena. Internamente todas usan 8 decimales.

| Moneda | decimals |
|---|---|
| CLP | 0 |
| El resto | 2 |

---

## 5. Atomicidad

Toda operación financiera corre dentro de una transacción SQL, usando
`withTransaction` de `src/config/database.ts`.

Débito, crédito, escritura del ledger y actualización de balances se confirman
juntos o no se confirma ninguno. Un balance inconsistente por una falla parcial
no es un error aceptable, aun tratándose de dinero simulado.

---

## 6. Tasas de cambio

**Proveedor principal:** Frankfurter v2
**Fallback:** ExchangeRate-API

**Caché:** tabla `exchange_rates_cache` con TTL de 1 hora. Los bancos centrales
publican una vez por día, así que refrescar más seguido no aporta precisión.

### Comportamiento ante falla

1. Se intenta el proveedor de fallback
2. Si ambos fallan y existe una tasa cacheada de menos de 24 horas, se permite
   la operación **informando explícitamente al usuario la antigüedad del dato**
3. Si no hay dato válido, la operación se bloquea con `RATE_UNAVAILABLE`

**Bajo ninguna circunstancia se estiman o inventan tasas.**

Cada transacción persiste `exchange_rate`, `rate_source` y `rate_fetched_at`,
lo que permite reconstruir cualquier operación pasada.

---

## 7. Estados de transacción

| Estado | Significado |
|---|---|
| `PENDING` | Creada, aún no confirmada |
| `COMPLETED` | Ejecutada correctamente |
| `FAILED` | Falló durante la ejecución |

El email de confirmación se envía **después** del commit, no dentro de la
transacción. Una falla de AWS SES no debe revertir una operación válida; el
estado del envío se registra en la tabla `notifications` y permite reintentar.