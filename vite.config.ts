import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@shared': new URL('./shared', import.meta.url).pathname } },
  server: { port: 5173, host: true },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    chunkSizeWarningLimit: 1600,
  },
});
