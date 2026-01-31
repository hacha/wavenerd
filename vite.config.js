import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { resolve } from 'path';

const COMMIT_HASH = execSync('git rev-parse HEAD').toString().trim();
const COMMIT_DATE = execSync('git log -1 --pretty=format:%cd').toString().trim();

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    // Redirect all 'superdough' imports to the forked version
    // This ensures @strudel/webaudio uses the same soundMap and AudioContext
    alias: {
      // Redirect all 'superdough' imports to our fork's pre-built bundle
      // This bundle has worklets already processed by vite-plugin-bundle-audioworklet
      // Note: process.cwd() is used instead of __dirname for esbuild compatibility
      'superdough': resolve(process.cwd(), 'packages/superdough/dist/index.mjs'),
      // Also redirect @wavenerd/superdough to the same bundle
      // This ensures StrudelDeck.ts and @strudel/webaudio use the same soundMap instance
      '@wavenerd/superdough': resolve(process.cwd(), 'packages/superdough/dist/index.mjs'),
    },
    dedupe: ['superdough', '@wavenerd/superdough', 'nanostores'],
  },
  optimizeDeps: {
    exclude: [
      '@0b5vr/wavenerd-deck',
      '@wavenerd/superdough',
      'superdough',
      '@strudel/webaudio',
    ],
  },
  plugins: [
    react(),
    Icons({ compiler: 'jsx', jsx: 'react' }),
  ],
  define: {
    COMMIT_HASH: `'${COMMIT_HASH}'`,
    COMMIT_DATE: `'${COMMIT_DATE}'`,
  },
  build: {
    target: 'esnext',
  },
  base: './',
});
