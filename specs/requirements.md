# Requerimientos — Billetera digital MXN (Treo)

> Estado: **borrador para revisión** · Fase 1 (SPEC) · Ningún código de aplicación existe todavía.
> Documentos relacionados: [`design.md`](./design.md) · [`tasks.md`](./tasks.md) · [`ai-log.md`](./ai-log.md)

## 1. Alcance

Billetera digital en pesos mexicanos (MXN) con backend (Node.js + Express + PostgreSQL + TypeORM), panel web (React) y app móvil (React Native / Expo). El usuario consulta sus cuentas, registra beneficiarios y envía transferencias **entre cuentas de la misma plataforma**. No hay integración con SPEI ni con bancos reales.

Principio rector: alcance pequeño donde el dinero **siempre cuadra**. Ante la duda, se rechaza la operación en lugar de aproximarla.

### 1.1 Fuera de alcance

- Depósitos y retiros reales (el saldo inicial proviene del seed mediante asientos contables desde una cuenta de sistema).
- Transferencias a otros bancos (SPEI real), comisiones e impuestos.
- Envío real de SMS/correo para el código de un solo uso (se simula; ver R6).
- Despliegue real en AWS (solo propuesta escrita en `/docs/aws-deploy.md`).

### 1.2 Convenciones

- Formato de criterios: **EARS** (`CUANDO … EL sistema DEBE …`, `SI … ENTONCES …`, `MIENTRAS …`, `EL sistema DEBE …`). Los casos borde se expresan además en **Given/When/Then**.
- Identificadores: `R<historia>.<criterio>` para funcionales, `NFR-<n>` para no funcionales, `EC-<n>` para casos borde. `tasks.md` referencia estos IDs.
- "Sistema" = API salvo que se indique `[web]` o `[mobile]`.
- Todos los montos se expresan en **centavos enteros** (`amount_cents`). `1 MXN = 100 centavos`.
- "Día" = día calendario en la zona horaria `America/Mexico_City` (configurable por variable de entorno `BUSINESS_TIMEZONE`).

### 1.3 Parámetros de negocio (valores por defecto, configurables)

| Parámetro | Valor por defecto | Dónde vive |
| --- | --- | --- |
| Límite diario de transferencias a terceros | 50,000.00 MXN (`5_000_000` centavos) | `users.daily_limit_cents` (default por env) |
| Umbral que exige código de un solo uso (OTP) | monto **mayor que** 10,000.00 MXN (`1_000_000` centavos) | env `OTP_THRESHOLD_CENTS` |
| Monto máximo por transferencia | 1,000,000.00 MXN (`100_000_000` centavos) | validación de esquema |
| Vigencia del OTP | 5 minutos | env |
| Intentos máximos de OTP | 3 | env |
| Vigencia del access token (JWT) | 15 minutos | env |
| Vigencia del refresh token | 7 días (rotativo) | env |
| Rate limit de login | 5 intentos / 15 min por IP + correo | env |

## 2. Supuestos (a validar por el revisor humano)

| ID | Supuesto | Alternativa si se rechaza |
| --- | --- | --- |
| A-1 | Al registrarse, el usuario recibe **dos cuentas** (`Principal` y `Ahorro`) con saldo 0 y CLABE interna válida, para poder probar transferencias entre cuentas propias. | Una sola cuenta por usuario. |
| A-2 | Un beneficiario solo puede registrarse si su CLABE es válida **y** pertenece a una cuenta activa de la plataforma que no es del propio usuario (las cuentas propias ya están disponibles como destino sin registrarlas). | Permitir registrar cualquier CLABE válida y fallar al transferir. |
| A-3 | Las transferencias **entre cuentas propias** no consumen el límite diario ni requieren OTP (no hay salida de dinero del usuario). | Que cuenten para el límite. |
| A-4 | El límite diario es **por usuario** (suma de todas sus cuentas), no por cuenta. | Límite por cuenta. |
| A-5 | Una transferencia rechazada por regla de negocio (saldo insuficiente, límite diario) se guarda como `REJECTED` y su llave de idempotencia queda consumida: reintentar con la misma llave devuelve el mismo rechazo. Un nuevo intento del usuario genera una llave nueva. | No persistir rechazos (la llave podría reutilizarse). |
| A-6 | Mientras una transferencia espera OTP (`PENDING_OTP`) **no se aparta saldo**; saldo y límite se vuelven a validar al confirmar. | Retener fondos (hold) al crear. |
| A-7 | En desarrollo, el OTP se escribe en el log del servidor y se devuelve en el campo `dev_otp_code` de la respuesta **solo** si `NODE_ENV=development`. Nunca en producción. | Solo en log. |
| A-8 | No hay alta de usuarios con verificación de correo; el registro es inmediato. | Flujo de verificación. |

