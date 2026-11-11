# Bitácora de uso de AI

> Registro honesto del uso de AI en la prueba. Se actualiza al cerrar cada fase. Lo que todavía no ha ocurrido se marca como **pendiente**; no se registran revisiones, pruebas ni decisiones humanas que no hayan sucedido.

## Herramientas

| Herramienta | Uso | Modo |
| --- | --- | --- |
| Claude Code (Anthropic), sesión en la nube ligada al repositorio | Redacción de las specs de la Fase 1 | Flujo *SPEC-first / plan-first* manual: primero `/specs`, revisión humana, y solo después implementación. No se usó un modo SPEC nativo tipo Kiro. |

## Fase 1 — Especificación (2026-11-10)

### Prompt clave (escrito por el candidato)

Resumen fiel del prompt inicial:

> Desarrollar la prueba técnica Fullstack Fintech de Treo con metodología SPEC-first, respetando todos los requerimientos y con un presupuesto objetivo de 14 horas. Fase 1: leer íntegramente el documento de la prueba y crear exclusivamente `/specs/requirements.md`, `design.md`, `tasks.md` y `ai-log.md`, cumpliendo el contenido requerido para cada uno. En el diseño priorizar: integridad financiera y montos exactos en centavos; transacciones PostgreSQL y concurrencia segura; idempotencia para evitar transferencias duplicadas; asientos contables balanceados; autenticación y protección de datos; arquitectura sencilla, mantenible y funcional. Incluir el ER en Mermaid y el contrato OpenAPI 3.1. En `tasks.md`, tareas pequeñas y verificables ligadas a requerimientos y etiquetadas `api`, `web` o `mobile`. No generar código de aplicación, migraciones ni frontend/backend. Registrar honestamente el uso de AI sin inventar pruebas, revisiones ni decisiones humanas. Preparar los cambios para revisión manteniendo el historial de Git y no continuar hasta aprobar las specs.

### Qué hizo la AI

1. Leyó el documento de la prueba completo (`Prueba Técnica — Backend Developer (AWS · Node.js · PostgreSQL · AI en modo SPEC).md`).
2. Redactó los cuatro archivos de `/specs` en una rama separada para revisión por PR (sin código de aplicación).
3. Validó mecánicamente el contrato OpenAPI 3.1 de `design.md` §7 con `@redocly/cli lint` (resultado: válido; quedaron solo advertencias cosméticas como falta de licencia y descripciones de tags).
4. Verificó la fórmula del dígito verificador de CLABE contra un ejemplo público (`002010077777777771` → dígito `1`).

### Decisiones propuestas por la AI (pendientes de validación humana)

Estas decisiones las propuso la AI en el borrador. **Ninguna ha sido revisada ni aprobada todavía por el candidato.**

| Decisión propuesta | Alternativa que la AI consideró y descartó | Razón dada por la AI |
| --- | --- | --- |
| `READ COMMITTED` + `SELECT … FOR UPDATE` en orden determinista (usuario → cuentas por `id`) | `SERIALIZABLE` con reintentos | Con 100 transferencias simultáneas desde una cuenta, `SERIALIZABLE` provocaría muchos abortos `40001` y pruebas inestables. |
| Saldo actualizado por trigger al insertar cada asiento, con `CHECK` de no negativo y sin `UPDATE` directo del rol de la app sobre `balance_cents` | Que el servicio actualice el saldo y escriba los asientos por separado | Evita que saldo y libro diverjan si el código tiene un error; la base es la última defensa. |
| Idempotencia en la propia tabla `transfers` con `UNIQUE (user_id, idempotency_key)` + hash del cuerpo | Tabla genérica de idempotencia o caché en memoria/Redis | Queda en la misma transacción que el movimiento de dinero; no puede desincronizarse. |
| Persistir rechazos de negocio como `REJECTED` (la llave queda consumida) | No persistir rechazos | Reintentos con la misma llave dan siempre la misma respuesta (supuesto A-5). |
| Montos como `integer` (centavos) en JSON y `number` validado con `Number.isSafeInteger` en TS | `BigInt` o cadenas decimales en la API | Simplicidad en los tres clientes; el rango seguro excede por mucho cualquier saldo realista. |
| Día del límite calculado en SQL a partir del mismo `now()` que se guarda como `completed_at` | Calcular el día en Node con la hora del proceso | Evita que el día del límite y la fecha registrada difieran al cruzar la medianoche. |
| Refresh token en cookie `HttpOnly` para web y en `expo-secure-store` para móvil | Refresh en `localStorage` | `localStorage` expone el token a XSS. |

