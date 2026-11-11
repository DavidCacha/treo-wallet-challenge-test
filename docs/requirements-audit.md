# Auditoría de requisitos contra la prueba original

Revisión del 2026-11-11 (Fase 4). Cada fila compara un requisito del documento original con el código y la prueba que lo demuestra.

**Estados:**

- **Completo:** hay código y una prueba o evidencia ejecutada.
- **Parcial:** falta parte de la evidencia.
- **Pendiente:** no está hecho.

Las corridas citadas se ejecutaron en el entorno en la nube de la AI (Node 22, PostgreSQL 16.15) el 2026-11-11, salvo donde se indica que las hizo el candidato. "CI" es el workflow `.github/workflows/ci.yml`.

## Historias de usuario

| # | Requisito | Implementación | Estado | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- |
| 1 | Registro e inicio de sesión | `api/src/modules/auth`, `web/src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `mobile/src/screens/LoginScreen.tsx` | Completo | `api/test/integration/auth.test.ts`, `web/src/pages/auth.test.tsx`, `mobile/src/screens/LoginScreen.test.tsx`, `mobile/src/live/api.live.test.ts` | — (en móvil solo login, como pide el alcance reducido) |
| 2 | Ver cuentas con saldo disponible | `api/src/modules/accounts`, `web/src/pages/DashboardPage.tsx`, `mobile/src/screens/HomeScreen.tsx` | Completo | `accounts.test.ts`, `DashboardPage.test.tsx`, `HomeScreen.test.tsx`; el candidato vio los saldos en su Android con Expo Go | — |
| 3 | Beneficiario con nombre, alias y CLABE de 18 dígitos con dígito verificador | `packages/shared/src/clabe.ts`, `api/src/modules/beneficiaries`, `web/src/pages/BeneficiariesPage.tsx` | Completo | `packages/shared/test/clabe.test.ts`, `beneficiaries.test.ts`, `BeneficiariesPage.test.tsx` | — |
| 4 | Transferencia a beneficiario u otra cuenta propia, con concepto y referencia numérica | `api/src/modules/transfers`, `web/src/transfer/*`, `mobile/src/transfer/*` (móvil: solo beneficiarios, como pide la prueba) | Completo | `transfers.test.ts`, `web/src/transfer/transferFlow.test.tsx`, `mobile/src/transfer/TransferFlow.test.tsx`, pruebas *live* | — |
| 5 | Historial con filtros por fecha y tipo, paginado | `api/src/modules/movements` (cursor), `web/src/pages/MovementsPage.tsx`; móvil: últimos 20 | Completo | `movements.test.ts` (cursor sin duplicados ni omisiones), `MovementsPage.test.tsx`, `HomeScreen.test.tsx` | — |
| 6 | Límite diario y código de un solo uso por monto | `api/src/modules/transfers/daily-limit.ts`, `otp.ts`; pantallas OTP en web y móvil | Completo | `daily-limit.test.ts` (incluye medianoche en CDMX), `otp.test.ts`, flujo OTP en web y móvil, prueba *live* de OTP | — |
| — | Bonus (CSV/PDF, transferencias programadas, biometría) | — | No hecho (opcional) | — | Opcional (T-32) |

## Fase 1: especificación

| Requisito | Implementación | Estado | Evidencia | Acción |
| --- | --- | --- | --- | --- |
| `/specs` versionada antes del código | `specs/` | Completo | Historial: `b1525ab` [T-00] (PR #1) es anterior al primer commit de código `efb1a22` [T-01] | — |
| `requirements.md` con EARS/Given-When-Then y casos borde (doble clic, red en móvil, redondeo, medianoche, propia cuenta) | `specs/requirements.md` | Completo | Secciones R1–R6, NFR y casos borde EC-1…EC-12 | — |
| `design.md`: ER Mermaid, OpenAPI 3.1, concurrencia, idempotencia, auth, errores, pantallas | `specs/design.md`, `packages/shared/openapi.yaml` | Completo | `npm run lint:openapi` válido | — |
| `tasks.md` con tareas ligadas a requerimientos y etiquetas | `specs/tasks.md` | Completo | Matriz requerimiento → tarea | — |
| `ai-log.md` honesto | `specs/ai-log.md` | Completo | Entradas por fase con errores corregidos y lo no verificado | — |
| Cada tarea ↔ uno o más commits | `specs/tasks.md`, columna Commits | Completo | T-00…T-31 con hash; T-32 (bonus) sin hacer | — |

## Fase 2: backend

| Requisito | Implementación | Estado | Evidencia | Acción |
| --- | --- | --- | --- | --- |
| Node 20+, Express, PostgreSQL 15+, TS estricto, TypeORM | `package.json` (`engines >=20`), `tsconfig.base.json` (`strict`), `api/src/db` | Completo | `npm run typecheck`; CI con Node 22 y PostgreSQL 16 | — |
| Migraciones TypeORM con `synchronize` desactivado | `api/src/db/migrations`, `api/src/db/data-source.ts` (`synchronize: false`) | Completo | `npm run db:migrate` en base limpia (local y CI) | — |
| Capas/módulos; lógica financiera fuera de los handlers | `api/src/modules/*/…service.ts`, `policy.ts` | Completo | `api/test/unit/transfer-policy.test.ts` | — |
| Validación con esquema y errores RFC 7807 sin detalles internos | Zod en `packages/shared/src/schemas.ts`, `api/src/http` | Completo | `api/test/unit/app.test.ts`, respuestas `application/problem+json` en las pruebas de integración | — |
| JWT corto + refresh rotativo, argon2, rate limit en login | `api/src/modules/auth` (`passwords.ts` argon2id), `api/src/http/rate-limit.ts` | Completo | `auth.test.ts` (rotación, reutilización, 429), `authenticate.test.ts` | Cognito opcional: descrito como evolución en `docs/aws-deploy.md` §12 |
| Transacción con `FOR UPDATE` en orden determinista (justificado) | `api/src/modules/transfers/transfers.service.ts`, `design.md` §5.1–5.2 | Completo | `concurrency.test.ts` (A↔B sin deadlocks) | — |
| `CHECK` saldo ≥ 0, FKs, único de idempotencia, asientos que suman cero | `api/src/db/migrations/1731250100000-Ledger.ts` | Completo | `db-integrity.test.ts` (23514, 23505, suma cero al COMMIT) | — |
| Auditoría solo inserción con permisos | Migraciones (`REVOKE` + trigger) | Completo | `db-integrity.test.ts` (`treo_app` recibe 42501 en UPDATE/DELETE/TRUNCATE) | — |
| Índices de historial + `EXPLAIN ANALYZE` con ≥ 100,000 movimientos | `design.md` §10; seed de 120,016 asientos | Completo | Plan en `design.md`; medido de nuevo el 2026-11-11 en una base recién sembrada: `Index Only Scan`, 4 buffers, 0.097 ms | — |
| Paginación por cursor (no `OFFSET`) | `api/src/modules/movements/cursor.ts` | Completo | `movements.test.ts` | — |
| Logs JSON con request ID y datos sensibles enmascarados | `api/src/lib/logger.ts` (pino + redact) | Completo | `app.test.ts` (redacción); salida observada con `req.id` | — |
| Unitarias de servicios y CLABE | `api/test/unit`, `packages/shared/test` | Completo | 51 pruebas de shared, unitarias de API | — |
| Integración contra PostgreSQL real: idempotencia, límite diario, saldo no negativo | `api/test/integration` | Completo | 103 pruebas de API en verde (local y CI) | — |
| ≥ 100 transferencias simultáneas que cuadran al centavo | `concurrency.test.ts` | Completo | En verde local y en CI | — |
| `db:migrate`, `db:seed`, `dev` documentados | `README.md` | Completo | Seguido por el candidato en Windows (Fase 2); CI corre migraciones y seed | — |

## Fase 3: frontend

| Requisito | Implementación | Estado | Evidencia | Acción |
| --- | --- | --- | --- | --- |
| Monorepo con tipos compartidos generados del OpenAPI | `packages/shared` (`gen:types`), consumido por api, web y móvil | Completo | `npm run typecheck`, `typecheck:mobile` | `/mobile` fuera de los workspaces de npm (React 19 vs 18), explicado en `ai-log.md` |
| Web React 18 + TS + Vite | `web/` | Completo | `npm run build -w @treo/web` | — |
| Pantallas web: login, resumen, historial, beneficiarios, transferencia con confirmación y comprobante | `web/src/pages`, `web/src/transfer` | Completo | 49 pruebas de web; validado por el candidato en su máquina | — |
| TanStack Query con estados de carga, vacío y error | `web/src/components/States.tsx` y páginas | Completo | Pruebas de cada página | — |
| Validación compartida, botón bloqueado, una llave por intento | `web/src/transfer/TransferReviewPage.tsx`, `TransferFlow.tsx` | Completo | `transferFlow.test.tsx` (doble clic, misma llave en reintentos, recarga) | — |
| `Intl.NumberFormat` es-MX sin `float` | `packages/shared/src/money.ts`; ESLint prohíbe `parseFloat`/`toFixed` | Completo | `money.test.ts` | — |
| Accesibilidad básica | Etiquetas, foco y teclado | Completo | Pruebas con teclado; axe-core sin violaciones (Fase 3a) | — |
| Prueba del flujo de transferencia con saldo insuficiente | `web/src/transfer/transferFlow.test.tsx` | Completo | Caso `INSUFFICIENT_FUNDS` | — |
| Móvil TS + Expo: login, saldo, últimos 20, transferencia a beneficiario | `mobile/` | Completo | 48 pruebas de móvil + 7 *live*; el candidato abrió la app en Android con Expo Go | iOS no probado en dispositivo |
| Tokens en almacenamiento seguro, nunca AsyncStorage | `mobile/src/api/secureStorage.ts`, regla ESLint | Completo | `session.test.ts` | — |
| Red inestable: misma llave y estado real | `mobile/src/transfer/machine.ts` | Completo | `machine.test.ts`, `TransferFlow.test.tsx`, prueba *live* de respuesta perdida | Prueba manual de modo avión en un dispositivo no confirmada |
| Ocultar contenido en segundo plano | `mobile/src/components/PrivacyGuard.tsx` (+ `FLAG_SECURE` en Android) | Completo | `PrivacyGuard.test.tsx`; el candidato confirmó el arreglo en Android | — |

## Fase 4 y entregables

| Requisito | Implementación | Estado | Evidencia | Acción |
| --- | --- | --- | --- | --- |
| `/docs/aws-deploy.md` con Mermaid y todos los temas | `docs/aws-deploy.md` | Completo | Revisado contra la tabla de la Fase 4; el diagrama se renderiza con mermaid-cli | — |
| Swagger UI / Redoc local | `http://localhost:3000/docs` | Completo | `GET /docs/` → 200 y `openapi.json` 3.1.0 | — |
| Instrucciones de Expo Go / simulador | `mobile/README.md`, `README.md` | Completo | El candidato las siguió en Android | — |
| README: correr en local, pruebas, "qué haría con más tiempo" | `README.md` | Completo | — | — |
| CI con lint y pruebas de los tres proyectos, en verde en la rama principal | `.github/workflows/ci.yml` | Parcial | En verde en el PR #5 (ver README) | Falta verlo en verde en `main` después del merge |
| Historial completo sin squash | Merges con merge commit (PR #1–#4) | Completo | `git log --merges` | Seguir usando "Create a merge commit" |
| Sin secretos ni `.env` reales en Git | `.gitignore` | Completo | Solo hay `*.env.example` con valores de desarrollo; búsqueda de patrones de llaves en todo el historial sin resultados | — |
| Video de 5 minutos (web y móvil, con saldo insuficiente) | — | Pendiente | — | Lo graba el candidato; guion sugerido en la entrega |