## 3. Historias de usuario y criterios de aceptación

### R1 — Registro e inicio de sesión

> Como usuario, me registro e inicio sesión.

- **R1.1** CUANDO un visitante envía correo, nombre completo y contraseña válidos, EL sistema DEBE crear el usuario, sus cuentas (A-1), y responder `201` sin devolver la contraseña ni su hash.
- **R1.2** EL sistema DEBE exigir contraseñas de al menos 10 caracteres y DEBE almacenarlas solo como hash **argon2id**.
- **R1.3** SI el correo ya está registrado, ENTONCES EL sistema DEBE responder `409` con un problema RFC 7807 (`code: EMAIL_ALREADY_REGISTERED`). El correo se normaliza (trim + minúsculas) antes de comparar.
- **R1.4** CUANDO un usuario envía credenciales correctas, EL sistema DEBE devolver un access token JWT (15 min) y un refresh token opaco (7 días).
- **R1.5** SI las credenciales son incorrectas (correo inexistente o contraseña errónea), ENTONCES EL sistema DEBE responder `401` con el **mismo** mensaje y un tiempo de respuesta comparable en ambos casos (sin enumeración de usuarios).
- **R1.6** SI se superan 5 intentos de login en 15 minutos para la misma IP + correo, ENTONCES EL sistema DEBE responder `429` con encabezado `Retry-After`.
- **R1.7** CUANDO se usa un refresh token válido, EL sistema DEBE emitir un nuevo par de tokens e **invalidar** el refresh token usado (rotación).
- **R1.8** SI se presenta un refresh token ya rotado o revocado, ENTONCES EL sistema DEBE revocar toda la familia de tokens de esa sesión, registrar el evento en auditoría y responder `401`.
- **R1.9** CUANDO el usuario cierra sesión, EL sistema DEBE revocar el refresh token vigente.
- **R1.10** `[web]` EL cliente web DEBE mantener el access token solo en memoria; el refresh token viaja en cookie `HttpOnly; Secure; SameSite=Strict`.
- **R1.11** `[mobile]` LA app DEBE guardar los tokens únicamente en `expo-secure-store` (Keychain/Keystore), **nunca** en `AsyncStorage`.
- **R1.12** EL sistema DEBE registrar en auditoría: registro, login exitoso, login fallido, refresh con reutilización detectada y logout.

### R2 — Consultar cuentas y saldo disponible

> Como usuario, veo mis cuentas con su saldo disponible.

- **R2.1** CUANDO un usuario autenticado solicita sus cuentas, EL sistema DEBE devolver solo las cuentas de ese usuario con `id`, `name`, `clabe`, `currency` (`MXN`) y `available_balance_cents` (entero).
- **R2.2** EL saldo disponible DEBE ser igual a la suma de los asientos contables de la cuenta (invariante verificable por prueba de conciliación).
- **R2.3** SI un usuario solicita una cuenta que no le pertenece, ENTONCES EL sistema DEBE responder `404` (no `403`, para no revelar su existencia).
- **R2.4** `[web][mobile]` LOS clientes DEBEN mostrar los montos con `Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })` a partir de centavos enteros, sin aritmética de punto flotante.
- **R2.5** `[web][mobile]` CADA pantalla DEBE tener estados de carga, vacío y error.

### R3 — Registrar beneficiario con CLABE

> Como usuario, registro un beneficiario con nombre, alias y CLABE de 18 dígitos, validando su dígito verificador.

