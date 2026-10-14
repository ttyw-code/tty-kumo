import { defineConfig } from 'vite';
import path from 'path';

/**
 * 主进程产物分**两轮**构建，这不是洁癖，是硬约束。
 *
 * Electron 的 sandbox preload **不能 require 相对文件**。而 rollup 在多入口下会把
 * main 与 preload 共享的模块（`common/ipc.ts` 就被两边引用）抽成公共 chunk，
 * preload 一旦写出 `require('./chunk-ipc.cjs')`，沙箱里就是：
 *
 *     Unable to load preload script: ...\preload.cjs
 *     Error: module not found: ./chunk-ipc.cjs
 *
 * 整个 preload 加载失败 → 窗口里 `window.ipcChannel` / `window.agentBridge` 全没了，
 * 表现为「点 New Chat 没反应」（因为渲染端拿不到 IPC 通道就直接 return）。
 *
 * 所以 preload 必须单独构建：单入口时 rollup 不做代码分割，产物自包含。
 *
 *   vite build --config vite.main.config.ts --mode main      # main + worker（可共享 chunk）
 *   vite build --config vite.main.config.ts --mode preload   # preload，自包含单文件
 */
export default defineConfig(({ mode }) => {
  const preloadOnly = mode === 'preload';

  return {
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
        entry: preloadOnly
          ? {
              preload: path.resolve(__dirname, 'src/main/preload.ts'),
            }
          : {
              main: path.resolve(__dirname, 'src/main/main.ts'),
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
  };
});
