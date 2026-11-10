# Treo Wallet: billetera digital MXN

Prueba técnica Fullstack Fintech de Treo. El proyecto se desarrolla con metodología SPEC-first: las especificaciones de [`/specs`](./specs) se escribieron y aprobaron antes de escribir código, y cada commit cita la tarea de [`specs/tasks.md`](./specs/tasks.md) que implementa (`[T-xx]`).

| Fase | Estado |
| --- | --- |
| 1. Especificación (`/specs`) | ✅ Aprobada |
| 2. Backend (`/api`, `/packages/shared`) | ✅ Implementado (T-01 a T-17) |
| 3. Web (`/web`) y móvil (`/mobile`) | ⏳ Pendiente |
| 4. Propuesta AWS (`/docs/aws-deploy.md`) | ⏳ Pendiente |

## Estructura

```
/api               API Express + TypeORM + PostgreSQL
  src/modules/     auth, accounts, beneficiaries, transfers, movements, audit
  src/db/          entidades, migraciones (SQL crudo donde TypeORM no alcanza), seed
  test/unit        pruebas unitarias
  test/integration pruebas contra PostgreSQL real (incluye concurrencia)
/packages/shared   contrato OpenAPI 3.1, tipos generados, CLABE, montos y esquemas Zod
/specs             requerimientos, diseño, tareas y bitácora de AI
/docker            script de roles y bases de datos de PostgreSQL
```

## Requisitos

- Node.js 20 o superior (probado con Node 22) y npm 10.
- PostgreSQL 15 o superior. Puedes usar el `docker-compose.yml` incluido (PostgreSQL 16) o un PostgreSQL local.

## Cómo correr en local

```bash
# 1. Dependencias (también compila packages/shared)
npm install

# 2. PostgreSQL con roles y bases (treo y treo_test)
docker compose up -d
#    El contenedor publica PostgreSQL en el puerto 5433 del host, para no chocar
#    con un PostgreSQL ya instalado en 5432. `.env.example` y las pruebas usan 5433.
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

- API: <http://localhost:3000/api/v1>
- Documentación OpenAPI navegable (Swagger UI): <http://localhost:3000/docs>
- Contrato en JSON: <http://localhost:3000/docs/openapi.json>

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
npm test                                   # todo: shared + api (unitarias e integración)
npm run test -w @treo/api -- --project unit
npm run test -w @treo/api -- --project integration
npm run lint                               # ESLint + Prettier + lint del contrato OpenAPI
npm run typecheck
```

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

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | API con recarga (tsx watch) |
| `npm run build` / `npm start -w @treo/api` | Compila y corre la versión compilada |
| `npm run db:migrate` / `npm run db:migrate:revert` | Aplica o revierte migraciones (rol dueño) |
| `npm run db:seed` | Datos de demostración (idempotente) |
| `npm run gen:types` | Regenera los tipos TypeScript desde `packages/shared/openapi.yaml` |

## Qué haría con más tiempo

Esta lista se completará al cerrar las fases 3 y 4. Por ahora, en el backend:

- Mover el rate limit a Redis o WAF para que funcione con varias réplicas. Hoy vive en memoria.
- Agregar el envío real del OTP (SMS o correo) con un proveedor y plantillas.
- Agregar una tarea programada que marque como `EXPIRED` los OTP vencidos sin esperar a que el usuario intente confirmar.
- Agregar una conciliación periódica entre saldo y suma de asientos, con alertas. Hoy la base impide la divergencia y las pruebas la verifican.
- Particionar `ledger_entries` por fecha cuando el volumen lo requiera.
