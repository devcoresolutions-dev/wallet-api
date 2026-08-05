# API de tasas de cambio — Frankfurter v2

Proveedor principal de cotizaciones del proyecto.

    Base URL: https://api.frankfurter.dev/v2

Sin API key. Sin límite de requests.

## Por qué Frankfurter

- Gratuita y sin límite de requests: elimina el riesgo de agotar cuota durante
  el desarrollo o en la demo. Las alternativas recomendadas tienen tope mensual
  (ExchangeRate-API: 1500/mes, Currency Freaks: 1000/mes).
- Datos de bancos centrales, fuente institucional verificable.
- Incluye series históricas, lo que habilita el gráfico de evolución de tasas
  sin integrar un segundo proveedor.
- No requiere credenciales: simplifica el setup del equipo.

⚠️ **Hay que usar la v2.** La v1 se basa exclusivamente en el Banco Central
Europeo, que no cotiza ARS, CLP, COP ni PEN.

## Endpoints

| Endpoint | Devuelve | Uso en el proyecto |
|---|---|---|
| `/rate/{base}/{quote}` | Objeto único | Cotizar una operación |
| `/rates?base=X&quotes=A,B` | Array | Refrescar el caché |
| `/rates?from=YYYY-MM-DD` | Array (serie) | Gráfico de historial |
| `/currencies` | Array | Metadata de monedas |
| `/providers` | Array | Fuentes disponibles |

⚠️ El parámetro de monedas destino es `quotes`, no `symbols`. Y el endpoint es
`/rates`, no `/latest` — eso era la v1.

---

## Verificación realizada — 31/07/2026

Probado con Postman. Colección `Frankfurter API`.

### 1. Par puntual

    GET /v2/rate/USD/ARS
    → 200 OK · 818 ms

```json
{"date":"2026-07-31","base":"USD","quote":"ARS","rate":1488.97}
```

Objeto único, fecha del día. Es el endpoint indicado para cotizar una
operación: una sola llamada, sin array que recorrer.

### 2. Cruce entre monedas latinoamericanas

    GET /v2/rate/ARS/BRL

```json
{"date":"2026-07-31","base":"ARS","quote":"BRL","rate":0.00341}
```

**Funciona sin moneda pivote.** Se puede convertir entre cualquier par de las
8 monedas con una sola llamada.

⚠️ **Precisión limitada en pares de magnitud muy distinta.**

El cruce directo devuelve 3 cifras significativas (`0.00341`). El mismo cruce
calculado vía USD —`(1 / 1488.97) × 5.077`— da `0.00340974`.

Diferencia relativa: **0,0076 %**

| Monto | Directo | Vía USD | Diferencia |
|---|---|---|---|
| 1.000 ARS | 3,4100 BRL | 3,4097 BRL | 0,0003 |
| 100.000 ARS | 341,0000 BRL | 340,9740 BRL | 0,0260 |
| 1.000.000 ARS | 3410,0000 BRL | 3409,7396 BRL | 0,2604 |

La causa es el redondeo de la API en el par directo.

**Decisión: usar siempre el cruce directo.** Es una sola llamada, es el dato
oficial del proveedor, y es reproducible al auditar una transacción pasada.
Calcular vía moneda pivote haría depender el resultado de dos tasas y del
método de combinación.

Los tests de conversión deben contemplar esta diferencia: no esperar el mismo
resultado por ambos caminos.

### 3. Las 8 monedas del proyecto

    GET /v2/rates?base=USD&quotes=ARS,BRL,CLP,COP,MXN,PEN,EUR

| Moneda | Tasa (1 USD =) |
|---|---|
| ARS | 1488.97 |
| BRL | 5.077 |
| CLP | 925.73 |
| COP | 3136.97 |
| EUR | 0.86985 |
| MXN | 17.3671 |
| PEN | 3.3863 |

Las 8 monedas responden correctamente. El seed de `currencies` no necesita
ajustes.

### 4. Filtrado por proveedor — hallazgo importante

    GET /v2/rates?providers=ECB&quotes=ARS,BRL,CLP,COP,MXN,PEN

Devuelve **solo BRL y MXN** de las 6 solicitadas.

**Conclusión:** no se puede acotar a `providers=ECB`. El Banco Central Europeo
no publica cotizaciones de ARS, CLP, COP ni PEN.

**Decisión:** usar el promedio por defecto de la v2, que combina múltiples
bancos centrales. El campo `rate_source` de `transactions` se registra como
`frankfurter (blended)`.

Con `?expand=providers` se puede consultar qué fuentes contribuyeron a cada
tasa, si en algún momento hace falta trazabilidad de origen.

### 5. Serie histórica

    GET /v2/rates?from=2026-07-01&base=USD&quotes=ARS

**23 registros para 31 días.** Los faltantes son exactamente los sábados y
domingos (4, 5, 11, 12, 18, 19, 25, 26). Los bancos centrales no publican
cotización los fines de semana.

**Implicancia para el frontend:** la serie tiene huecos. El gráfico de historial
debe posicionar cada punto según su campo `date`, no asumir días consecutivos.
De lo contrario el eje temporal queda deformado.

El último valor de la serie (31/07 → 1488.97) coincide con el que devuelve
`/rate/USD/ARS`, confirmando consistencia entre ambos endpoints.

Para rangos largos existen `group=week` y `group=month`, que downsamplean la
serie y evitan traer cientos de puntos.

### 6. Manejo de errores

    GET /v2/rate/USD/XXX

```json
{"status":422,"message":"invalid currency: XXX"}
```

⚠️ Devuelve HTTP **422**, no 404. El body incluye `status` además de `message`.

No trae código de error tipado, así que la capa de servicio debe traducirlo al
formato interno del proyecto (`CURRENCY_NOT_FOUND`, `RATE_UNAVAILABLE`).

---

## Formato de respuesta

Array plano, un objeto por par:

```json
[
  { "date": "2026-07-31", "base": "USD", "quote": "ARS", "rate": 1488.97 }
]
```

**No** es el formato de la v1 (`{ amount, base, date, rates: {...} }`).
Cualquier parser escrito para v1 hay que reescribirlo.

`rate` viene como **number**. Antes de persistir o calcular hay que convertirlo
con la librería de precisión decimal — nunca operar directo con el número de
JavaScript.

## Formatos alternativos

- **CSV:** agregar `.csv` a la ruta
- **NDJSON:** header `Accept: application/x-ndjson`, útil para series largas

## Fallback

ExchangeRate-API (1500 requests/mes) queda como proveedor secundario ante
indisponibilidad del principal. Su formato de respuesta es distinto: la capa de
servicio debe normalizar ambos a una estructura interna común.

## Resumen para quien implemente la integración

1. Usar `/v2/rate/{base}/{quote}` para cotizar operaciones puntuales.
2. No filtrar por `providers` — el BCE no cubre las monedas latinoamericanas.
3. Los errores devuelven **422**, no 404.
4. La respuesta es un **array plano**, no el objeto anidado de la v1.
5. Las series históricas tienen **huecos los fines de semana**.
6. `rate` es number: convertir a decimal antes de operar.