import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The Singularity — one React build for every surface (web, Electron shell,
// Capacitor mobile). Relative base keeps assets working from file:// in the
// Electron shell and any static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5183,
    // Preview/host hardening: accept the platform preview hosts (*.e2b.app)
    // and local dev origins — nothing else (Vite's DNS-rebinding guard).
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    // Dev convenience: proxy API + MCP to the local service so the browser
    // app runs same-origin (no CORS, no mixed origins in dev).
    proxy: {
      '/api': { target: 'http://127.0.0.1:8795', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8795', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
