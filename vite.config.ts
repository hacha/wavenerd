import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { liveBridge } from './vite/liveBridge';

const COMMIT_HASH = execSync('git rev-parse HEAD').toString().trim();
const COMMIT_DATE = execSync('git log -1 --pretty=format:%cd').toString().trim();

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    exclude: [
      '@0b5vr/wavenerd-deck',
    ],
    // prebundle upfront; a late re-optimization can load a second copy of superdough
    include: [
      'superdough',
      '@strudel/core',
      '@strudel/mini',
      '@strudel/tonal',
      '@strudel/webaudio',
      '@strudel/transpiler',
      '@strudel/soundfonts',
    ],
  },
  resolve: {
    // superdough and @strudel/core hold singletons; there must be only one instance of each
    dedupe: [
      'superdough',
      'nanostores',
      '@strudel/core',
      '@codemirror/state',
      '@codemirror/view',
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    Icons({ compiler: 'jsx', jsx: 'react' }),
    liveBridge(),
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
