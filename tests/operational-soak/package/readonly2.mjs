/**
 * Wave-31 H10 same-package readonly and multi-root observation.
 *
 * Reads only the package's `status` and `recovery-status` entries on two distinct private roots. It
 * proves root isolation and that a missing restore marker is reported as normal, not as authority.
 * A started product HTTP/SSE endpoint was not available without starting a daemon, so content/SSE
 * remain NOT_REACHED; the separately labelled fixture soak is not a package endpoint.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PA = 'apps/launcher/bin/pa.mjs'
function rootSet(out, name) {
  const base = join(out, name)
  const roots = { config: join(base, 'config'), data: join(base, 'data'), cache: join(base, 'cache'), logs: join(base, 'logs'), workspace: join(base, 'workspace') }
  for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return roots
}
function runPa(packageRoot, roots, args) {
  const result = spawnSync(process.execPath, [join(packageRoot, PA), ...args,
    '--install', packageRoot, '--config-root', roots.config, '--data-root', roots.data,
    '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace, '--json'],
  { encoding: 'utf8', timeout: 30000 })
  let parsed = null
  try { parsed = JSON.parse(result.stdout) } catch { parsed = null }
  return { exit: result.status, parsed }
}

export function runPackageReadonly({ packageRoot, out }) {
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const a = rootSet(out, 'root-a')
  const b = rootSet(out, 'root-b')
  const statusA = runPa(packageRoot, a, ['status'])
  const statusB = runPa(packageRoot, b, ['status'])
  const recoveryA = runPa(packageRoot, a, ['recovery-status'])
  const recoveryB = runPa(packageRoot, b, ['recovery-status'])
  const checks = {
    statusAStopped: statusA.parsed?.status === 'STOPPED',
    statusBStopped: statusB.parsed?.status === 'STOPPED',
    rootsIsolated: statusA.parsed?.roots?.data === a.data && statusB.parsed?.roots?.data === b.data && a.data !== b.data,
    noCrossRoot: !JSON.stringify(statusA.parsed?.roots).includes(b.data) && !JSON.stringify(statusB.parsed?.roots).includes(a.data),
    recoveryAProtocol: recoveryA.parsed?.protocol === 'personal-recovery-status/1',
    recoveryBProtocol: recoveryB.parsed?.protocol === 'personal-recovery-status/1',
    markerAbsentNotAuthority: recoveryA.parsed?.markerPresent === false && recoveryA.parsed?.authorization?.status === 'NOT_REQUIRED',
    queueNeverReplayed: recoveryA.parsed?.queueReplay === 'never',
    distinctRootsRecovery: recoveryA.parsed?.markerPath !== recoveryB.parsed?.markerPath,
    noTaskStarted: statusA.parsed?.status === 'STOPPED' && recoveryA.parsed?.startupMode === 'normal',
  }
  return {
    protocol: 'package-readonly-multiroot/1',
    surface: 'immutable package status/recovery-status on two private roots',
    commandExits: { statusA: statusA.exit, statusB: statusB.exit, recoveryA: recoveryA.exit, recoveryB: recoveryB.exit },
    roots: { a: statusA.parsed?.roots ?? null, b: statusB.parsed?.roots ?? null },
    observations: { statusA: statusA.parsed, statusB: statusB.parsed, recoveryA: recoveryA.parsed, recoveryB: recoveryB.parsed },
    checks,
    contentRead: 'NOT_REACHED: no started product HTTP/readonly content endpoint was used.',
    sse: 'NOT_REACHED: no package SSE entry was started; the bounded fixture soak is separately labelled and is not a package endpoint.',
    authorization: 'status/recovery-status are configuration observations, not a permission, native or release verdict.',
  }
}
