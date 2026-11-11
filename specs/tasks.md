# Plan de implementación — Billetera digital MXN (Treo)

> Estado: **borrador para revisión**. Ninguna tarea de implementación inicia hasta que las specs se aprueben.
> Requerimientos: [`requirements.md`](./requirements.md) · Diseño: [`design.md`](./design.md)

## Reglas del plan

- Cada tarea es pequeña, verificable y corresponde a **uno o más commits** cuyo mensaje cita su ID: `feat(api): bloqueo determinista en transferencias [T-11]`.
- Etiquetas: `api`, `web`, `mobile` (una tarea transversal lleva varias).
- "Verificación" es la evidencia objetiva de que la tarea está terminada (prueba, comando o revisión manual concreta).
- Columna **Commits**: se llena al cerrar cada tarea con los hashes cortos, para la trazabilidad requerimiento → diseño → tarea → commit → prueba.
- Presupuesto objetivo: **14 h** de trabajo efectivo. Las estimaciones incluyen escribir pruebas. El bonus (T-32) queda fuera del presupuesto.
- Orden: las dependencias están indicadas; dentro de cada bloque se ejecutan en orden numérico.

## Resumen del presupuesto

| Bloque | Tareas | Horas |
| --- | --- | --- |
| Especificación | T-00 | 1.00 |
| Backend | T-01 … T-17 | 7.50 |
| Web | T-18 … T-24 | 2.50 |
| Móvil | T-25 … T-28 | 1.50 |
| Transversal (CI, AWS, README) | T-29 … T-31 | 1.00 |
| Holgura (integración, grabación del video, imprevistos) | — | 0.50 |
| **Total** | | **14.00** |
| Bonus (opcional) | T-32 | +0.75 |

## Fase 1 — Especificación

| ID | Tarea | Etiquetas | Requerimientos | Verificación | Est. | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| T-00 | Escribir `requirements.md`, `design.md`, `tasks.md` y `ai-log.md`; revisión y aprobación humana antes de cualquier código. | `api` `web` `mobile` | Todos, NFR-16 | PR de specs revisado y aprobado; el historial muestra las specs antes del primer commit de código. | 1.00 | `b1525ab` |

## Fase 2 — Backend

