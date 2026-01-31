const { defineConfig } = require('vite');
const { resolve } = require('path');
const bundleAudioWorkletPlugin = require('vite-plugin-bundle-audioworklet').default;

// https://vitejs.dev/config/
module.exports = defineConfig({
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
