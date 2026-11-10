/**
 * Startup serialization: exactly one `pa start` may pass the identity checks and write an instance
 * record. The lock is a private breadcrumb inside the config root; it is advisory for concurrency
 * only (the writer lock inside the product database remains the execution authority).
 *
 * A lock held by a live launcher refuses a second start. A lock whose pid is gone is removed and
 * retried once; the caller then re-reads the instance record. Removing a breadcrumb is not proof a
 * process disappeared, so liveness always comes from the OS.
 */
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { processStart } from './instance.mjs'

export const START_LOCK_FILE = 'start.lock'

const lockPath = (configRoot) => join(configRoot, START_LOCK_FILE)

async function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const stat = await processStart(pid)
    // A zombie is not alive; processStart returns a timestamp for zombies on some systems, so rely
    // on the launcher identity check elsewhere. Here an existing timestamp is enough to conflict.
    return stat !== null
  } catch {
    return false
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
    try {
      const fd = openSync(path, 'wx', 0o600)
      try {
        const bytes = Buffer.from(`${JSON.stringify(record)}\n`)
        for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
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
      holder = null
    }
    const holderPid = Number(holder?.pid)
    if (Number.isSafeInteger(holderPid) && (await alive(holderPid))) throw new StartLockHeld(holder)
    // Dead/invalid breadcrumb: a process that already exited leaves no authority behind.
    try { unlinkSync(path) } catch { /* raced with another cleaner */ }
  }
  throw new StartLockHeld(null)
}