- **R3.1** CUANDO el usuario envía nombre (1–80 caracteres), alias (1–30 caracteres) y CLABE, EL sistema DEBE validar que la CLABE tenga exactamente 18 dígitos numéricos.
- **R3.2** EL sistema DEBE validar el dígito verificador de la CLABE con el algoritmo estándar (pesos `3,7,1` repetidos sobre los primeros 17 dígitos; `dv = (10 − (Σ (dígitoᵢ·pesoᵢ mod 10)) mod 10) mod 10`). SI no coincide, ENTONCES DEBE responder `422` (`code: INVALID_CLABE_CHECK_DIGIT`).
- **R3.3** SI la CLABE no corresponde a una cuenta activa de la plataforma, ENTONCES EL sistema DEBE responder `422` (`code: CLABE_NOT_FOUND`) (A-2).
- **R3.4** SI la CLABE pertenece a una cuenta del propio usuario, ENTONCES EL sistema DEBE responder `422` (`code: BENEFICIARY_IS_OWN_ACCOUNT`).
- **R3.5** SI el usuario ya tiene un beneficiario con esa CLABE, ENTONCES EL sistema DEBE responder `409` (`code: BENEFICIARY_ALREADY_EXISTS`); la unicidad `(user_id, clabe)` se garantiza en la base.
- **R3.6** CUANDO el usuario lista sus beneficiarios, EL sistema DEBE devolver solo los suyos, con la CLABE completa (la CLABE no es secreta, pero en logs DEBE enmascararse, ver NFR-6).
- **R3.7** LA validación de CLABE DEBE vivir en `packages/shared` y usarse tanto en API como en web y móvil (misma regla en todos lados).
- **R3.8** EL sistema DEBE registrar en auditoría el alta de beneficiarios.

### R4 — Enviar transferencia

> Como usuario, envío una transferencia a un beneficiario o a otra cuenta mía, con concepto y referencia numérica.

- **R4.1** CUANDO el usuario envía cuenta origen propia, destino (un `beneficiary_id` propio **o** un `destination_account_id` propio), `amount_cents`, `concept` y `reference`, EL sistema DEBE ejecutar la transferencia de forma atómica: debitar origen, acreditar destino y crear los asientos contables en **una sola transacción** PostgreSQL.
- **R4.2** EL sistema DEBE exigir el encabezado `Idempotency-Key` (UUID) en `POST /transfers`; SI falta o es inválido, ENTONCES DEBE responder `400`.
- **R4.3** `amount_cents` DEBE ser un entero `> 0` y `≤ 100_000_000`. SI el monto viene como decimal, cadena o con más precisión, ENTONCES DEBE rechazarse con `400` (el sistema **nunca redondea**).
- **R4.4** `concept` DEBE tener 1–40 caracteres imprimibles; `reference` DEBE ser numérica de 1 a 7 dígitos (se almacena como texto para preservar ceros a la izquierda).
- **R4.5** SI el saldo disponible de la cuenta origen es menor al monto, ENTONCES EL sistema DEBE rechazar con `422` (`code: INSUFFICIENT_FUNDS`) sin modificar ningún saldo.
- **R4.6** SI la cuenta origen y la cuenta destino son la **misma**, ENTONCES EL sistema DEBE rechazar con `422` (`code: SAME_ACCOUNT_TRANSFER`).
- **R4.7** CADA transferencia completada DEBE generar exactamente dos asientos (débito negativo en origen, crédito positivo en destino) cuya suma sea **cero**; la base de datos DEBE impedir confirmar una transacción donde los asientos de una transferencia no sumen cero.
- **R4.8** EL saldo de una cuenta de usuario NUNCA DEBE ser negativo; la base DEBE garantizarlo con un `CHECK`.
- **R4.9** CUANDO llegan peticiones con la misma `Idempotency-Key` y el mismo cuerpo (incluso de forma concurrente), EL sistema DEBE ejecutar la transferencia **a lo sumo una vez** y devolver a todas el mismo resultado (código y cuerpo), con encabezado `Idempotent-Replayed: true` en las repeticiones.
- **R4.10** SI llega la misma `Idempotency-Key` con un cuerpo distinto, ENTONCES EL sistema DEBE responder `422` (`code: IDEMPOTENCY_KEY_REUSED`) sin ejecutar nada.
- **R4.11** CUANDO la transferencia se completa, EL sistema DEBE devolver un comprobante con `id`, `status`, monto, origen, destino (alias/nombre y CLABE enmascarada), concepto, referencia, `tracking_code` y fecha/hora.
- **R4.12** MIENTRAS se procesan transferencias concurrentes que involucran las mismas cuentas, EL sistema NO DEBE producir interbloqueos (deadlocks) ni saldos inconsistentes.
- **R4.13** EL usuario DEBE poder consultar el estado de una transferencia propia por `id` (`GET /transfers/{id}`).
- **R4.14** `[web]` EL botón "Enviar" DEBE deshabilitarse al primer clic y la llave de idempotencia DEBE generarse **una sola vez por intento** (al llegar a la pantalla de confirmación) y reutilizarse en reintentos.
- **R4.15** `[web]` EL flujo DEBE tener: formulario → pantalla de confirmación (revisión) → OTP si aplica → comprobante.
- **R4.16** `[mobile]` LA app DEBE permitir transferir solo a beneficiarios ya registrados.
- **R4.17** `[mobile]` SI se pierde la conexión a mitad de una transferencia, ENTONCES LA app DEBE reintentar con la **misma** llave de idempotencia y mostrar el estado real de la operación según la respuesta del servidor; no DEBE mostrar "éxito" ni "fallo" sin confirmación del servidor.
- **R4.18** EL sistema DEBE registrar en auditoría la creación, completado y rechazo de transferencias.

