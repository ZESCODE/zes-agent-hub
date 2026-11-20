import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api/agora': {
        target: 'http://localhost:8765',
        changeOrigin: true,
      },
    },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  optimizeDeps: {
    include: ['express', 'cors', 'ws', 'uuid', 'zod', 'node-fetch'],
  },
});
