import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import inspect from 'vite-plugin-inspect';
import path from 'path';
import oxc from 'vite-plugin-oxc';
import type VitePluginOxcOptions from 'vite-plugin-oxc';


export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    oxc({
      transform: {
      },
      minify: {},
      resolve: {},
    }),
    react(), inspect()],
  logLevel: 'error',
  server: {
    host: '0.0.0.0',
    port: 5175,
    hmr: {
      host: 'localhost',
    },
    watch: {
      usePolling: true,
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/index.html'),
      output: {
        entryFileNames: 'assets/[name].js',
      }
    }
  },
});
