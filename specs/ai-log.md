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

**Correcciones del candidato:** pendiente. Se registrarán aquí después de la revisión del PR de specs.

### Qué propuso la AI que fue rechazado

**Pendiente de la revisión humana.** Hasta este momento no hay propuestas rechazadas por el candidato.

## Fases siguientes

| Fase | Estado |
| --- | --- |
| Fase 2 — Backend | Pendiente (no inicia hasta aprobar las specs) |
| Fase 3 — Web y móvil | Pendiente |
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
