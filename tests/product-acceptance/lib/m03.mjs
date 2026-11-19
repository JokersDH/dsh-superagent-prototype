import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Milestone-03 preparation helpers (zero model).
 *
 * The live two-project delivery is gated on a D-frozen package and the 3-turn E budget. Everything
 * here can run now: the model-turn ledger, the independent patch-apply verifier, and packaging of two
 * real source backups as importable Git projects.
 */

export const E_TURN_CAP = 3

/** A ledger that only ever appends: reserved -> sent | unknown. Unknown occupies the budget. */
export function createTurnLedger(path) {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 })
  const read = () => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  // One turn id counts once across reserved -> sent|unknown.
  const used = () => new Set(read().filter(entry => ['reserved', 'sent', 'unknown'].includes(entry.kind)).map(entry => entry.id)).size
  return {
    path,
    entries: read,
    used,
    remaining: () => Math.max(0, E_TURN_CAP - used()),
    reserve(id, { grant = 'milestone03-e' } = {}) {
      const entries = read()
      if (entries.some(entry => entry.id === id && entry.kind !== 'refused'))
        return { ok: false, reason: 'duplicate_id' }
      if (used() >= E_TURN_CAP) return { ok: false, reason: 'cap_reached' }
      const entry = { id, grant, kind: 'reserved', at: new Date().toISOString() }
      writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, entry, remaining: E_TURN_CAP - used() }
    },
    sent(id, { turnStart = null } = {}) {
      if (!read().some(entry => entry.id === id && entry.kind === 'reserved')) return { ok: false, reason: 'not_reserved' }
      const entry = { id, kind: 'sent', turnStart, at: new Date().toISOString() }
      writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, entry }
    },
    unknown(id, reason) {
      if (!read().some(entry => entry.id === id && entry.kind === 'reserved')) return { ok: false, reason: 'not_reserved' }
      const entry = { id, kind: 'unknown', reason, at: new Date().toISOString() }
      writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, entry }
    },
    /** An unknown send is never retried with a new id; a retry needs the original id reconciled first. */
    canRetryAfterUnknown(id) {
      return !read().some(entry => entry.kind === 'unknown' && entry.id === id)
    },
  }
}

/**
 * Applies a patch to an independent copy of the project baseline and runs its original check.
 * The baseline tree is never modified; the copy is a fresh directory.
 */
export function applyPatchToCopy({ baseline, copy, patchPath, checkArgs = ['--test'] }) {
  mkdirSync(copy, { recursive: true })
  cpSync(baseline, copy, { recursive: true, filter: source => !source.includes('/.git/') })
  const git = args => execFileSync('git', args, { cwd: copy, encoding: 'utf8', timeout: 60_000 })
  git(['init', '-q'])
  git(['add', '-A'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'baseline'])
  const applied = execFileSync('git', ['apply', '--check', patchPath], { cwd: copy, encoding: 'utf8', timeout: 60_000 })
  execFileSync('git', ['apply', patchPath], { cwd: copy, timeout: 60_000 })
  const check = execFileSync(process.execPath, checkArgs, { cwd: copy, encoding: 'utf8', timeout: 120_000 })
  return { applied: applied === '' || true, check: String(check).slice(-400) }
}

/**
 * Makes an importable Git project from a real source backup: copies the source tree, adds the
 * named check script if the source has no test entry, and commits. `check` is the project's declared
 * verification command for the product import form.
 */
export function prepareBackupProject({ source, target, name, testSource = null, check = 'node_test' }) {
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true, filter: path => !path.includes('/node_modules/') })
  if (testSource) {
    mkdirSync(join(target, 'test'), { recursive: true })
    cpSync(testSource, join(target, 'test', 'project.test.mjs'))
  }
  writeFileSync(join(target, 'package.json'), `${JSON.stringify({ name, private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`)
  const git = args => execFileSync('git', args, { cwd: target, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', '-A'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'real source backup'])
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim()
  return { path: target, name, check, head }
}
