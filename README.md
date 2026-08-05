# wallet-api

Backend de Neto Wallet: billetera digital multi-moneda para freelancers
que cobran del exterior. Express + TypeScript, PostgreSQL en Supabase,
deploy en Railway.

## Requisitos

- Node.js 20+
- npm
- Acceso al proyecto de Supabase del equipo (pedir credenciales por Discord)

## Instalación

1. Clonar el repo y entrar a la carpeta:

```bash
   git clone https://github.com/devcoresolutions-dev/wallet-api.git
   cd wallet-api
   npm install
```

2. Copiar `.env.example` a `.env` y completar las variables (ver sección
   siguiente).

3. Correr migraciones y seeds:

```bash
   npm run migrate
```

   Es re-ejecutable: se puede correr varias veces sin romper nada.

4. Levantar el servidor:

```bash
   npm run dev
```

   Queda en `http://localhost:3000`. Verificar con:

```bash
   curl http://localhost:3000/api/health
```

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Conexión a Supabase. **Usar el Session pooler** (ver advertencia abajo). |
| `JWT_SECRET` | Clave para firmar los tokens. Generar una con: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | Puerto del servidor. Default: 3000. |
| `FRANKFURTER_API_URL` | URL base de la API de tasas de cambio. |
| `NODE_ENV` | `development` local, `production` en Railway. |

### ⚠️ DATABASE_URL: usar SIEMPRE el Session pooler

La URL correcta tiene esta forma:
postgresql://postgres.XXXX:PASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres

Claves para reconocerla: host con `pooler.supabase.com` y puerto **5432**.

Por qué no las otras opciones que ofrece Supabase:

- **Conexión directa**: resuelve a IPv6 y no funciona desde Railway
  (dio `ENETUNREACH` en producción hasta que se corrigió).
- **Transaction pooler (puerto 6543)**: incompatible con los prepared
  statements del driver `pg`. Genera errores intermitentes difíciles
  de debuggear.

## Rutas

Todas las rutas van bajo el prefijo **`/api`**:

- `GET /api/health` — estado del servidor (no valida la DB)
- `POST /api/auth/register` — crea usuario + wallet + 8 balances
- `POST /api/auth/login` — devuelve JWT (24h)
- `GET /api/auth/me` — requiere `Authorization: Bearer <token>`

El contrato completo (formatos de request/response, códigos de error)
está en [`docs/api-contract.md`](docs/api-contract.md).

## Usuario demo

El seed crea un usuario listo para probar sin registrarse:

- Email: `demo@devcore.test`
- Password: `password123`

Tiene wallet y balances en las 8 monedas (USD, EUR, ARS, BRL, CLP,
COP, MXN, PEN).

## Verificación post-deploy (smoke tests)

**Importante:** el `/health` no toca la base de datos, así que un
deploy "verde" no garantiza que la conexión a la DB funcione.
Después de cada deploy correr los dos:

```bash
# 1. El servidor levantó
curl -i https://wallet-api-production.up.railway.app/api/health

# 2. La DB responde (login del usuario demo)
curl -i -X POST https://wallet-api-production.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@devcore.test","password":"password123"}'
```

Ambos deben dar 200.

## Deploy

Railway deploya automáticamente cada push a la rama **`dev`**.

- URL de producción: `https://wallet-api-production.up.railway.app`
- Las variables de entorno de producción se configuran en Railway
  (Variables del servicio), no viajan en el repo.
- El build corre `npm run build` (`tsc`): si no compila, no deploya.

## Flujo de trabajo

- Ramas: `main` → `dev` → `feat/*`
- **Los PRs apuntan a `dev` como base** (verificar el dropdown al
  crearlo).
- 1 aprobación obligatoria para mergear.

## Estructura y convenciones

```
src/config/       env, conexión a DB (pool + withTransaction)
src/db/           migraciones, seeds, runner
src/models/       queries a la DB
src/services/     lógica de negocio
src/controllers/  manejo de request/response
src/routes/       definición de rutas
src/middlewares/  errorHandler, authenticate, etc.
src/schemas/      validación con Zod
src/utils/        AppError y helpers
```

#### Reglas del equipo:

- La lógica va en `services`, nunca en `controllers`.
- Toda operación financiera va dentro de `withTransaction`.
- Montos: `NUMERIC(20,8)` en DB, `string` en la API.
- Body de la API en camelCase (`fullName`).

Más contexto de arquitectura en [`CONTEXT.md`](CONTEXT.md).