| ID | Tarea | Etiquetas | Requerimientos | Depende de | Verificación | Est. | Commits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Monorepo con npm workspaces (`api`, `web`, `mobile`, `packages/shared`), TypeScript `strict` base, ESLint + Prettier, `docker-compose.yml` con PostgreSQL 16, `.env.example`. | `api` `web` `mobile` | NFR-9, NFR-14 | T-00 | `npm install` y `npm run lint` pasan en la raíz; `docker compose up -d` deja PostgreSQL disponible. | 0.50 | `efb1a22`, `c031294` |
| T-02 | Esqueleto Express: config con Zod, pino + `request_id` + redacción, `problemHandler` RFC 7807, `helmet`, CORS, límite de cuerpo, `GET /health`. | `api` | NFR-5, NFR-6, NFR-8 | T-01 | Prueba Supertest: `/health` 200; ruta inexistente → `application/problem+json` con `request_id`; prueba de que `authorization` y `password` salen redactados en el log. | 0.25 | `ae9f8bc` |
| T-03 | `packages/shared`: `isValidClabe`, `parseMxnToCents`, `formatCents`, esquemas Zod compartidos. | `api` `web` `mobile` | R3.2, R3.7, R4.3, R2.4, NFR-2, NFR-7 | T-01 | Unitarias: CLABEs válidas conocidas, dígito erróneo, longitud/letras; `"100.005"` rechazado, `"1,234.56"` → `123456`, sin `parseFloat` (regla ESLint `no-restricted-syntax`). | 0.50 | `7b5095f` |
| T-04 | Contrato OpenAPI de `design.md` §7 en `packages/shared/openapi.yaml`, generación de tipos (`openapi-typescript`), Swagger UI en `/docs`, lint del contrato (Redocly) en `npm run lint`. | `api` `web` `mobile` | NFR-14, R1–R6 | T-02, T-03 | `GET /docs` muestra la documentación; `npm run gen:types` no produce diff; lint del contrato pasa. | 0.25 | `0c1ceed` |
| T-05 | Migraciones base (TypeORM, `synchronize: false`): roles `treo_owner`/`treo_app`, `citext`, enums, `users`, `accounts`, `beneficiaries`, `refresh_tokens`, `audit_events` con trigger de inmutabilidad y `REVOKE`; `AuditService`. Scripts `db:migrate` y `db:migrate:revert`. | `api` | NFR-1, NFR-4, R1.12 | T-02 | Integración: `UPDATE`/`DELETE` sobre `audit_events` con el rol `treo_app` falla; `INSERT` funciona; migración se aplica y revierte limpia. | 0.50 | `1a129bc` |
| T-06 | Migraciones de libro: `transfers`, `ledger_entries`, `otp_challenges`; CHECKs, `UNIQUE (user_id, idempotency_key)`, trigger de aplicación de saldo (`SECURITY DEFINER`), constraint triggers diferidos de cuadre, inmutabilidad del libro, índices de §3.3, grants por columna. | `api` | R4.7, R4.8, R2.2, NFR-1 | T-05 | Integración en SQL directo: asiento que deja saldo negativo → error; dos asientos que no suman cero → error al `COMMIT`; `UPDATE accounts SET balance_cents` con `treo_app` → permiso denegado; transferencia `COMPLETED` sin asientos → error. | 0.50 | `f0fa8ac` |
| T-07 | Auth: `POST /auth/register` (crea cuentas Principal/Ahorro con CLABE válida), `POST /auth/login` (argon2id, hash ficticio para correos inexistentes, rate limit por IP+correo), auditoría. | `api` | R1.1–R1.6, R1.12, A-1 | T-05, T-03 | Integración: registro 201 sin hash; duplicado 409; login 200; credenciales malas 401 con mismo mensaje; 6.º intento → 429 con `Retry-After`; eventos en `audit_events`. | 0.50 | `2d1b0ca` |
| T-08 | Tokens: middleware JWT, `POST /auth/refresh` con rotación y detección de reutilización por familia, `POST /auth/logout`, cookie para web / cuerpo para móvil vía `X-Client-Platform`. | `api` | R1.4, R1.7–R1.10, EC-11 | T-07 | Integración: refresh devuelve tokens nuevos y el anterior deja de servir; reusar uno rotado → 401 y toda la familia revocada; web recibe `Set-Cookie` `HttpOnly; SameSite=Strict` sin token en el cuerpo. | 0.50 | `f72da26` |
| T-09 | `GET /me` (límite, usado hoy, umbral OTP), `GET /accounts`, `GET /accounts/:id` con 404 para cuentas ajenas. | `api` | R2.1–R2.3, R6.8 | T-08 | Integración: solo cuentas propias; cuenta ajena → 404; saldos como enteros. | 0.25 | `4be40d7` |
| T-10 | Beneficiarios: `GET`/`POST /beneficiaries` con CLABE (formato, dígito, existe en plataforma, no propia, única por usuario), auditoría. | `api` | R3.1–R3.6, R3.8, A-2 | T-09 | Integración: 201; dígito erróneo 422 `INVALID_CLABE_CHECK_DIGIT`; inexistente 422 `CLABE_NOT_FOUND`; propia 422; duplicado 409. | 0.25 | `a202691` |
| T-11 | `TransferService` núcleo: transacción `READ COMMITTED`, `lock_timeout`, bloqueo usuario → cuentas por `id`, idempotencia (hash canónico, replay, `IDEMPOTENCY_KEY_REUSED`), validaciones (`SAME_ACCOUNT_TRANSFER`, `INSUFFICIENT_FUNDS`, cuenta bloqueada), persistencia de `REJECTED`, asientos, comprobante, traducción de `23505`/`23514`/`40P01`, auditoría. | `api` | R4.1, R4.3–R4.12, R4.18, A-5 | T-06, T-10 | Unitarias del servicio (repositorios simulados) para cada regla; integración: saldos y asientos correctos tras una transferencia; saldo insuficiente no cambia nada. | 0.75 | `84d6bca` |
| T-12 | Límite diario: `LimitService` con ventana del día calculada en SQL desde `now()` en `America/Mexico_City`; solo P2P cuenta (A-3, A-4). | `api` | R6.1, R6.2, EC-4, EC-12 | T-11 | Integración: igualar el límite pasa, superarlo → 422 `DAILY_LIMIT_EXCEEDED`; transferencias completadas a las 23:59:59 del día anterior (hora CDMX) no cuentan; cuentas propias no cuentan. | 0.25 | `6623102` |
| T-13 | OTP: creación `PENDING_OTP` sobre el umbral, `OtpService` (CSPRNG, HMAC, 5 min, 3 intentos), confirmación con revalidación de saldo y límite, `EXPIRED`, confirmación idempotente, `dev_otp_code` solo en desarrollo, auditoría. | `api` | R6.3–R6.7, R6.9, A-6, A-7, EC-9, EC-10 | T-12 | Integración: monto > umbral → 202 sin mover dinero; código correcto → completada; 3 fallos → `EXPIRED`; reconfirmar completada → 200 sin doble asiento; saldo gastado entre crear y confirmar → `REJECTED`. | 0.50 | `95f5e3e` |
| T-14 | Rutas HTTP de transferencias: `POST /transfers` (Idempotency-Key obligatorio, `Idempotent-Replayed`), `GET /transfers/:id`, `POST /transfers/:id/confirm`; mapeo de errores. | `api` | R4.2, R4.9–R4.11, R4.13, R6.3 | T-13 | Integración (Supertest): sin llave → 400; replay devuelve mismo código/cuerpo y encabezado; misma llave con otro cuerpo → 422; monto `10000.5` → 400; transferencia ajena → 404. | 0.50 | `50f6201` |
| T-15 | Pruebas de concurrencia: 100 transferencias simultáneas desde una cuenta; A↔B cruzadas; 20 peticiones con la misma llave. | `api` | R4.8, R4.9, R4.12, EC-1, EC-7, EC-8 | T-14 | La prueba verifica: éxitos = ⌊saldo/monto⌋, saldo final exacto, `SUM(amount_cents)` global = 0, saldo de cada cuenta = suma de sus asientos, cero deadlocks, una sola ejecución por llave. Corre en CI. | 0.50 | `6b6b4d6` |
| T-16 | `GET /accounts/:id/movements`: keyset por `(created_at, id)`, cursor opaco validado, filtros `from`/`to`/`type`, `limit ≤ 100`, contraparte enmascarada. | `api` | R5.1–R5.5 | T-14 | Integración: recorrer todas las páginas no repite ni omite movimientos; filtros por tipo y fechas; `from > to` y cursor alterado → 400. | 0.50 | `81879be` |
| T-17 | Seed (`npm run db:seed`): cuenta `SYSTEM`, usuarios demo con contraseñas documentadas, depósitos iniciales por asientos, beneficiarios, ≥ 100,000 movimientos históricos (inserción por lotes); `EXPLAIN (ANALYZE, BUFFERS)` pegado en `design.md` §10. | `api` | R5.6, NFR-10, NFR-14 | T-16 | `db:seed` idempotente en base limpia; conciliación Σ asientos = 0 tras el seed; plan sin `Seq Scan` sobre `ledger_entries` registrado en `design.md`. | 0.50 | `5602f22` |

