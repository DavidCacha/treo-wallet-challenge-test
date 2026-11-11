# Treo móvil (Expo + React Native)

App de la billetera para iOS y Android: login, saldo de cuentas, últimos 20 movimientos y transferencias a beneficiarios ya registrados, con OTP y reintentos seguros cuando se pierde la red.

- Expo SDK 58 (React Native 0.88, React 19.3) con TypeScript estricto.
- Consume la misma API REST que la web (`X-Client-Platform: mobile`) y reutiliza `@treo/shared` (tipos del contrato, CLABE, montos en centavos, esquemas Zod). La app no repite reglas financieras: la API decide saldo, límite diario y OTP.
- Privacidad: al salir de la app una cubierta tapa saldos y movimientos. En Android, además, la ventana es segura (`FLAG_SECURE`): "Recientes" muestra la miniatura en blanco y no se pueden tomar capturas de pantalla dentro de la app.
- Tokens: el refresh token rotativo vive solo en `expo-secure-store` (Keychain / Keystore) y el access token solo en memoria. Una regla de ESLint prohíbe `AsyncStorage` en `mobile/**`.

## Correr en tu teléfono con Expo Go

Necesitas la API y PostgreSQL corriendo como indica el [README principal](../README.md) (`npm run dev` en la raíz) y la app **Expo Go** actualizada en el teléfono (debe soportar el SDK 58).

1. **Dependencias de la app** (la app tiene su propio `package.json` y `package-lock.json`, fuera de los workspaces de npm):

   ```bash
   cd mobile
   npm install
   ```

2. **URL de la API.** En Expo Go, `localhost` es el propio teléfono, así que usa la IP de tu computadora en la red local:

   - Windows: `ipconfig` → "Dirección IPv4" del adaptador Wi-Fi (por ejemplo `192.168.1.50`).
   - macOS / Linux: `ipconfig getifaddr en0` o `hostname -I`.

   Copia el ejemplo y pon tu IP:

   ```bash
   cp .env.example .env            # PowerShell: Copy-Item .env.example .env
   # .env
   EXPO_PUBLIC_API_URL=http://192.168.1.50:3000/api/v1
   ```

   `.env` está en `.gitignore`. Expo lo lee al iniciar; si cambias la URL, reinicia con `npx expo start -c`.

3. **Inicia Metro** y escanea el QR:

   ```bash
   npx expo start
   ```

   - Android: abre Expo Go → "Scan QR code".
   - iOS: escanea el QR con la cámara y ábrelo en Expo Go.

   El teléfono y la computadora deben estar en la **misma red Wi-Fi**. En Windows, si el Firewall pregunta por Node.js, permite el acceso en redes privadas (lo usan tanto Metro, puerto 8081, como la API, puerto 3000).

4. Entra con un usuario de demostración, por ejemplo `ana@treo.dev` / `Demo12345!`. Con la API en modo desarrollo, la pantalla del código muestra el OTP simulado.

### Simuladores

| Dónde | `EXPO_PUBLIC_API_URL` | Cómo abrir |
| --- | --- | --- |
| Emulador de Android | `http://10.0.2.2:3000/api/v1` | `npx expo start` y tecla `a` |
| Simulador de iOS (solo macOS) | `http://localhost:3000/api/v1` | `npx expo start` y tecla `i` |

### Si algo no conecta

- "No pudimos comunicarnos con el servidor": revisa la IP, que la API responda en `http://<tu-ip>:3000/api/v1/health` desde el navegador del teléfono y el firewall.
- "Demasiados intentos": es el límite de login de la API (5 por 15 minutos). Reiniciar la API lo limpia en desarrollo.

## Pruebas

```bash
npm test             # Jest + React Native Testing Library (sin API)
npm run typecheck    # tsc --noEmit
npm run test:live    # contra la API local real (requiere API en desarrollo + seed)
```

Desde la raíz: `npm run test:mobile`, `npm run typecheck:mobile` y `npm run lint` (ESLint y Prettier cubren `mobile/`).

| Archivo | Qué prueba |
| --- | --- |
| `src/api/session.test.ts` | Login con `X-Client-Platform: mobile`, refresh token solo en SecureStore, rotación, *single-flight*, 401 → renovar y repetir, logout |
| `src/screens/LoginScreen.test.tsx` | Validación, credenciales inválidas, entrada al inicio, restauración de sesión |
| `src/screens/HomeScreen.test.tsx` | Saldos, últimos 20 movimientos, cambio de cuenta, vacío, error con reintento, aviso sin conexión, pull-to-refresh |
| `src/transfer/machine.test.ts` | Máquina de estados: misma llave en reintentos, backoff 1/2/4/8 s, estado desconocido tras 4 reintentos, "Verificar de nuevo", OTP, 401, doble toque |
| `src/transfer/TransferFlow.test.tsx` | Flujo completo con la UI: envío, montos sin redondeo, saldo insuficiente, doble toque, red perdida a mitad del envío, intento pendiente al abrir la app, OTP |
| `src/components/PrivacyGuard.test.tsx` | Cubierta de privacidad con `AppState` en `background` / `inactive` y ventana segura en Android |
| `src/lib/money.test.ts` | `formatCents` en un motor sin `Intl.NumberFormat` v3 (alternativa para Hermes) |
| `src/live/api.live.test.ts` | Contra la API real: login y rotación, saldos y movimientos, transferencia, respuesta perdida sin duplicar, saldo insuficiente, OTP, servidor inalcanzable |

## Cómo maneja la pérdida de red

Implementa la máquina de `specs/design.md` §5.4 en `src/transfer/machine.ts`:

1. Al tocar "Enviar" se genera una `Idempotency-Key` (`expo-crypto`) y se guarda junto con el cuerpo en SecureStore **antes** del primer envío.
2. Si no hay respuesta (sin red, *timeout* de 15 s) o hay un `5xx`, reintenta con la **misma** llave y el mismo cuerpo tras 1, 2, 4 y 8 segundos, esperando a que NetInfo reporte red.
3. Si los 4 reintentos fallan, muestra "No pudimos confirmar el estado" con "Verificar de nuevo" (misma llave). Al volver la red verifica sola.
4. La llave se borra solo con un resultado definitivo del servidor (completada, rechazada o expirada). Si la app se cierra antes, al abrirla consulta el estado real y no permite otra transferencia hasta resolverlo.
5. Si se pierde la red al confirmar el OTP, consulta `GET /transfers/{id}` en lugar de reenviar el código.

## Estructura

```
App.tsx                 proveedores + cubierta de privacidad + navegación
src/api/                cliente HTTP tipado, sesión, SecureStore, errores en español
src/auth/               contexto de sesión
src/components/         botones, campos, estados (carga/vacío/error), tarjetas, cubierta
src/screens/            login, inicio, formulario, revisión, estado/resultado/OTP
src/transfer/           máquina de envío, intento persistido, validación del borrador
src/live/               pruebas contra la API local
```
