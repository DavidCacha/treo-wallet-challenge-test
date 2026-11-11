# Treo Wallet: billetera digital MXN

Prueba técnica Fullstack Fintech de Treo. El proyecto se desarrolla con metodología SPEC-first: las especificaciones de [`/specs`](./specs) se escribieron y aprobaron antes de escribir código, y cada commit cita la tarea de [`specs/tasks.md`](./specs/tasks.md) que implementa (`[T-xx]`).

| Fase | Estado |
| --- | --- |
| 1. Especificación (`/specs`) | ✅ Aprobada |
| 2. Backend (`/api`, `/packages/shared`) | ✅ Implementado (T-01 a T-17) |
| 3a. Web (`/web`) | ✅ Implementado (T-18 a T-24) |
| 3b. Móvil (`/mobile`) | ✅ Implementado (T-25 a T-28) |
| 4. Propuesta AWS (`/docs/aws-deploy.md`) y CI | ✅ Documentada (T-29 a T-31) |

## Estructura

```
/api               API Express + TypeORM + PostgreSQL
  src/modules/     auth, accounts, beneficiaries, transfers, movements, audit
  src/db/          entidades, migraciones (SQL crudo donde TypeORM no alcanza), seed
  test/unit        pruebas unitarias
  test/integration pruebas contra PostgreSQL real (incluye concurrencia)
/web               panel web React 18 + Vite + TanStack Query
  src/api/         cliente tipado, sesión (access en memoria, refresh por cookie)
  src/pages/       login, registro, cuentas, historial, beneficiarios
  src/transfer/    formulario → confirmación → OTP → comprobante
/mobile            app Expo (React Native + TS); paquete aparte, ver mobile/README.md
  src/api/         cliente tipado, sesión (refresh token solo en expo-secure-store)
  src/transfer/    máquina de envío con reintentos idempotentes y OTP
/packages/shared   contrato OpenAPI 3.1, tipos generados, CLABE, montos y esquemas Zod
/specs             requerimientos, diseño, tareas y bitácora de AI
/docker            script de roles y bases de datos de PostgreSQL
/docs              propuesta de despliegue en AWS y auditoría de requisitos
/.github/workflows CI: lint, TypeScript y pruebas de api, web, shared y móvil
```

Documentos clave:

- [`docs/aws-deploy.md`](./docs/aws-deploy.md): propuesta de producción en AWS (sin desplegar).
- [`docs/requirements-audit.md`](./docs/requirements-audit.md): cada requisito de la prueba con su implementación, estado y la prueba que lo demuestra.
- [`specs/`](./specs): requerimientos, diseño (incluye el `EXPLAIN ANALYZE` en §10), tareas con sus commits y bitácora de AI.

## Requisitos

- Node.js 20 o superior (probado con Node 22) y npm 10. La app móvil y sus pruebas piden Node 22.13 o superior (React Native Testing Library 14).
- PostgreSQL 15 o superior. Puedes usar el `docker-compose.yml` incluido (PostgreSQL 16) o un PostgreSQL local.
- Para la app móvil: Expo Go en un teléfono Android o iOS en la misma red Wi-Fi, o un emulador o simulador.

## Cómo correr en local

```bash
# 1. Dependencias (también compila packages/shared)
npm install

# 2. PostgreSQL con roles y bases (treo y treo_test)
docker compose up -d
#    El contenedor publica PostgreSQL en el puerto 55432 del host, para no chocar
#    con un PostgreSQL ya instalado (5432 o 5433). `.env.example` y las pruebas usan 55432.
#    Sin Docker, con un PostgreSQL local y un superusuario:
#    psql -U postgres -f docker/postgres/init/01-roles-and-databases.sql
#    y cambia el puerto a 5432 en api/.env, TEST_DATABASE_URL y TEST_DATABASE_MIGRATION_URL.

# 3. Variables de entorno (valores solo para desarrollo, sin secretos reales)
cp .env.example api/.env

# 4. Migraciones, datos de prueba y API
npm run db:migrate
npm run db:seed
npm run dev
```

En otra terminal, el panel web:

```bash
npm run dev:web
```

- Web: <http://localhost:5173> (Vite redirige `/api` a la API, así la cookie del refresh es del mismo origen)
- API: <http://localhost:3000/api/v1>
- Documentación OpenAPI navegable (Swagger UI): <http://localhost:3000/docs>
- Contrato en JSON: <http://localhost:3000/docs/openapi.json>

### App móvil con Expo Go