## Fase 3 — Web

| ID | Tarea | Etiquetas | Requerimientos | Depende de | Verificación | Est. | Commits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-18 | Vite + React 18 + TS: router, TanStack Query, cliente HTTP tipado con los tipos generados, sesión (access en memoria, refresh por cookie, *single-flight*), layout accesible, componentes de carga/vacío/error. | `web` | R1.10, R2.5, NFR-12 | T-04, T-08 | `npm run dev -w web` levanta; recargar la página mantiene la sesión vía refresh; prueba unitaria del *single-flight*. | 0.50 || `ca98ef6` |
| T-19 | Pantallas de login y registro con validación compartida y manejo de 401/409/429. | `web` | R1.1–R1.6 | T-18 | Testing Library: errores por campo, mensaje de credenciales, botón deshabilitado al enviar; navegación con teclado. | 0.25 || `9adbee7` |
| T-20 | Resumen de cuentas con saldo (`formatCents` en `es-MX`) y límite diario disponible. | `web` | R2.1, R2.4, R2.5, R6.8 | T-18 | Testing Library: estados de carga, vacío, error y éxito; `$1,234.56` correcto a partir de `123456`. | 0.25 || `0a239a6`, `506cf00` |
| T-21 | Historial: filtros fecha/tipo en la URL, `useInfiniteQuery` con "Cargar más" por cursor. | `web` | R5.3, R5.8 | T-20, T-16 | Testing Library + MSW: cambiar filtro reinicia la lista; "Cargar más" pide `cursor`; estado vacío. | 0.25 || `9703591` |
| T-22 | Beneficiarios: lista y alta con validación de CLABE en vivo (misma función que la API) y errores de negocio. | `web` | R3.1–R3.5, R3.7 | T-18, T-10 | Testing Library: CLABE con dígito erróneo bloquea el envío; 409/422 se muestran junto al campo. | 0.25 || `30722a9` |
| T-23 | Flujo de transferencia: formulario → confirmación (genera `Idempotency-Key` una vez) → OTP → comprobante; botón bloqueado; reintento con la misma llave; invalidación de caché. | `web` | R4.14, R4.15, R4.11, R6.3, R6.6, EC-1 | T-20, T-22, T-14 | Revisión manual contra API local con usuario demo (completada, OTP, saldo insuficiente). | 0.50 || `9bce81b`, `cfb92e6`, `d5bb53d` |
| T-24 | Pruebas del flujo de transferencia con Testing Library + MSW: éxito, saldo insuficiente, doble clic (una sola petición), reintento tras error de red con la misma llave, OTP inválido. | `web` | R4.5, R4.14, NFR-11 | T-23 | `npm test -w web` en verde; el caso `INSUFFICIENT_FUNDS` muestra el mensaje y no navega al comprobante. | 0.50 || `8602b5a` |