### Riesgos con el dinero detectados durante la redacción

- **Formato de montos con `Intl.NumberFormat`:** la forma habitual (`cents / 100`) es una división en punto flotante. La spec exige construir la cadena decimal exacta y documenta una alternativa por si Hermes no acepta cadenas decimales (verificación pendiente en T-25).
- **`BIGINT` en TypeORM llega como `string`:** si se tratara como número sin validar podría concatenarse en lugar de sumarse. La spec exige un `ValueTransformer` con validación.
- **Transferencias que esperan OTP:** no apartan saldo; por eso la spec exige revalidar saldo y límite al confirmar (EC-10).

### Dónde hubo que corregir a la AI

Durante la redacción, la propia AI corrigió en su borrador la suma de estimaciones de `tasks.md` (los subtotales no coincidían con las tareas) antes de entregarlo.

**Correcciones del candidato:** el candidato fusionó el PR #1 de specs el 2026-11-10 sin cambios ni comentarios (el contenido fusionado es idéntico al propuesto). Los supuestos A-1 a A-8 y los montos de límite y OTP se implementaron tal como estaban.

### Qué propuso la AI que fue rechazado

No hubo propuestas rechazadas por el candidato en la Fase 1.

## Fase 2 — Backend (2026-11-10)

### Herramienta y modo

Claude Code (Anthropic) en una sesión en la nube ligada al repositorio, siguiendo `tasks.md` tarea por tarea (T-01 a T-17), con un commit por tarea. La AI ejecutó las pruebas y el lint después de cada tarea en un PostgreSQL 16 local.

### Prompt clave (escrito por el candidato)

Resumen fiel:

> Implementar el backend siguiendo estrictamente las specs aprobadas y el documento original. Stack: Node.js 20+, Express, TypeScript estricto, PostgreSQL 15+, TypeORM con migraciones y `synchronize` desactivado. Cubrir todos los requisitos obligatorios de backend, en especial autenticación, transferencias atómicas, idempotencia, concurrencia, auditoría, historial paginado y pruebas automatizadas. Incluir Docker Compose, `.env.example` sin secretos reales y scripts de migración, seed y ejecución. Trabajar siguiendo `tasks.md` con commits separados por tarea. Ejecutar las verificaciones disponibles y reportar las pruebas que no se pudieron ejecutar. No implementar todavía React ni React Native. Actualizar `ai-log.md` con honestidad. Preparar los cambios para revisión.

### Errores de la AI detectados y corregidos durante la implementación

Los errores 1 a 7 los encontró la propia AI (con pruebas o al revisar su código) antes de abrir el PR. El 8 lo encontró el candidato al validar en su máquina. **El candidato todavía no ha revisado el código de la Fase 2.**