Resumen (los detalles, simuladores y problemas comunes están en [`mobile/README.md`](./mobile/README.md)):

```bash
cd mobile
npm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
# en .env: EXPO_PUBLIC_API_URL=http://<IP-de-tu-computadora>:3000/api/v1
npx expo start           # escanea el QR con Expo Go (misma red Wi-Fi)
```

En el teléfono `localhost` no apunta a tu computadora: usa su IP en la red local (`ipconfig` en Windows).

### Variables de entorno

La API lee `api/.env` (copia de [`.env.example`](./.env.example), con valores solo para desarrollo). Las principales:

| Variable | Para qué | Valor de desarrollo |
| --- | --- | --- |
| `DATABASE_URL` | Conexión de la API (rol `treo_app`) | `postgres://treo_app:treo_app_dev@localhost:55432/treo` |
| `DATABASE_MIGRATION_URL` | Migraciones (rol `treo_owner`) | `postgres://treo_owner:treo_owner_dev@localhost:55432/treo` |
| `TEST_DATABASE_URL`, `TEST_DATABASE_MIGRATION_URL` | Base `treo_test` de las pruebas de integración | Igual con `/treo_test` |
| `JWT_SECRET`, `OTP_PEPPER` | Firma de tokens y HMAC del código de un solo uso | Cadenas de desarrollo; en producción vendrían de Secrets Manager |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` | Vigencia del access token (900 s) y del refresh token (7 días) | — |
| `DEFAULT_DAILY_LIMIT_CENTS`, `OTP_THRESHOLD_CENTS` | Límite diario ($50,000.00) y monto que exige código ($10,000.00) | `5000000`, `1000000` |
| `BUSINESS_TIMEZONE` | Zona del día del límite | `America/Mexico_City` |
| `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS` | Intentos de login permitidos por ventana | 5 cada 15 min |
| `CORS_ORIGINS` | Orígenes web permitidos | `http://localhost:5173` |

La web usa `VITE_API_URL` (opcional, ver [`web/.env.example`](./web/.env.example)) y la app móvil `EXPO_PUBLIC_API_URL` (ver [`mobile/.env.example`](./mobile/.env.example)). Ningún `.env` real está en Git.

### Usuarios de demostración (creados por el seed)

| Correo | Contraseña | Datos |
| --- | --- | --- |
| `ana@treo.dev` | `Demo12345!` | $93,249.51 en Principal y $5,000.00 en Ahorro; tiene a Beto como beneficiario |
| `beto@treo.dev` | `Demo12345!` | $25,000 más lo que le envió Ana; tiene a Ana como beneficiaria |
| `historial@treo.dev` | `Demo12345!` | 60,000 transferencias históricas (120,000 asientos) para probar la paginación |

Con `NODE_ENV=development`, las transferencias de más de $10,000.00 a terceros responden `202` con `challenge.dev_otp_code`. Ese es el código de un solo uso simulado, que también aparece en el log. Fuera de desarrollo el código no se expone.

### Roles de base de datos

Se usan dos roles con permisos mínimos (`design.md` §3.2):

- `treo_owner`: es dueño del esquema y se usa en `DATABASE_MIGRATION_URL` para correr las migraciones.
- `treo_app`: es el rol con el que corre la API (`DATABASE_URL`). Puede hacer `SELECT` e `INSERT`, pero solo puede hacer `UPDATE` en columnas explícitas. No puede modificar saldos ni borrar o editar el libro mayor ni la auditoría.

## Cómo correr las pruebas

Las pruebas de integración usan la base `treo_test`. Esa base se reinicia en cada corrida, así que PostgreSQL debe estar levantado (paso 2).

```bash
npm test                                   # todo: shared + api (unitarias e integración) + web
npm run test -w @treo/web                  # solo web (Vitest + Testing Library + MSW, sin API)
npm run test -w @treo/api -- --project unit
npm run test -w @treo/api -- --project integration
npm run lint                               # ESLint + Prettier + lint del contrato OpenAPI
npm run typecheck
npm run test:mobile                        # app móvil (Jest + React Native Testing Library, sin API)
npm run typecheck:mobile
cd mobile && npm run test:live             # app móvil contra la API local real (API corriendo + seed)
```

Resultados de la última corrida completa (2026-11-11): shared 51, API 103 (incluye 100 transferencias simultáneas), web 49, móvil 48 y móvil contra la API real 7, todas en verde.

### Integración continua

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) corre en cada PR y en cada push a `main`, con cuatro jobs:

