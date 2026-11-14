/** Fixtures directory, resolved next to this file so tests never depend on the caller's cwd. */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
export const toolsRoot = dirname(here)
export const fixture = (...parts: string[]): string => join(toolsRoot, 'fixtures', ...parts)
export const cliPath = resolve(toolsRoot, 'cli.ts')
