
# Contrato de la API — Sprint 1

Documento de referencia para el equipo de frontend. Define qué endpoints existen,
qué reciben y qué devuelven.

## Convenciones generales

### Base URL

    Desarrollo:  http://localhost:3000/api
    Producción:  https://[url-de-railway]/api

### Autenticación

Las rutas protegidas requieren el header:

    Authorization: Bearer <token>

### Formato de error

Todos los errores devuelven la misma estructura:

    {
      "error": "CODIGO_DEL_ERROR",
      "message": "Descripción legible"
    }

El frontend debe usar el campo `error` para decidir qué hacer, nunca el `message`
— ese puede cambiar sin aviso.

### Errores comunes en rutas protegidas

| HTTP | error | Cuándo |
|---|---|---|
| 401 | `UNAUTHORIZED` | Falta el token o es inválido |
| 401 | `TOKEN_EXPIRED` | El token venció |
| 500 | `INTERNAL_ERROR` | Error inesperado del servidor |

---

## 1. Registro

    POST /api/auth/register

Pública.

### Body

    {
      "email": "juan@ejemplo.com",
      "password": "miPassword123",
      "fullName": "Juan Pablo Arnez"
    }

### Validaciones

- `email` — formato válido, se almacena en minúsculas
- `password` — mínimo 8 caracteres
- `fullName` — entre 2 y 100 caracteres

### Respuesta 201

    {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "email": "juan@ejemplo.com",
        "fullName": "Juan Pablo Arnez"
      }
    }

### Errores

| HTTP | error | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Algún campo no cumple las validaciones |
| 409 | `EMAIL_ALREADY_EXISTS` | Ya existe una cuenta con ese email |

Al registrarse se crea automáticamente la wallet del usuario con balances en cero
para las 8 monedas. El frontend no necesita hacer nada extra.

---

## 2. Login

    POST /api/auth/login

Pública.

### Body

    {
      "email": "juan@ejemplo.com",
      "password": "miPassword123"
    }

### Respuesta 200

Idéntica a la del registro: `token` + `user`.

### Errores

| HTTP | error | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Falta email o password |
| 401 | `INVALID_CREDENTIALS` | Email o contraseña incorrectos |

Nota de seguridad: se devuelve el mismo error para email inexistente y para
contraseña incorrecta. Distinguirlos permitiría averiguar qué cuentas existen.

---

## 3. Listar monedas

    GET /api/currencies

Pública.

### Respuesta 200

    {
      "currencies": [
        { "code": "USD", "name": "Dólar estadounidense", "symbol": "$",  "decimals": 2 },
        { "code": "EUR", "name": "Euro",                 "symbol": "€",  "decimals": 2 },
        { "code": "ARS", "name": "Peso argentino",       "symbol": "$",  "decimals": 2 },
        { "code": "BRL", "name": "Real brasileño",       "symbol": "R$", "decimals": 2 },
        { "code": "CLP", "name": "Peso chileno",         "symbol": "$",  "decimals": 0 },
        { "code": "COP", "name": "Peso colombiano",      "symbol": "$",  "decimals": 2 },
        { "code": "MXN", "name": "Peso mexicano",        "symbol": "$",  "decimals": 2 },
        { "code": "PEN", "name": "Sol peruano",          "symbol": "S/", "decimals": 2 }
      ]
    }

Solo devuelve las monedas con `is_active = true`.

**Importante:** el campo `decimals` debe usarse para formatear los montos. El peso
chileno no usa decimales — se muestra `$15.000`, no `$15.000,00`.

---

## 4. Balances del usuario

    GET /api/wallet/balances

Requiere token.

### Respuesta 200

    {
      "walletId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "balances": [
        {
          "currencyCode": "USD",
          "currencyName": "Dólar estadounidense",
          "symbol": "$",
          "decimals": 2,
          "amount": "1250.50000000"
        },
        {
          "currencyCode": "ARS",
          "currencyName": "Peso argentino",
          "symbol": "$",
          "decimals": 2,
          "amount": "0.00000000"
        }
      ]
    }

Devuelve siempre las 8 monedas, aunque el balance sea cero.

**Importante:** `amount` viene como string, no como number. JavaScript no representa
decimales con precisión (`0.1 + 0.2` da `0.30000000000000004`), lo cual es
inaceptable en una aplicación financiera. El frontend recibe el string, lo formatea
para mostrar, y si necesita operar usa una librería de precisión decimal.

---

## Notas para el frontend

- El token se guarda en estado de React, no en localStorage. Si el usuario recarga
  la página, vuelve al login. Es suficiente para el alcance del Sprint 1.
- Los datos del usuario vienen en la respuesta del login, no hay que pedirlos aparte.
- Mientras el backend no exista, se puede trabajar contra respuestas simuladas con
  estas mismas estructuras. Al conectar los endpoints reales solo cambia la fuente.

---

## Estado de implementación

| Endpoint | Estado | Responsable |
|---|---|---|
| `GET /api/health` | ✅ Implementado | Juampi |
| `POST /api/auth/register` | ⏳ Pendiente | Andrés |
| `POST /api/auth/login` | ⏳ Pendiente | Juampi |
| `GET /api/currencies` | ⏳ Pendiente | Andrés |
| `GET /api/wallet/balances` | ⏳ Pendiente | Andrés |