| # | Qué hizo mal la AI | Cómo se detectó | Corrección |
| --- | --- | --- | --- |
| 1 | **Inventó una CLABE "válida"** (`012180001234567893`) para las pruebas unitarias; su dígito verificador era incorrecto. | La prueba falló. | Se dejaron solo CLABEs de ejemplo públicas verificadas con el algoritmo. Es relevante en finanzas: la AI generó datos de apariencia real que no lo eran. |
| 2 | La primera versión de `AuditService` armaba el `jsonb` de metadatos **interpolando una cadena en SQL** (riesgo de inyección). | Revisión propia antes del commit. | Consulta parametrizada (`$1…$7`). |
| 3 | Leyó el resultado de `UPDATE … RETURNING` con `manager.query` como si fuera una lista de filas; TypeORM devuelve `[filas, conteo]`. El logout no quedaba auditado. | Prueba de integración. | `WITH … UPDATE … RETURNING` + `SELECT`. |
| 4 | Usó `instanceof ZodError`; `@treo/shared` puede traer otra copia de zod y un error de validación terminaba en **500** en lugar de 400. | Prueba de integración. | Detección por nombre y forma del error. |
| 5 | El seed insertaba 60,000 transferencias en una sola transacción: **7.5 minutos**. El trigger de saldo actualiza la misma fila de `accounts` miles de veces dentro de una transacción. | Medición al correr el seed. | Lotes de 1,000 (≈16 s). Documentado en `design.md` §10. |
| 6 | Dos commits se hicieron con un error de lint o de TypeScript, porque un `| tail` ocultaba el código de salida. | Revisión del resultado. | Se corrigieron con `--amend` antes de publicar la rama. |
| 7 | Detalles menores: configuración de proyectos de Vitest 2.x y un parámetro SQL usado con dos tipos en un helper de pruebas. | Errores al ejecutar. | Ajustados. |
| 8 | Publicó PostgreSQL de Docker en el puerto 5432 del host sin considerar que el revisor ya podía tener un PostgreSQL instalado ahí. | **Lo detectó el candidato** al validar en Windows: la conexión llegaba a su PostgreSQL local y fallaba la autenticación (`28P01`). | Docker Compose ahora publica en el puerto 55432 (primero se cambió a 5433, pero el candidato también tenía un PostgreSQL 13 escuchando ahí); `.env.example`, las pruebas y el README se actualizaron. |

### Riesgos con el dinero que la AI previno por diseño

- **Precisión del cursor:** un `Date` de JS tiene milisegundos y `timestamptz` tiene microsegundos. Un cursor basado en `Date` duplicaría u omitiría movimientos, así que el cursor viaja como texto con microsegundos y la prueba recorre todas las páginas.
- **`BIGINT` como `string`:** un `ValueTransformer` convierte a `number` solo enteros seguros y lanza error en otro caso.
- **Saldos:** la app no tiene `UPDATE` sobre `balance_cents`; solo el trigger del libro lo modifica (probado con el rol `treo_app`).

### Decisiones tomadas por la AI durante la implementación (pendientes de revisión del candidato)

| Decisión | Motivo |
| --- | --- |
| **Aclaración a R4.9 / `design.md` §5.3:** una repetición con la misma llave devuelve el estado actual de la misma transferencia (si se confirmó con OTP, responde `201 COMPLETED`). | Para que el móvil vea el estado real tras perder la red (R4.17). Mientras no hay cambio de estado, la respuesta es idéntica a la original. Se marcó como aclaración en ambos documentos. |
| `SAME_ACCOUNT_TRANSFER` no se persiste como `REJECTED` (la llave no se consume). | El `CHECK origen ≠ destino` de la base impide guardar esa fila; el resultado es determinista de todos modos. |
| El rate limit de login cuenta todos los intentos, no solo los fallidos. | Es la lectura literal de R1.6. |
| Usar un refresh token después de logout se trata como reutilización y revoca la familia. | Es el comportamiento más seguro. |
| La expiración de un OTP se evalúa al intentar confirmar; `GET /transfers/:id` muestra `PENDING_OTP` hasta entonces. | Simplicidad. Se anotó en "Qué haría con más tiempo". |
| Express 5 y un límite general de 30 peticiones/min por IP en `/auth/*` (configurable). | Express 5 maneja promesas rechazadas de forma nativa. El límite es una defensa adicional. |

### Qué no se pudo verificar

