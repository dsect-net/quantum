import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// @dsect/ui is consumed exactly the way the root Quantum app consumes it:
// aliased to the vendor/design-system submodule SOURCE, importing component
// modules directly (never the bare entry — its index.ts pulls kit CSS
// unlayered). See ~/workspace/quantum/vite.config.ts for the original.
// The /api proxy targets the live tracker-board service (Tritium :7654).
// When developing off-box, forward it first, e.g.:
//   ssh -L 7654:127.0.0.1:7654 scott@tritium-linux
// and it lines up with the default target. Override with TRACKER_API.
const apiTarget = process.env.TRACKER_API ?? 'http://127.0.0.1:7654';
const apiProxy = { '/api': { target: apiTarget, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@dsect\/ui(\/|$)/,
        replacement: path.resolve(root, '../../vendor/design-system/react/src') + '$1',
      },
    ],
  },
  server: { port: 5174, proxy: apiProxy },
  preview: { port: 4174, proxy: apiProxy },
});
