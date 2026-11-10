# Prueba Técnica — Fullstack Developer (Fintech)

Oct 12, 2026 · Treo

## Contexto y objetivo

Buscamos un perfil fullstack para producto financiero. La prueba mide seis cosas: diseño de APIs en Node.js/Express, modelado e integridad de datos en PostgreSQL, frontend web en React, app móvil en React Native, criterio para proponer una arquitectura en AWS y la capacidad de trabajar con AI de forma disciplinada, especificando primero y generando después.

**Tiempo estimado:** 10 a 14 horas de trabajo efectivo.

**Uso de AI:** no solo está permitido, es obligatorio. Puedes usar Claude Code, Cursor, Kiro, Copilot o la herramienta que prefieras. Evaluamos que la AI trabaje a partir de una especificación que tú escribiste y validaste, no que improvise el sistema por ti.

**Sin despliegue real:** no necesitas una cuenta de AWS. Todo corre en local, y la parte de AWS se entrega como una propuesta escrita y justificada.

**Lo que NO buscamos:** un proyecto enorme. En finanzas preferimos un alcance pequeño donde el dinero siempre cuadra, sobre muchas pantallas con errores de saldo.

## El reto: billetera digital con transferencias

Construye una billetera digital en pesos mexicanos (MXN): backend, panel web y app móvil. El usuario consulta sus cuentas, registra beneficiarios y envía transferencias entre cuentas de la misma plataforma.

**Historias de usuario mínimas:**

1. Como usuario, me registro e inicio sesión.
2. Como usuario, veo mis cuentas con su saldo disponible.
3. Como usuario, registro un beneficiario con nombre, alias y CLABE de 18 dígitos, validando su dígito verificador.
4. Como usuario, envío una transferencia a un beneficiario o a otra cuenta mía, con concepto y referencia numérica.
5. Como usuario, consulto mi historial de movimientos con filtros por fecha y tipo, paginado.
6. Como usuario, tengo un límite diario de transferencias; si una operación supera cierto monto, debo confirmarla con un código de un solo uso (puede simularse).

**Bonus (opcional, suma puntos):** exportar el estado de cuenta del mes a CSV o PDF, o transferencias programadas con fecha futura.

## Fase 1: Especificación con AI (modo SPEC)

Antes de escribir código de aplicación, entrega una carpeta `/specs` versionada en el repo. El historial de Git debe mostrar que las specs existen antes que la implementación.

**Archivos requeridos:**

1. `requirements.md`: historias de usuario con criterios de aceptación en formato EARS o Given/When/Then. Incluye los casos borde que detectaste: doble clic en "Enviar", pérdida de red a mitad de una transferencia en móvil, redondeo, límite diario que cruza medianoche, transferencia a la propia cuenta.
2. `design.md`: modelo de datos (diagrama ER en Mermaid), contrato de la API en OpenAPI 3.1, estrategia de concurrencia y de idempotencia, autenticación, manejo de errores, y el mapa de pantallas y estados de la web y de la app móvil.
3. `tasks.md`: plan de implementación dividido en tareas pequeñas y verificables, cada una ligada a los requerimientos que cubre y marcada como `api`, `web` o `mobile`.
4. `ai-log.md`: bitácora honesta del uso de AI. Qué herramienta usaste, los prompts clave, qué te propuso la AI que rechazaste y por qué, y dónde tuviste que corregirla. En finanzas nos interesa especialmente si la AI propuso algo inseguro o incorrecto con el dinero.

**Regla clave:** cada tarea de `tasks.md` debe corresponder a uno o más commits. Queremos ver la trazabilidad requerimiento → diseño → tarea → commit → prueba.

Si tu herramienta tiene un modo SPEC nativo (por ejemplo Kiro, o Claude Code con un flujo plan-first), úsalo y menciónalo. Si no, el flujo manual con estos archivos es igual de válido.

## Fase 2: Backend (Node.js + Express + PostgreSQL)

**Stack obligatorio:** Node.js 20 o superior, Express, PostgreSQL 15 o superior, TypeScript en modo estricto y TypeORM para el acceso a datos. Las migraciones se escriben con TypeORM y `synchronize` debe estar desactivado. Donde TypeORM no alcance (por ejemplo, constraints avanzados o bloqueos), explica en `design.md` cómo lo resolviste.

**Requerimientos técnicos:**

- Estructura por capas o por módulos de dominio. La lógica financiera no vive en los handlers de Express.
- Validación de entrada con esquema (Zod o similar) y errores consistentes en formato RFC 7807, sin filtrar detalles internos.
- Autenticación con JWT de acceso corto y refresh token rotativo, contraseñas con argon2 o bcrypt, y rate limiting en login. Integrar Amazon Cognito es opcional.
- Transferencias dentro de una transacción con bloqueo explícito (`SELECT ... FOR UPDATE` en orden determinista para evitar deadlocks) o aislamiento `SERIALIZABLE` con reintentos. Justifica tu elección.
- Integridad garantizada en la base, no solo en código: `CHECK` de saldo no negativo o equivalente, llaves foráneas, restricción única sobre la llave de idempotencia y una restricción o trigger que asegure que los asientos de cada transferencia suman cero.
- Tabla de auditoría de solo inserción, con permisos de base de datos que impidan `UPDATE` y `DELETE`.
- Índices pensados para el historial de movimientos; incluye en `design.md` el `EXPLAIN ANALYZE` de esa consulta con al menos 100,000 movimientos de seed.
- Paginación por cursor en el historial, no por `OFFSET`.
- Logs estructurados en JSON con request ID y datos sensibles enmascarados.

