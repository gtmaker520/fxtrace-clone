import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  server: { port: 5180 },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'demo/index.html'),
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
