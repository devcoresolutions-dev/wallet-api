# Como trabajamos

## Ramas

- `main` — produccion, desplegada. No se toca directo.
- `dev` — integracion. Todo pasa por aca antes de main.
- `feat/*`, `fix/*`, `chore/*`, `refactor/*` — trabajo diario.

Nombres en minuscula, solo a-z 0-9 _ - /
Ejemplos: feat/user_registration, fix/balance_rounding

## Flujo

    git checkout dev
    git pull origin dev
    git checkout -b feat/mi_tarea

    git status
    git add src/archivo.ts
    git commit -m "feat(api/auth): add login endpoint"
    git push -u origin feat/mi_tarea

Antes de abrir el PR, trae lo ultimo de dev:

    git checkout dev
    git pull origin dev
    git checkout feat/mi_tarea
    git merge dev
    git push

Abris el PR contra dev, avisas en el grupo, esperas 1 aprobacion
y mergeas vos mismo.

## Commits

Formato: tipo(alcance): descripcion — en ingles, menos de 80 caracteres.
Tipos: feat, fix, refactor, test, chore, docs

    feat(api/wallets): add GET /wallets/balances
    fix(api/auth): handle expired token correctly
    test(api/exchange): add insufficient balance cases
    chore(api): configure eslint and prettier

## Codigo

- Todo en ingles: variables, funciones, comentarios, commits.
- Nombres descriptivos. filteredBalances, no arr2.
- camelCase para variables y funciones, PascalCase para clases,
  MAYUS_CON_GUION para constantes.
- Sin `any` en TypeScript.
- Sin hardcodeo: los valores fijos van a constantes.
- Pocos comentarios. Si necesitas uno, proba primero con un mejor nombre.
- La logica de negocio va en services, nunca en controllers.
- Toda operacion financiera usa withTransaction de src/config/database.ts

## Pull Requests

Chicos y enfocados en una sola cosa. En la descripcion:
que se hizo, como probarlo, y que deberia mirar el reviewer.

Si todavia no esta listo pero queres mostrarlo, poné "WIP: " al inicio del titulo.

## Reglas

1. Nunca pushear directo a main ni a dev.
2. Nunca commitear el .env.
3. Commits chicos y frecuentes.
4. Si estas trabado mas de 40 minutos, avisa en el grupo.
5. No mergees codigo que no puedas explicar.
