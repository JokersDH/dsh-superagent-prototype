/**
 * Report roots and exit semantics shared by the trial-kit CLIs.
 *
 * Every command writes into a caller-supplied, brand-new directory created 0700. Report files are
 * created 0600 with O_EXCL, so a second run can never overwrite a colleague's earlier evidence and
 * a failed run leaves its partial material in place for inspection.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export const EXIT = Object.freeze({ OK: 0, DEGRADED: 1, REFUSED: 2, INTERNAL: 3 })

export class TrialKitError extends Error {
  constructor(code, message, detail = undefined, exitCode = EXIT.REFUSED) {
    super(message)
    this.name = 'TrialKitError'
    this.code = code
    this.detail = detail
    this.exitCode = exitCode
  }
}

export const nowIso = () => new Date().toISOString()

/** Refuse to reuse an existing output root: evidence directories are append-only by identity. */
export function createOutputRoot(path) {
  if (typeof path !== 'string' || path.length === 0) throw new TrialKitError('usage', '--out <new-directory> is required')
  const absolute = resolve(path)
  if (!isAbsolute(absolute)) throw new TrialKitError('usage', '--out must resolve to an absolute path')
  try {
    mkdirSync(absolute, { mode: 0o700, recursive: false })
  } catch (error) {
    if (error?.code === 'EEXIST') throw new TrialKitError('output_exists', 'Output root already exists; refusing to overwrite', { path: absolute })
    throw new TrialKitError('output_unavailable', 'Output root cannot be created', { path: absolute, cause: String(error?.code ?? error) })
  }
  return absolute
}

/** Write one report file 0600 with O_EXCL and fsync, returning its path and digest-ready bytes count. */
export function writePrivateFile(root, name, text) {
  const path = resolve(root, name)
  const bytes = Buffer.from(text, 'utf8')
  let fd
  try {
    fd = openSync(path, 'wx', 0o600)
    writeSync(fd, bytes)
    fsyncSync(fd)
  } catch (error) {
    throw new TrialKitError('output_write_failed', 'Report file cannot be created', { name, cause: String(error?.code ?? error) })
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  return { path, bytes: bytes.byteLength }
}

export function writePrivateJson(root, name, value) {
  return writePrivateFile(root, name, `${JSON.stringify(value, null, 2)}\n`)
}

export function printHuman(lines) {
  process.stdout.write(`${lines.join('\n')}\n`)
}

export function summarize(checks) {
  const counts = { PASS: 0, WARN: 0, FAIL: 0, UNKNOWN: 0, NOT_APPLICABLE: 0 }
  for (const check of checks) counts[check.status] = (counts[check.status] ?? 0) + 1
  const result = counts.FAIL > 0 ? 'REFUSED' : counts.WARN > 0 || counts.UNKNOWN > 0 ? 'DEGRADED' : 'OK'
  return { counts, result, exitCode: result === 'OK' ? EXIT.OK : result === 'DEGRADED' ? EXIT.DEGRADED : EXIT.REFUSED }
}

export function check(id, status, detail = undefined) {
  return detail === undefined ? { id, status } : { id, status, detail }
}

export function pass(id, detail) { return check(id, 'PASS', detail) }
export function warn(id, detail) { return check(id, 'WARN', detail) }
export function fail(id, detail) { return check(id, 'FAIL', detail) }
export function unknown(id, detail) { return check(id, 'UNKNOWN', detail) }
