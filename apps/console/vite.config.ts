import { defineConfig } from 'vite'

/**
 * The console is a browser app over the public product API. The dev proxy points at the coordinator
 * HTTP entry once it exists; the fixture adapter is selected by VITE_CONSOLE_MODE (default).
 */
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8787'

export default defineConfig({
  root: '.',
  build: { outDir: 'dist', sourcemap: true },
  server: {
    proxy: {
      '/v1': { target: apiTarget, changeOrigin: true },
    },
  },
})
