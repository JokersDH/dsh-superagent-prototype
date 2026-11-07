import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({ test: {
  include: ['tests/**/*.spec.ts'],
  setupFiles: [fileURLToPath(new URL('../../tests/integration/sqlite-core.setup.mjs', import.meta.url))],
  fileParallelism: false,
  maxWorkers: 1,
} })