**Pruebas:**

- Unitarias para la lógica de servicios, incluida la validación de CLABE.
- De integración contra un PostgreSQL real corriendo en local que cubran idempotencia, límite diario y saldo no negativo.
- Una prueba de concurrencia que dispare al menos 100 transferencias simultáneas desde una cuenta y verifique que el saldo final cuadra al centavo.

**Entorno local:** API, base de datos con seed y web deben levantarse en local siguiendo el README, con scripts claros como `npm run db:migrate`, `npm run db:seed` y `npm run dev`.

## Fase 3: Frontend (React web + React Native)

Ambos clientes consumen la misma API y comparten tipos. Lo ideal es un monorepo (`/api`, `/web`, `/mobile`, `/packages/shared`) con los tipos generados desde el contrato OpenAPI.

**Web en React (panel completo):**

- React 18 o superior con TypeScript y Vite o Next.js.
- Pantallas: login, resumen de cuentas, historial con filtros y paginación, alta de beneficiarios y flujo de transferencia con pantalla de confirmación y comprobante.
- Manejo de datos del servidor con TanStack Query o equivalente, con estados de carga, vacío y error en cada pantalla.
- Formularios con validación compartida con el backend; el botón de enviar se bloquea y la llave de idempotencia se genera una sola vez por intento.
- Montos formateados con `Intl.NumberFormat` en `es-MX`, sin cálculos con `float` en el cliente.
- Accesibilidad básica: navegación con teclado, etiquetas en formularios y contraste suficiente.
- Pruebas con Testing Library del flujo de transferencia, incluido el caso de error de saldo insuficiente.

**App móvil en React Native (alcance reducido):**

- TypeScript obligatorio. Expo está permitido y recomendado.
- Pantallas: login, saldo, últimos 20 movimientos y transferencia a un beneficiario ya registrado.
- Tokens guardados en almacenamiento seguro (`expo-secure-store` o Keychain/Keystore), nunca en `AsyncStorage`.
- Manejo de red inestable: si se pierde la conexión a mitad de una transferencia, la app reintenta con la misma llave de idempotencia y muestra el estado real de la operación.
- La app oculta el contenido sensible cuando pasa a segundo plano.
- Bonus: desbloqueo biométrico con Face ID o huella.

## Fase 4: Propuesta de despliegue en AWS (sin desplegar)

No se despliega nada. Entrega un documento `/docs/aws-deploy.md` que explique cómo llevarías este sistema a producción en AWS para una empresa regulada del sector financiero, con un diagrama de arquitectura en Mermaid.

**Debe cubrir, como mínimo:**

| Tema | Qué esperamos que expliques |
| --- | --- |
| Cómputo de la API | Qué servicio usarías (ECS Fargate, App Runner, EKS o Lambda con API Gateway) y por qué descartas los demás |
| Base de datos | RDS PostgreSQL o Aurora, Multi-AZ, backups con recuperación a un punto en el tiempo, RPO y RTO objetivo |
| Frontend web | Hosting en S3 + CloudFront o Amplify Hosting |
| App móvil | Cómo se distribuye (EAS, tiendas) y cómo se conecta de forma segura a la API |
| Observabilidad y auditoría | CloudWatch, X-Ray u OpenTelemetry, CloudTrail, y dónde y cuánto tiempo se retienen los logs de auditoría |
| CI/CD | Pipeline de GitHub Actions o CodePipeline, autenticación con OIDC, ambientes dev, staging y prod |

**Además responde por escrito:**

- Cómo manejas las conexiones a PostgreSQL al escalar horizontalmente (pool, RDS Proxy).
- Qué cambiarías si el volumen crece 100 veces.
- Qué herramienta de infraestructura como código usarías (CDK, Terraform o SAM). Un esqueleto de código es bonus, no obligatorio.

## Entregables

Cuando termines, envía un correo con lo siguiente:

- [ ] Liga al repositorio en GitHub (público o con acceso a nuestro usuario), con historial de commits completo, sin squash.
- [ ] Carpeta `/specs` con los cuatro archivos de la Fase 1.
- [ ] Documento `/docs/aws-deploy.md` con la propuesta y su diagrama.
- [ ] Documentación OpenAPI navegable en local (Swagger UI o Redoc).
- [ ] Instrucciones para correr la app móvil con Expo Go o un simulador apuntando a la API local.
- [ ] Video de 5 minutos como máximo mostrando el flujo completo en web y en móvil, incluido un intento de transferencia con saldo insuficiente.
- [ ] `README.md` con: cómo correr en local, cómo correr pruebas y una sección de "qué haría con más tiempo".
- [ ] Pipeline de CI que corra lint y pruebas de los tres proyectos, en verde en la rama principal.

## Siguiente paso

Después de tu entrega agendaremos una sesión en vivo de 60 minutos para que presentes tu solución y expliques tus decisiones técnicas.