### R5 — Historial de movimientos

> Como usuario, consulto mi historial de movimientos con filtros por fecha y tipo, paginado.

- **R5.1** CUANDO el usuario solicita los movimientos de una cuenta propia, EL sistema DEBE devolverlos ordenados del más reciente al más antiguo (`created_at DESC, id DESC`).
- **R5.2** EL sistema DEBE paginar **por cursor** (keyset), no por `OFFSET`. El cursor es opaco; `limit` por defecto 20, máximo 100.
- **R5.3** EL sistema DEBE permitir filtrar por rango de fechas `from`/`to` (fechas `YYYY-MM-DD` interpretadas en `America/Mexico_City`, ambos extremos inclusivos) y por `type` (`TRANSFER_IN`, `TRANSFER_OUT`, `DEPOSIT`).
- **R5.4** SI `from > to`, el cursor es inválido o el filtro no existe, ENTONCES EL sistema DEBE responder `400`.
- **R5.5** CADA movimiento DEBE incluir tipo, monto con signo en centavos, saldo posterior, concepto, referencia, contraparte (enmascarada) y fecha/hora.
- **R5.6** LA consulta del historial DEBE usar un índice compuesto; `design.md` DEBE incluir el `EXPLAIN ANALYZE` con al menos 100,000 movimientos de seed.
- **R5.7** `[mobile]` LA app DEBE mostrar los últimos 20 movimientos de la cuenta seleccionada.
- **R5.8** `[web]` EL panel DEBE ofrecer filtros por fecha y tipo y botón "Cargar más" basado en cursor.

### R6 — Límite diario y confirmación con código de un solo uso

> Como usuario, tengo un límite diario de transferencias; si una operación supera cierto monto, debo confirmarla con un código de un solo uso (puede simularse).

- **R6.1** EL sistema DEBE rechazar con `422` (`code: DAILY_LIMIT_EXCEEDED`) toda transferencia a terceros cuyo monto, sumado a las transferencias a terceros **completadas** del día del usuario, supere su `daily_limit_cents` (igualar el límite está permitido).
- **R6.2** EL "día" del límite DEBE calcularse con la hora del **servidor** al momento de **ejecutar** (completar) la transferencia, en `America/Mexico_City`; la hora del cliente se ignora.
- **R6.3** SI el monto es mayor que `OTP_THRESHOLD_CENTS`, ENTONCES EL sistema DEBE crear la transferencia en estado `PENDING_OTP`, responder `202` con un `challenge` (id, expiración, intentos restantes) y NO mover dinero.
- **R6.4** CUANDO el usuario envía el código correcto dentro de la vigencia, EL sistema DEBE volver a validar saldo y límite diario y, si pasan, completar la transferencia de forma atómica.
- **R6.5** EL código DEBE ser de 6 dígitos, generado con un CSPRNG, almacenado solo como hash, de **un solo uso** y con vigencia de 5 minutos.
- **R6.6** SI el código es incorrecto, ENTONCES EL sistema DEBE responder `422` (`code: OTP_INVALID`) con intentos restantes; al tercer fallo, o al expirar, la transferencia DEBE pasar a `EXPIRED` y no podrá confirmarse.
- **R6.7** SI se confirma una transferencia que ya está `COMPLETED`, ENTONCES EL sistema DEBE devolver el estado actual (`200`) sin volver a ejecutarla (confirmación idempotente).
- **R6.8** EL sistema DEBE exponer al usuario su límite diario, lo consumido hoy y el umbral de OTP (`GET /me`) para que los clientes lo muestren.
- **R6.9** EL sistema DEBE registrar en auditoría la emisión del OTP, cada intento fallido y la expiración.

## 4. Requerimientos no funcionales

