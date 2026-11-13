/**
 * Startup serialization: exactly one `pa start` may pass the identity checks and write an instance
 * record. The lock is a private breadcrumb inside the config root; it is advisory for concurrency
 * only (the writer lock inside the product database remains the execution authority).
 *
 * A lock held by a live launcher refuses a second start. A lock whose pid is gone is removed and
 * retried once; the caller then re-reads the instance record. Removing a breadcrumb is not proof a
 * process disappeared, so liveness always comes from the OS.
 */
import { execFile } from 'node:child_process'
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { processStart } from './instance.mjs'

const execute = promisify(execFile)

export const START_LOCK_FILE = 'start.lock'

const lockPath = (configRoot) => join(configRoot, START_LOCK_FILE)

/**
 * Liveness for startup serialization. `kill(0)` decides existence; a zombie is not a live launcher.
 * If the process state cannot be inspected, treat the holder as alive (fail closed) instead of
 * stealing a lock another starter may still own.
 */
async function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const stat = (await execute('ps', ['-p', String(pid), '-o', 'stat='], { timeout: 2000, encoding: 'utf8' })).stdout.trim()
    return stat !== '' && !stat.toUpperCase().startsWith('Z')
  } catch {
    return true
  }
}

export class StartLockHeld extends Error {
  constructor(holder) {
    super('Another `pa start` is already in progress for this config root')
    this.code = 'start_in_progress'
    this.holder = holder
  }
}

/**
 * Acquire the startup lock. Returns `{ release }`; throws StartLockHeld with the holder facts when a
 * live launcher holds it. A dead holder breadcrumb is removed once and the acquisition retried.
 */
export async function acquireStartLock(configRoot) {
  const path = lockPath(configRoot)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const record = {
      protocol: 'personal-start-lock/1',
      pid: process.pid,
      processStart: await processStart(process.pid),
      startedAt: new Date().toISOString(),
    }
    const temporary = `${path}.${process.pid}.tmp`
    try {
      // Write the complete content to a private temp file, then link it into place atomically. A
      // concurrent starter can therefore never observe an empty/partial lock and mistake it for a
      // dead holder (which would steal the lock).
      const fd = openSync(temporary, 'w', 0o600)
      try {
        const bytes = Buffer.from(`${JSON.stringify(record)}\n`)
        for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      try {
        linkSync(temporary, path)
      } finally {
        try { unlinkSync(temporary) } catch { /* already gone */ }
      }
      let released = false
      return {
        path,
        record,
        release() {
          if (released) return
          released = true
          try { unlinkSync(path) } catch { /* already removed */ }
        },
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    let holder = null
    try {
      holder = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      // Unreadable content proves nothing about the holder; fail closed instead of stealing it.
      throw new StartLockHeld({ reason: 'unreadable_lock' })
    }
    if (typeof holder?.pid !== 'number' || !Number.isSafeInteger(holder.pid)) throw new StartLockHeld({ reason: 'invalid_lock' })
    if (await alive(holder.pid)) throw new StartLockHeld(holder)
    // A valid breadcrumb whose process is verifiably gone leaves no authority behind.
    try { unlinkSync(path) } catch { /* raced with another cleaner */ }
  }
  throw new StartLockHeld(null)
}
