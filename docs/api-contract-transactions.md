# Contrato de la API — Transacciones y chatbot

Complementa `api-contract.md`. Aplican las mismas convenciones de autenticación
y formato de error.

Todos los endpoints de esta sección requieren token.

## Reglas de negocio aplicables

- **Comisión del 0,5 %** sobre compra y venta, descontada de la moneda de origen
  antes de aplicar la conversión.
- **El intercambio no cobra comisión**: por definición no debe modificar el
  patrimonio total del usuario.
- Todos los montos viajan como **string**, nunca como number.
- Validaciones previas a cualquier operación: saldo suficiente, monto
  estrictamente positivo, monedas origen y destino distintas y ambas activas.

---

## 1. Cotizar operación (simulador)

    POST /api/transactions/quote

Devuelve el resultado de una operación **sin ejecutarla**. Es lo que alimenta el
simulador previo a la confirmación.

### Body

    {
      "type": "BUY",
      "fromCurrency": "ARS",
      "toCurrency": "USD",
      "fromAmount": "150000.00"
    }

`type` acepta `BUY`, `SELL` o `EXCHANGE`.

### Respuesta 200

    {
      "type": "BUY",
      "fromCurrency": "ARS",
      "toCurrency": "USD",
      "fromAmount": "150000.00000000",
      "feeAmount": "750.00000000",
      "feeRate": "0.00500",
      "netAmount": "149250.00000000",
      "exchangeRate": "0.00070400",
      "toAmount": "10.50720000",
      "rateSource": "frankfurter",
      "rateFetchedAt": "2026-07-31T14:32:00.000Z",
      "rateAgeMinutes": 12
    }

`netAmount` es lo que efectivamente se convierte (`fromAmount` menos la comisión).
En operaciones `EXCHANGE`, `feeAmount` es `"0.00000000"`.

### Errores

| HTTP | error | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Monto no positivo, monedas iguales, tipo inválido |
| 400 | `INSUFFICIENT_BALANCE` | Saldo insuficiente en la moneda origen |
| 404 | `CURRENCY_NOT_FOUND` | Alguna moneda no existe o está inactiva |
| 503 | `RATE_UNAVAILABLE` | No hay tasa disponible ni en caché ni en las APIs |

**Sobre `rateAgeMinutes`:** indica la antigüedad del dato. Si supera los 60
minutos, el frontend debe advertir al usuario que la cotización puede no estar
actualizada. Si ambas APIs fallan y no hay caché válido, la operación se bloquea
con `RATE_UNAVAILABLE` — nunca se estiman tasas.

---

## 2. Comprar moneda

    POST /api/transactions/buy

Ejecuta la operación. Debita de la moneda origen y acredita en la destino.

### Body

    {
      "fromCurrency": "ARS",
      "toCurrency": "USD",
      "fromAmount": "150000.00"
    }

### Respuesta 201

    {
      "transaction": {
        "id": "9f2b1c44-8e7a-4d3f-b021-5c8e9a1f7d33",
        "type": "BUY",
        "status": "COMPLETED",
        "fromCurrency": "ARS",
        "toCurrency": "USD",
        "fromAmount": "150000.00000000",
        "toAmount": "10.50720000",
        "feeAmount": "750.00000000",
        "feeRate": "0.00500",
        "exchangeRate": "0.00070400",
        "rateSource": "frankfurter",
        "createdAt": "2026-07-31T14:32:05.000Z"
      },
      "balances": [
        { "currencyCode": "ARS", "amount": "50000.00000000" },
        { "currencyCode": "USD", "amount": "10.50720000" }
      ]
    }

`balances` devuelve **solo las monedas afectadas**, con su saldo actualizado. Así
el frontend refresca el dashboard sin pedir los balances de nuevo.

### Errores

Los mismos que `/quote`, más:

| HTTP | error | Cuándo |
|---|---|---|
| 409 | `RATE_CHANGED` | La tasa cambió respecto de la cotización mostrada |

---

## 3. Vender moneda

    POST /api/transactions/sell

Misma estructura de body y respuesta que `/buy`, con `type: "SELL"`.

---

## 4. Intercambiar monedas

    POST /api/transactions/exchange

Misma estructura, con `type: "EXCHANGE"` y **sin comisión**: `feeAmount` siempre
es `"0.00000000"` y `feeRate` es `"0.00000"`.

---

## 5. Historial de transacciones

    GET /api/transactions

### Query params

| Param | Tipo | Default | Descripción |
|---|---|---|---|
| `page` | number | 1 | Página |
| `limit` | number | 20 | Resultados por página (máx. 100) |
| `type` | string | — | Filtrar por `BUY`, `SELL` o `EXCHANGE` |
| `currency` | string | — | Filtrar por moneda (origen o destino) |

### Respuesta 200

    {
      "transactions": [
        {
          "id": "9f2b1c44-8e7a-4d3f-b021-5c8e9a1f7d33",
          "type": "BUY",
          "status": "COMPLETED",
          "fromCurrency": "ARS",
          "toCurrency": "USD",
          "fromAmount": "150000.00000000",
          "toAmount": "10.50720000",
          "feeAmount": "750.00000000",
          "exchangeRate": "0.00070400",
          "createdAt": "2026-07-31T14:32:05.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "total": 47,
        "totalPages": 3
      }
    }

Ordenado por `createdAt` descendente.

---

## 6. Chatbot

    POST /api/chat

Proxy hacia Gemini. La API key nunca se expone al cliente.

### Body

    {
      "message": "¿cuánto tengo en dólares?",
      "history": [
        { "role": "user",      "content": "hola" },
        { "role": "assistant", "content": "Hola, ¿en qué te puedo ayudar?" }
      ]
    }

`history` es opcional. Máximo 10 mensajes; si se envían más, el backend recorta
los más antiguos.

### Respuesta 200

    {
      "reply": "Tenés 10,51 USD en tu cuenta. Es tu tercer saldo más alto."
    }

### Errores

| HTTP | error | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Mensaje vacío o de más de 500 caracteres |
| 429 | `RATE_LIMIT_EXCEEDED` | Más de 20 mensajes por minuto |
| 503 | `AI_UNAVAILABLE` | Gemini no responde |

### Alcance del chatbot

El chatbot es **estrictamente de solo lectura**. No ejecuta operaciones. Toda
transacción se confirma exclusivamente desde la interfaz.

El backend arma el contexto que se envía al modelo: balances actuales, últimas 20
transacciones y tasas vigentes en caché. Los datos sensibles (hash de contraseña,
identificadores internos, email) nunca se incluyen.

La respuesta se renderiza como **texto plano**, sin HTML ni markdown activo, para
evitar XSS derivado del modelo.

---

## Estado de implementación

| Endpoint | Estado | Responsable |
|---|---|---|
| `POST /api/transactions/quote` | ⏳ Pendiente | — |
| `POST /api/transactions/buy` | ⏳ Pendiente | Andrés |
| `POST /api/transactions/sell` | ⏳ Pendiente | Juampi |
| `POST /api/transactions/exchange` | ⏳ Pendiente | Juampi |
| `GET /api/transactions` | ⏳ Pendiente | — |
| `POST /api/chat` | ⏳ Pendiente | Juampi |