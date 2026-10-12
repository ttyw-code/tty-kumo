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
        'fs/promises',
        'events',
        'dns',
        'util',
        'child_process',
        'worker_threads',
        'os',
        'crypto',
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:url',
        'node:os',
        'node:crypto',
        'node:events',
        'node:util',
        'node:child_process',
        'node:worker_threads',
        'node:stream',
        'node:assert',
        'node:buffer',
      ],
      // 共享 chunk 用固定名。默认按内容 hash 命名（`ipc-BYeFxGKH.cjs`），
      // 配合 emptyOutDir:false 会不断累积死文件，而 electron-builder 用的是
      // `out/**/*` glob —— 死 chunk 会被一起打进安装包
      output: {
        chunkFileNames: 'chunk-[name].cjs',
      },
    },
  },
});
