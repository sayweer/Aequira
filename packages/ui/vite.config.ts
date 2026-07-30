import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  cacheDir: './.vite',
  define: {
    global: 'globalThis',
  },
  build: {
    commonjsOptions: {
      extensions: ['.js', '.cjs'],
      ignoreDynamicRequires: true,
      transformMixedEsModules: true,
    },
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: {
          wasm: ['@midnight-ntwrk/onchain-runtime-v3'],
        },
      },
    },
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      format: 'esm',
      loader: { '.wasm': 'binary' },
      platform: 'browser',
      supported: { 'top-level-await': true },
      target: 'esnext',
    },
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
    ],
    include: ['@midnight-ntwrk/compact-runtime'],
  },
  plugins: [
    react(),
    wasm(),
    topLevelAwait({
      promiseExportName: '__tla',
      promiseImportName: (index) => `__tla_${index}`,
    }),
    {
      name: 'wasm-module-resolver',
      resolveId(source, importer) {
        if (
          source === '@midnight-ntwrk/onchain-runtime-v3' &&
          importer?.includes('@midnight-ntwrk/compact-runtime') === true
        ) {
          return { external: false, id: source, moduleSideEffects: true };
        }

        return null;
      },
    },
  ],
  resolve: {
    alias: {
      assert: 'assert',
      events: 'events',
      'isomorphic-ws': fileURLToPath(new URL('./src/isomorphic-ws-browser.ts', import.meta.url)),
      process: 'process/browser',
      util: 'util',
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
});
