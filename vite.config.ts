import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const root = __dirname;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Untitled UI React internals: `@/utils/cx` etc. resolve into the
      // vendored copy. (DSECT design-system untitled/README.md: the app
      // provides an `@/` alias wherever the five folders live.)
      { find: /^@\//, replacement: path.resolve(root, 'vendor/untitled/') + '/' },
      // @dsect/ui → the design-system submodule's React layer source.
      // Import component modules directly (e.g. `@dsect/ui/components/app`)
      // rather than the bare package entry: the entry's index.ts imports
      // tokens/base/components CSS unlayered, which would beat Tailwind
      // utilities (untitled/README.md: layers are not optional).
      { find: /^@dsect\/ui(\/|$)/, replacement: path.resolve(root, 'vendor/design-system/react/src/') + '$1' },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
