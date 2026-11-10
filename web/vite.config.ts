/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Se consume el código fuente de @treo/shared (TS) para que Vite y Vitest
// usen exactamente las mismas reglas de CLABE, montos y esquemas que la API.
const sharedSrc = fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@treo/shared': sharedSrc } },
  server: {
    port: 5173,
    strictPort: true,
    // Mismo origen en desarrollo: la cookie HttpOnly del refresh (Path=/api/v1/auth)
    // viaja sin CORS de terceros.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    environmentOptions: { jsdom: { url: 'http://localhost:5173' } },
    css: false,
  },
});
