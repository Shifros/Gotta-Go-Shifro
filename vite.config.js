import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: false
  },
  preview: {
    port: 4173
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsInlineLimit: 0
  }
});
