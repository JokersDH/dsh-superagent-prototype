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