- Lint (ESLint, Prettier y contrato OpenAPI) y TypeScript de todos los proyectos.
- Pruebas de shared y web, más la build de la web.
- Pruebas de la API con PostgreSQL 16 como servicio, y luego migraciones y seed verificando al menos 100,000 asientos.
- Pruebas de la app móvil.

Si tu PostgreSQL no usa las credenciales por defecto, define `TEST_DATABASE_URL` y `TEST_DATABASE_MIGRATION_URL`.

Qué cubren:

| Suite | Cobertura |
| --- | --- |
| `packages/shared/test` | CLABE (dígito verificador), parseo y formato de montos sin `float`, esquemas |
| `api/test/unit` | Reglas de transferencia, hash de idempotencia, middleware JWT, esqueleto HTTP, redacción de logs |
| `db-integrity` | Las invariantes viven en la base: saldo no negativo, asientos que suman cero, auditoría y libro inmutables, permisos de `treo_app` |
| `auth` | Registro, login sin enumeración de usuarios, rate limit, refresh rotativo con detección de reutilización, logout |
| `transfers`, `otp`, `daily-limit` | Atomicidad, idempotencia, saldo insuficiente, límite diario con cruce de medianoche, OTP |
| `concurrency` | 100 transferencias simultáneas que cuadran al centavo, transferencias A↔B sin deadlocks, misma llave ×20 |
| `movements` | Paginación por cursor sin duplicados ni omisiones, filtros y validación |
| `mobile/src/**/*.test.ts(x)` | Sesión en SecureStore, login, inicio con estados, máquina de envío (misma llave, backoff, estado desconocido, OTP), flujo de transferencia con red perdida, cubierta de privacidad. Detalle en [`mobile/README.md`](./mobile/README.md) |
| `web/src/**/*.test.tsx` | Sesión con *single-flight*, login/registro (401/409/429, teclado), cuentas, historial con cursor y filtros, beneficiarios con CLABE en vivo y el flujo de transferencia (doble clic, misma llave en reintentos, saldo insuficiente, OTP) |

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | API con recarga (tsx watch) |
| `npm run dev:web` | Panel web con Vite en el puerto 5173 |
| `npm run dev:mobile` | Metro para la app móvil (antes: `npm install` dentro de `mobile/` y `EXPO_PUBLIC_API_URL`, ver [`mobile/README.md`](./mobile/README.md)) |
| `npm run build` / `npm start -w @treo/api` | Compila y corre la versión compilada |
| `npm run db:migrate` / `npm run db:migrate:revert` | Aplica o revierte migraciones (rol dueño) |
| `npm run db:seed` | Datos de demostración (idempotente) |
| `npm run gen:types` | Regenera los tipos TypeScript desde `packages/shared/openapi.yaml` |

## Qué haría con más tiempo

Backend:

- Mover el rate limit a Redis o a WAF para que funcione con varias réplicas. Hoy vive en memoria de cada proceso.
- Enviar el OTP de verdad (SMS o correo) con un proveedor y plantillas.
- Agregar una tarea programada que marque como `EXPIRED` los OTP vencidos, sin esperar a que el usuario intente confirmar.
- Conciliar a diario saldo contra suma de asientos, con alertas. Hoy la base impide la divergencia y las pruebas lo verifican.
- Particionar `ledger_entries` por mes cuando el volumen lo requiera.
- Evaluar Amazon Cognito para MFA y recuperación de cuenta ([`docs/aws-deploy.md`](./docs/aws-deploy.md) §12).

Web:

- Avisar en otra pestaña si hay un intento de transferencia sin resultado (hoy el intento vive en el `sessionStorage` de cada pestaña).
- Agregar pruebas de punta a punta con Playwright en CI contra la API real.
- Mostrar una cuenta regresiva cuando el OTP está por vencer.

Móvil:

- Desbloqueo biométrico (`expo-local-authentication`) antes de mostrar saldos al volver a la app (bonus de la prueba).
- Probar en dispositivos reales, de forma automatizada (Maestro o Detox), el modo avión a mitad del envío, en iOS y Android.
- Agregar App Attest y Play Integrity para validar que las peticiones vienen de la app legítima.

Infraestructura:

- Escribir el esqueleto en CDK de la propuesta de AWS y un workflow de despliegue con OIDC.
- Agregar análisis de dependencias y de secretos en CI (Dependabot, CodeQL y gitleaks).

## Video en ejecución de la aplicación mobile y web
Url del video: https://drive.google.com/file/d/1RA6EdPpYelFINfGS5Ahcr8JHn6WOdd7l/view?usp=sharing
