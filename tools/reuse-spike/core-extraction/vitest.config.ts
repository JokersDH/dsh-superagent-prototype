import { defineConfig } from 'vitest/config'

// Minimal host for the two baseline spec files; the upstream config's React dedupe does not apply to the core slice.
export default defineConfig({ test: { include: ['tests/**/*.spec.ts'] } })
