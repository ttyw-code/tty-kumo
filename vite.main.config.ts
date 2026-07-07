import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'out/src/main'),
    emptyOutDir: false,
    sourcemap: true,
    target: 'node18',
    lib: {
      entry: {
        main: path.resolve(__dirname, 'src/main/main.ts'),
        preload: path.resolve(__dirname, 'src/main/preload.ts'),
        worker: path.resolve(__dirname, 'src/main/database/lowdb-worker.ts'),
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: [
        'electron',
        'electron/main',
        'path',
        'fs',
        'events',
        'dns',
        'worker_threads',
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:url',
      ],
    },
  },
});