- **`docker compose up`:** el entorno de la AI no tiene daemon de Docker. Solo se validó la sintaxis con `docker compose config`. Las pruebas corrieron contra un PostgreSQL 16 local preparado con el mismo script `docker/postgres/init/01-roles-and-databases.sql`.
  - **Actualización (2026-11-10):** el candidato levantó el `docker compose` en su máquina con Windows y Docker Desktop, y ahí corrió `npm test` (51 y 103 pruebas pasaron; la suite de la API tardó unos 226 s) y `npm run dev` (la API arrancó en el puerto 3000). Después probó a mano desde `/docs`: una transferencia P2P de $50 respondió `201 COMPLETED`; repetir una llave con otro contenido respondió `422 IDEMPOTENCY_KEY_REUSED`; y un monto mayor al saldo respondió `422 INSUFFICIENT_FUNDS` con la transferencia guardada como `REJECTED`.
- **Node 20:** todo se ejecutó con Node 22.23. No se probó con Node 20.
- **CI (T-29):** aún no existe el pipeline. Se hará cuando existan `web` y `mobile`, como indica `tasks.md`.
- **Revisión humana del código:** pendiente.

## Fase 3a — Web (2026-11-10)

### Herramienta y modo

Claude Code (Anthropic) en la misma sesión en la nube, siguiendo `tasks.md` de T-18 a T-24 con un commit por tarea. Después de cada tarea la AI corrió `tsc`, ESLint, Prettier y las pruebas de la web.

### Prompt clave (escrito por el candidato)

Resumen fiel:

> Continuar con la Fase 3 empezando solo por el frontend web en React. Implementar todas las pantallas y funcionalidades web obligatorias del documento original con React, TypeScript y Vite, según las specs aprobadas. Consumir los endpoints reales del backend y compartir tipos y validaciones. Implementar estados de carga, vacío y error; paginación por cursor; confirmación y comprobante de transferencia; y pruebas con Testing Library. La llave de idempotencia debe generarse una sola vez por intento de transferencia. Mantener la trazabilidad de `tasks.md` y commits separados. Actualizar `ai-log.md` y reportar las pruebas realmente ejecutadas. No implementar todavía la app móvil.

### Errores de la AI detectados y corregidos

Todos los encontró la propia AI antes de abrir el PR. **El candidato todavía no ha revisado el código de la Fase 3.**

| # | Qué hizo mal la AI | Cómo se detectó | Corrección |
| --- | --- | --- | --- |
| 1 | Tras un `201`, la pantalla de confirmación borraba el intento y **redirigía al formulario en lugar del comprobante**. React aplicaba el borrado del intento antes que la navegación, que corre como transición. Las pruebas de ese momento no cubrían el camino completo. | Prueba en navegador contra la API local: la transferencia sí se creó (201), pero la pantalla volvió al formulario. | Se marca el intento como terminado antes de navegar. Las pruebas de T-24 cubren ahora la llegada al comprobante. |
| 2 | La primera versión guardaba la llave **solo en memoria**. Si el usuario recargaba tras un error de red y volvía a capturar, se generaba otra llave y la transferencia podía duplicarse. `design.md` §5.3 pide conservarla hasta un resultado definitivo. | Revisión propia al redactar esta bitácora. | El intento (cuerpo + llave, sin tokens) se guarda en `sessionStorage` y se borra al tener resultado, al editar o al cerrar sesión. Se agregó una prueba que simula la recarga. |
| 3 | Detalles menores: dos copias de Vite con tipos incompatibles por fijar una versión exacta y un caso de prueba que no probaba nada (el campo limita a 7 caracteres, así que escribir 8 dígitos daba una referencia válida). | Errores de `tsc` y una prueba que falló. | Se alineó la versión de Vite y se corrigió el caso. |

### Decisiones tomadas por la AI (pendientes de revisión del candidato)

