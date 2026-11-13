/**
 * Restore-marker handling for the launcher. A state restored by `pa restore` carries
 * `restore-report.json`; main's coordinator entry forces `recovery_readonly` when that marker exists.
 *
 * The launcher must:
 * - detect the marker before start and request `--startup-mode recovery_readonly` explicitly;
 * - verify `/v1/health.startupMode` actually reports read-only execution;
 * - never delete the marker, and never expose an "allow resume" switch;
 * - surface that rebinding/revalidation and new authorization are owned by main.
 */
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const RESTORE_MARKER = 'restore-report.json'

/**
 * @typedef {object} RestoreMarker
 * @property {boolean} present
 * @property {string} path
 * @property {boolean} valid
 * @property {unknown | null} report
 * @property {string | null} error
 */

/** Read-only marker inspection. A present marker is authoritative even when its JSON is unreadable. @returns {RestoreMarker} */
export function readRestoreMarker(stateDir) {
  const path = join(stateDir, RESTORE_MARKER)
  if (!existsSync(path)) return { present: false, path, valid: false, report: null, error: null }
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink())
      return { present: true, path, valid: false, report: null, error: 'restore marker is not a regular file' }
    if (stat.size > 1024 * 1024) return { present: true, path, valid: false, report: null, error: 'restore marker is too large' }
    const report = JSON.parse(readFileSync(path, 'utf8'))
    const protocol = report?.protocol
    if (protocol !== 'personal-restore/1')
      return { present: true, path, valid: false, report, error: 'restore marker protocol is not personal-restore/1' }
    return { present: true, path, valid: true, report, error: null }
  } catch (error) {
    return {
      present: true,
      path,
      valid: false,
      report: null,
      error: String(error?.message ?? error),
    }
  }
}

/** @returns {'normal' | 'recovery_readonly'} */
export function expectedStartupMode(stateDir) {
  return readRestoreMarker(stateDir).present ? 'recovery_readonly' : 'normal'
}

/**
 * @typedef {object} RecoverySummary
 * @property {'normal' | 'recovery_readonly'} startupMode
 * @property {boolean} markerPresent
 * @property {boolean} markerValid
 * @property {string | null} warning
 * @property {readonly string[]} requiresRevalidation
 * @property {readonly string[]} pendingRebind
 */

/** @returns {RecoverySummary} */
export const RECOVERY_AUTHORIZATION = {
  status: 'BLOCKED',
  owner: 'main',
  interface: 'recovery inspect/prepare/commit public interface (WP-16/0023 §6)',
  reason:
    'This build has only the read-only startup gate. Fresh binding/verification, an explicit plan with TTL/fingerprint and transactional new-work authorization are main-owned and not published yet; D does not guess HTTP shapes or add a force switch.',
  requiredInputs: [
    'inspect: read-only recovery state, verifiable sources and blockers; never dispatch old queue',
    'prepare: re-verify machine/project paths/executor/environment/evidence and return a bounded plan snapshot',
    'commit: authenticated confirmation of the exact plan/current fingerprint with idempotent receipt, drift rejection and same-transaction authorization',
  ],
  forbidden: ['delete restore marker', 'force switch', 'replay old queue', 'old writer/native session as new authority', 'second auth/key store'],
}

/** Local, read-only recovery projection. It never calls HTTP or mutates the marker/state. */
export function recoveryStatus({ roots }) {
  const marker = readRestoreMarker(roots.data)
  const summary = recoverySummary(roots.data)
  return {
    protocol: 'personal-recovery-status/1',
    checkedAt: new Date().toISOString(),
    stateName: roots.data.split('/').pop() ?? 'state',
    markerPresent: marker.present,
    markerValid: marker.valid,
    markerPath: marker.path,
    startupMode: summary.startupMode,
    pendingRebind: summary.pendingRebind,
    requiresRevalidation: summary.requiresRevalidation,
    queueReplay: 'never',
    markerPreserved: marker.present,
    authorization: marker.present ? RECOVERY_AUTHORIZATION : { status: 'NOT_REQUIRED', owner: null, reason: 'No restore marker; normal startup authorization applies.' },
    limitations: [
      'Local projection only: this does not prove the writer is stopped, does not start the daemon and does not consume any queue.',
      'New-work authorization requires the main inspect/prepare/commit interface; blocked rather than bypassed when absent.',
      ...(marker.present && !marker.valid ? ['The restore marker is unreadable; the state is still treated as read-only.'] : []),
    ],
  }
}

export function recoverySummary(stateDir) {
  const marker = readRestoreMarker(stateDir)
  if (!marker.present)
    return { startupMode: 'normal', markerPresent: false, markerValid: false, warning: null, requiresRevalidation: [], pendingRebind: [] }
  const report = marker.report
  const requiresRevalidation = Array.isArray(report?.requiresRevalidation)
    ? report.requiresRevalidation.filter((entry) => typeof entry === 'string')
    : []
  const pendingRebind = Array.isArray(report?.pathMappings?.pendingRebind)
    ? report.pathMappings.pendingRebind.filter((entry) => typeof entry === 'string')
    : []
  return {
    startupMode: 'recovery_readonly',
    markerPresent: true,
    markerValid: marker.valid,
    warning: marker.valid
      ? '恢复态只读：仅历史/诊断；重新绑定与重新验证由 main 的恢复授权完成前不会开启业务。'
      : `恢复 marker 无法解析（${marker.error ?? 'unknown'}）；仍按只读处理，不会删除 marker。`,
    requiresRevalidation,
    pendingRebind,
  }
}
