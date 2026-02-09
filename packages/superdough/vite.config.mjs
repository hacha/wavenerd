import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import bundleAudioWorkletPlugin from 'vite-plugin-bundle-audioworklet';

const __dirname = dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [bundleAudioWorkletPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, 'index.mjs'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      external: ['nanostores', 'superdough'],
    },
    target: 'esnext',
    outDir: 'dist',
  },
});
