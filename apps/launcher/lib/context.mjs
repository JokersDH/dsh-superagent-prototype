/** Resolve CLI roots once for every launcher command, using the portability root contract. */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRoots } from '@personal-agent/portability'
import { UsageError } from './cli.mjs'

/** Repository/install root inferred from this module location (apps/launcher/lib -> repo root). */
export const inferredInstallRoot = fileURLToPath(new URL('../../../', import.meta.url))

export const ROOT_OPTION_SPEC = Object.freeze({
  install: 'string',
  'config-root': 'string',
  'data-root': 'string',
  'cache-root': 'string',
  'logs-root': 'string',
  'workspace-root': 'string',
  state: 'string',
})

const FLAG_TO_ROOT = Object.freeze({
  'config-root': 'config',
  'data-root': 'data',
  'cache-root': 'cache',
  'logs-root': 'logs',
  'workspace-root': 'workspace',
})

/** Relative CLI paths resolve against the invocation directory; `~` is expanded by portability. */
const normalize = (value) => (value.startsWith('~') ? value : resolve(value))

/** `--state` is the common alias for the data root, because it is the coordinator state dir. */
export function resolveContext(values) {
  const overrides = {}
  for (const [flag, name] of Object.entries(FLAG_TO_ROOT)) {
    if (values[flag] !== undefined) overrides[name] = normalize(values[flag])
  }
  if (values.state !== undefined) {
    if (overrides.data !== undefined) throw new UsageError('Use either --state or --data-root, not both')
    overrides.data = normalize(values.state)
  }
  const selected = values.install ?? process.env.PA_INSTALL_ROOT ?? inferredInstallRoot
  const roots = resolveRoots({ installRoot: normalize(selected), overrides })
  return { installRoot: roots.install, roots }
}

export function repoPackage(installRoot) {
  return new URL(`file://${installRoot.replace(/\/$/, '')}/package.json`).pathname
}