- **NFR-1 Integridad en base de datos.** `CHECK` de saldo no negativo (cuentas de usuario), llaves foráneas en todas las relaciones, `UNIQUE (user_id, idempotency_key)` en transferencias, y trigger diferido que impide confirmar asientos que no sumen cero por transferencia.
- **NFR-2 Montos exactos.** Montos en `BIGINT` (centavos) en la base y enteros en la API. Prohibido `float`/`numeric` con decimales para dinero en código de aplicación. Las conversiones texto↔centavos usan parseo de cadenas (sin `parseFloat`).
- **NFR-3 Concurrencia.** Transferencias en transacción `READ COMMITTED` con `SELECT … FOR UPDATE` en orden determinista; `lock_timeout` acotado. Justificación en `design.md` §5.
- **NFR-4 Auditoría inmutable.** Tabla `audit_events` de solo inserción: el rol de la aplicación no tiene `UPDATE`, `DELETE` ni `TRUNCATE`, y un trigger rechaza modificaciones incluso a roles con más permisos.
- **NFR-5 Errores.** Todas las respuestas de error usan `application/problem+json` (RFC 7807) con `type`, `title`, `status`, `detail`, `instance`, `code` y `request_id`; nunca se exponen stack traces, SQL ni nombres de constraints.
- **NFR-6 Logs.** JSON estructurado (pino) con `request_id` (propagado desde `X-Request-Id` o generado), sin contraseñas, tokens, OTP ni encabezado `Authorization`; CLABEs enmascaradas (`************1234`).
- **NFR-7 Validación.** Toda entrada se valida con Zod; los esquemas compartibles viven en `packages/shared`.
- **NFR-8 Arquitectura.** Capas: rutas → controladores (HTTP) → servicios (dominio) → repositorios (TypeORM). La lógica financiera no vive en los handlers de Express.
- **NFR-9 Stack.** Node.js ≥ 20, Express, PostgreSQL ≥ 15, TypeScript `strict`, TypeORM con migraciones y `synchronize: false`. React ≥ 18 + Vite; Expo + TypeScript.
- **NFR-10 Rendimiento del historial.** Con ≥ 100,000 movimientos, la primera página del historial filtrado DEBE resolverse por índice (sin `Seq Scan` sobre `ledger_entries`).
- **NFR-11 Pruebas.** Unitarias (servicios y CLABE), integración contra PostgreSQL real (idempotencia, límite diario, saldo no negativo), concurrencia (≥ 100 transferencias simultáneas que cuadran al centavo) y Testing Library en web (incluido saldo insuficiente).
- **NFR-12 Accesibilidad web.** Navegación con teclado, `label` asociado en todos los campos, foco visible y contraste AA.
- **NFR-13 Privacidad móvil.** La app oculta el contenido sensible cuando pasa a segundo plano (`AppState` ≠ `active`).
- **NFR-14 Entorno local.** `docker compose up -d`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`; documentación OpenAPI navegable en `/docs` (Swagger UI).
- **NFR-15 CI.** GitHub Actions corre lint y pruebas de `api`, `web` y `mobile`, con PostgreSQL como servicio.
- **NFR-16 Trazabilidad.** Cada tarea de `tasks.md` corresponde a uno o más commits que citan su ID (`[T-xx]`); historial sin squash.

## 5. Casos borde

| ID | Caso | Comportamiento esperado | Criterios |
| --- | --- | --- | --- |
| EC-1 | Doble clic en "Enviar" | Una sola transferencia | R4.9, R4.14 |
| EC-2 | Pérdida de red a mitad de una transferencia en móvil | Reintento con la misma llave; se muestra el estado real | R4.9, R4.17 |
| EC-3 | Redondeo | No existe redondeo: montos con más de 2 decimales se rechazan | R4.3, NFR-2 |
| EC-4 | Límite diario que cruza medianoche | Cuenta el día de ejecución en hora del servidor (`America/Mexico_City`) | R6.1, R6.2 |
| EC-5 | Transferencia a la propia cuenta | Misma cuenta: rechazo; otra cuenta propia: permitida | R4.6, A-3 |
| EC-6 | Misma llave, distinto cuerpo | `422 IDEMPOTENCY_KEY_REUSED` | R4.10 |
| EC-7 | 100 transferencias simultáneas desde una cuenta | Saldo final exacto, ninguna cuenta negativa | R4.8, R4.12 |
| EC-8 | Transferencias cruzadas A→B y B→A simultáneas | Sin deadlock | R4.12 |
| EC-9 | OTP expirado o con 3 fallos | `EXPIRED`, no se puede confirmar | R6.6 |
| EC-10 | Saldo cambia entre la creación y la confirmación OTP | Se revalida al confirmar | R6.4, A-6 |
| EC-11 | Refresh token reutilizado (robado) | Se revoca toda la familia | R1.8 |
| EC-12 | Huso horario / DST | México no aplica horario de verano desde 2022; aun así se usa la zona IANA, no un offset fijo | R6.2 |

### 5.1 Casos borde en Given/When/Then

**EC-1 Doble clic en "Enviar"**
```gherkin
Given estoy en la pantalla de confirmación de una transferencia de $500.00
  And la web generó la llave de idempotencia K1 al abrir la confirmación
