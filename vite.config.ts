import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const srcPath = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': srcPath,
    },
  },
  server: {
    // Bound to all interfaces so the sandbox preview / tunnel host can reach the dev server.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The dev server is reached through proxy hosts (e.g. https://<port>-<id>.e2b.app),
    // so the Host header must not be restricted.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    reporters: 'dot',
  },
});