## Fase 3 — Móvil

| ID | Tarea | Etiquetas | Requerimientos | Depende de | Verificación | Est. | Commits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-25 | Expo + TS: cliente tipado, tokens en `expo-secure-store` (regla ESLint que prohíbe `AsyncStorage`), login, URL de API configurable para Expo Go; verificar `formatCents` en Hermes. | `mobile` | R1.11, R1.4 | T-04, T-08 | Login contra API local desde Expo Go/simulador; prueba que el almacenamiento usado es SecureStore. | 0.50 | |
| T-26 | Inicio: saldo de cuentas y últimos 20 movimientos, *pull-to-refresh*, estados de carga/vacío/error/sin conexión. | `mobile` | R2.1, R2.5, R5.7 | T-25, T-16 | Prueba de componente con estados; revisión manual en simulador. | 0.25 | |
| T-27 | Transferencia a beneficiario existente: revisión, envío con máquina de estados de §5.4 (llave persistida, NetInfo, backoff, "Verificar de nuevo"), OTP y resultado. | `mobile` | R4.16, R4.17, R6.3, EC-2 | T-26, T-14 | Prueba unitaria de la máquina: tras error de red el reintento usa la misma llave; tras 4 fallos queda en `EstadoDesconocido`; manual: modo avión a mitad del envío y luego reconexión muestra el estado real. | 0.50 | |
| T-28 | Cubierta de privacidad al pasar a segundo plano; pruebas de la cubierta. | `mobile` | NFR-13 | T-25 | Prueba: cambiar `AppState` a `background` renderiza la cubierta y oculta saldos. | 0.25 | |

## Transversal

| ID | Tarea | Etiquetas | Requerimientos | Depende de | Verificación | Est. | Commits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-29 | GitHub Actions: lint + pruebas de `api` (con PostgreSQL de servicio, migraciones y concurrencia), `web` y `mobile`; cache de npm. | `api` `web` `mobile` | NFR-15 | T-15, T-24, T-28 | Pipeline en verde en la rama principal. | 0.25 | |
| T-30 | `/docs/aws-deploy.md`: diagrama Mermaid, cómputo, base de datos (Multi-AZ, PITR, RPO/RTO), web, móvil, observabilidad y auditoría, CI/CD con OIDC, conexiones (RDS Proxy), crecimiento 100×, IaC. | `api` `web` `mobile` | Fase 4 | T-17 | Revisión contra la tabla de la Fase 4: todos los temas y preguntas respondidos. | 0.50 | |
| T-31 | `README.md`: correr en local, pruebas, Expo Go/simulador, credenciales demo, "qué haría con más tiempo"; actualizar `ai-log.md`. | `api` `web` `mobile` | NFR-14, NFR-16 | T-29, T-30 | Seguir el README desde un clon limpio levanta API, base con seed y web. | 0.25 | |

## Bonus (fuera del presupuesto, solo si sobra tiempo)

| ID | Tarea | Etiquetas | Requerimientos | Depende de | Verificación | Est. | Commits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-32 | Exportar estado de cuenta del mes en CSV (`GET /accounts/:id/statement?month=YYYY-MM`, `text/csv`, montos como cadenas decimales exactas) y botón en web. | `api` `web` | Bonus | T-16, T-21 | Integración: suma del CSV = variación de saldo del mes; prueba del botón. | 0.75 | |

## Matriz requerimiento → tarea

| Requerimiento | Tareas |
| --- | --- |
| R1 Registro e inicio de sesión | T-05, T-07, T-08, T-18, T-19, T-25 |
| R2 Cuentas y saldo | T-03, T-09, T-20, T-26 |
| R3 Beneficiarios y CLABE | T-03, T-10, T-22 |
| R4 Transferencias | T-06, T-11, T-14, T-15, T-23, T-24, T-27 |
| R5 Historial | T-16, T-17, T-21, T-26 |
| R6 Límite diario y OTP | T-09, T-12, T-13, T-14, T-23, T-27 |
| NFR-1 … NFR-4 Integridad, montos, concurrencia, auditoría | T-03, T-05, T-06, T-11, T-15 |
| NFR-5 … NFR-8 Errores, logs, validación, capas | T-02, T-03, T-11 |
| NFR-9 … NFR-16 Stack, rendimiento, pruebas, a11y, privacidad, entorno, CI, trazabilidad | T-01, T-04, T-17, T-18, T-24, T-28, T-29, T-31 |
