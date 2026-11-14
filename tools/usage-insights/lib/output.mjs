/**
 * Exclusive, private output files.
 *
 * A report is written by creating a private temporary file in the destination directory, syncing it,
 * and hard-linking it to the final name. `link` refuses an existing target, so a previous report can
 * never be overwritten and a symlinked target can never be followed. On any failure only the exact
 * temporary file this process created is removed.
 */
import { closeSync, fchmodSync, fsyncSync, linkSync, lstatSync, openSync, unlinkSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'

export class OutputConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OutputConflictError'
    this.code = 'output_conflict'
  }
}

export function resolveTarget(target) {
  if (typeof target !== 'string' || target.length === 0) throw new OutputConflictError('An output path is required')
  const absolute = resolve(target)
  let parent
  try {
    parent = lstatSync(dirname(absolute))
  } catch {
    throw new OutputConflictError(`Output directory does not exist: ${dirname(absolute)}`)
  }
  if (parent.isSymbolicLink()) throw new OutputConflictError('Output directory must not be a symbolic link')
  if (!parent.isDirectory()) throw new OutputConflictError('Output parent must be a directory')
  try {
    const target_stat = lstatSync(absolute)
    if (target_stat.isSymbolicLink()) throw new OutputConflictError('Refusing to write through a symbolic link')
    throw new OutputConflictError(`Refusing to overwrite an existing file: ${absolute}`)
  } catch (error) {
    if (error instanceof OutputConflictError) throw error
    if (error.code !== 'ENOENT') throw new OutputConflictError(`Cannot stat output target: ${absolute}`)
  }
  return absolute
}

/** Write `content` to `target` with 0600, refusing to replace anything. Returns the absolute path. */
export function writeExclusive(target, content) {
  const absolute = resolveTarget(target)
  const temporary = `${dirname(absolute)}/.usage-insights-${randomBytes(8).toString('hex')}.tmp`
  let descriptor
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    fchmodSync(descriptor, 0o600)
    writeSync(descriptor, content)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    linkSync(temporary, absolute)
    unlinkSync(temporary)
    return absolute
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* already closed */ }
    }
    try { unlinkSync(temporary) } catch { /* only our own temporary file */ }
    if (error instanceof OutputConflictError) throw error
    if (error && error.code === 'EEXIST') throw new OutputConflictError(`Refusing to overwrite an existing file: ${absolute}`)
    throw error
  }
}