When hago doble clic en "Enviar"
Then el botón se deshabilita tras el primer clic
  And si llegan dos POST /transfers con la llave K1, el servidor ejecuta una sola transferencia
  And ambas respuestas contienen el mismo id de transferencia
  And mi saldo disminuye exactamente $500.00
```

**EC-2 Pérdida de red en móvil**
```gherkin
Given envío desde la app una transferencia de $300.00 con la llave K2
  And el servidor completó la transferencia pero la respuesta se perdió por falta de red
When la conexión regresa
Then la app reenvía la misma petición con la llave K2
  And el servidor responde el resultado original con "Idempotent-Replayed: true"
  And la app muestra "Transferencia completada" con el mismo folio
  And mi saldo disminuyó solo $300.00
Given la app agotó sus reintentos automáticos sin respuesta
Then muestra "No pudimos confirmar el estado" con botón "Verificar de nuevo"
  And no genera una llave nueva hasta conocer el resultado definitivo
```

**EC-3 Redondeo**
```gherkin
Given escribo "100.005" como monto
When intento continuar
Then el formulario muestra "Máximo 2 decimales" y no envía nada
And si la API recibe amount_cents = 10000.5 responde 400 sin redondear
```

**EC-4 Límite diario y medianoche**
```gherkin
Given mi límite diario es $50,000.00
  And hoy (hora de Ciudad de México) ya transferí $45,000.00 a terceros
When a las 23:59:58 intento transferir $10,000.00
Then recibo 422 DAILY_LIMIT_EXCEEDED
When a las 00:00:01 del día siguiente intento transferir $10,000.00
Then la transferencia se completa porque el acumulado del nuevo día es $0.00
Given creé a las 23:59:50 una transferencia de $12,000.00 que requiere OTP
When la confirmo a las 00:00:10
Then cuenta para el límite del día de la confirmación (ejecución)
```

**EC-5 Transferencia a la propia cuenta**
```gherkin
Given tengo las cuentas "Principal" y "Ahorro"
When transfiero de "Principal" a "Principal"
Then recibo 422 SAME_ACCOUNT_TRANSFER y nada cambia
When transfiero $1,000.00 de "Principal" a "Ahorro"
Then se completa sin pedir OTP ni consumir mi límite diario
```

**EC-7 Concurrencia**
```gherkin
Given una cuenta con saldo $1,000.00
When se disparan 100 transferencias simultáneas de $15.00 cada una con llaves distintas
Then se completan exactamente 66 y 34 se rechazan con INSUFFICIENT_FUNDS
  And el saldo final es $10.00
  And la suma de todos los asientos del sistema es $0.00
  And el saldo de cada cuenta es igual a la suma de sus asientos
```

## 6. Matriz de trazabilidad (resumen)

| Historia | Diseño (`design.md`) | Tareas (`tasks.md`) |
| --- | --- | --- |
| R1 | §3 Modelo, §6 Autenticación, §7 OpenAPI `/auth/*` | T-05, T-07, T-08, T-18, T-19, T-25 |
| R2 | §3, §7 `/me`, `/accounts` | T-03, T-09, T-20, T-26 |
| R3 | §3, §4 CLABE, §7 `/beneficiaries` | T-03, T-10, T-22 |
| R4 | §3, §5 Concurrencia/Idempotencia, §7 `/transfers`, §11 Pantallas | T-06, T-11, T-14, T-15, T-23, T-24, T-27 |
| R5 | §3.3 Índices, §7 `/movements`, §10 EXPLAIN | T-16, T-17, T-21, T-26 |
| R6 | §5.5 Límite diario, §5.6 OTP | T-09, T-12, T-13, T-14, T-23, T-27 |
| NFR | §3.2 Invariantes, §8 Errores, §9 Logs, §12 Pruebas | T-01…T-06, T-11, T-15, T-17, T-18, T-24, T-28, T-29, T-31 |
