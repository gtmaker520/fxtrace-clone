import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  root: 'demo',
  server: { port: 5180 },
  build: {
    target: 'es2020',
    outDir: '../dist',
    emptyOutDir: true,
  },
});