| Decisión | Motivo |
| --- | --- |
| La llave se genera al pasar del formulario a la confirmación (no al montar la pantalla). | Es el mismo momento que pide R4.14 y evita depender de efectos que React ejecuta dos veces en modo estricto. |
| En desarrollo, Vite redirige `/api` a la API. | La cookie del refresh (`Path=/api/v1/auth`, `SameSite=Strict`) queda en el mismo origen sin configurar CORS con credenciales. |
| La web consume el código fuente TypeScript de `@treo/shared` (alias de Vite) en lugar del `dist` CommonJS. | Mismas reglas de CLABE, montos y esquemas que la API, sin un paso de compilación extra. |
| Un rechazo de negocio no ofrece "Reintentar", solo "Corregir datos" (con llave nueva). | La llave ya quedó consumida por el rechazo; reenviarla devolvería el mismo resultado. Los errores de red y `5xx` sí se reintentan con la misma llave. |
| Se agregó una guardia síncrona además del botón deshabilitado. | Evita dos envíos aunque lleguen dos clics antes de que React vuelva a pintar. |

### Cambios pedidos por el candidato

- Al probar la web en su máquina, el candidato pidió que la referencia numérica se generara automáticamente. Ahora se llena con 7 dígitos al azar, se puede cambiar o regenerar, y se valida igual que antes (commit `d5bb53d`).
- También pidió que el nombre del usuario apareciera en el resumen. Ahora el resumen saluda con el nombre y el encabezado lo muestra junto a "Cerrar sesión" (commit `506cf00`).

### Pruebas realmente ejecutadas

- **Vitest + Testing Library + MSW (`npm test -w @treo/web`): 48 pruebas en verde** en 7 archivos: sesión y *single-flight* (5), `RequireAuth` (2), login y registro (9), cuentas (5), historial (6), beneficiarios (6) y flujo de transferencia (15).
- Se verificó que las pruebas del flujo fallan si se quita la guardia de doble clic o si se genera una llave nueva en cada envío.
- **Prueba en navegador contra la API real** (Chromium con Playwright, API y PostgreSQL 16 locales, usuario demo): login y sesión tras recargar (cookie `HttpOnly`, `SameSite=Strict`, nada en `localStorage`/`sessionStorage`), transferencia completada con doble clic (1 sola petición `POST /transfers`, el saldo bajó $50.00), OTP inválido (quedan 2 intentos) y válido, `100.005` rechazado sin enviar, saldo insuficiente (mensaje, sin comprobante), historial con filtro en la URL, "Cargar más" con el usuario `historial@` (20 → 40) y rango vacío, CLABE con dígito erróneo y CLABE externa, logout. Lo hizo la AI con un script; no es una revisión del candidato.
- **axe-core 4.10 (WCAG 2 A/AA)** en login, registro, cuentas, historial, beneficiarios y transferencia (con errores de validación visibles): sin violaciones. Incluye contraste de color.
- Durante esas corridas, el login de `ana@` empezó a fallar tras varios intentos: era el rate limit de R1.6 (5 por 15 min). Se reinició la API para continuar.
- `npm run lint`, `npm run typecheck` y `npm run build -w @treo/web` pasan.

### Qué no se pudo verificar

- **Navegadores distintos de Chromium** (Firefox, Safari): no se probaron.
- **Lector de pantalla real:** solo se revisó con axe-core y con navegación por teclado en las pruebas; no se probó con NVDA ni VoiceOver.
- **En la máquina del candidato:** está probando la web; todavía no ha revisado el código.

## Fases siguientes

| Fase | Estado |
| --- | --- |
| Fase 3b — Móvil | Pendiente |
| Fase 4 — Propuesta AWS | Pendiente |

Plantilla para cada entrada futura:

```
### <Fecha> — <Tarea T-xx>
- Herramienta y modo:
- Prompt clave:
- Qué generó la AI:
- Qué se rechazó y por qué:
- Qué se corrigió (especialmente cualquier cosa insegura o incorrecta con el dinero):
- Cómo se verificó (prueba / revisión):
```
