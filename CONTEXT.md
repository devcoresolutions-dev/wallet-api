# Contexto del proyecto

Billetera digital multi-moneda. Proyecto final de bootcamp, equipo de 4.
Transacciones simuladas, sin dinero real.

Pegar este archivo al inicio de las conversaciones con la IA.

## Stack
- Backend: Express.js + TypeScript, PostgreSQL, deploy en Railway
- Frontend: React + TypeScript + Vite, deploy en Vercel
- Auth: JWT + bcryptjs. Validacion: Zod. Tests: Vitest
- Tasas de cambio: API de Frankfurter v2
- Emails: AWS SES via Vercel Functions
- Chatbot: Gemini (gemini-2.5-flash)

## Monedas soportadas
USD, EUR, ARS, BRL, CLP, COP, MXN, PEN
Definidas en la tabla currencies, no en un ENUM.

## Estructura del backend
src/config, src/db, src/models, src/services, src/controllers,
src/routes, src/middlewares, src/schemas, src/utils, src/types

La logica de negocio va en services, nunca en controllers.
Los controllers solo traducen HTTP: leen el request, llaman al service, responden.

## Estructura del frontend
src/api, src/components, src/context, src/hooks, src/layouts,
src/pages, src/routes, src/types, src/utils

Las llamadas HTTP van en src/api, nunca dentro de un componente.

## Convenciones
- Codigo, nombres y comentarios en ingles
- Commits: tipo(alcance): descripcion
- Montos: NUMERIC(20,8) en la DB, libreria decimal en el calculo. Nunca float.
- Sin any en TypeScript
- Toda operacion financiera dentro de una transaccion SQL,
  usando withTransaction de src/config/database.ts
- Errores con la clase AppError de src/utils/AppError.ts

## Como quiero que ayudes a este grupo de desarrolladores!!
- Explica el porque de cada decision, no me des solo el codigo
- Si hay mas de un enfoque, mostrame las opciones y el trade-off
- Respeta la estructura de carpetas de arriba
- Preguntar si algo no se entiende
