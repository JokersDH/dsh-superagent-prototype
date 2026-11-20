import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Milestone-03 preparation helpers (zero model).
 *
 * The live two-project delivery is gated on a D-frozen package and the 3-turn E budget. Everything
 * here can run now: the model-turn ledger, the independent patch-apply verifier, and packaging of two
 * real source backups as importable Git projects.
 */

export const E_TURN_CAP = 3

/**
 * Turn ledger: a reservation prevents concurrent sends but is NOT consumption. Only a turn that was
 * actually written (sent, or an UNKNOWN send whose write may have happened) consumes the cap.
 */
export function createTurnLedger(path) {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 })
  const read = () => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  // The latest entry per id is authoritative, so a later reserve is not shadowed by an earlier cancel.
  const latest = () => {
    const state = new Map()
    for (const entry of read()) if (['reserved', 'sent', 'unknown', 'cancelled', 'unsent_confirmed'].includes(entry.kind)) state.set(entry.id, entry)
    return state
  }
  const activeReservations = () => [...latest()].filter(([, entry]) => entry.kind === 'reserved').map(([id]) => id)
  const consumed = () => new Set([...latest()].filter(([, entry]) => entry.kind === 'sent' || entry.kind === 'unknown').map(([id]) => id))
  return {
    path,
    entries: read,
    consumed,
    used: () => consumed().size,
    inFlight: activeReservations,
    remaining: () => Math.max(0, E_TURN_CAP - consumed().size),
    canReserve: () => consumed().size >= E_TURN_CAP ? { ok: false, reason: 'cap_reached' }
      : consumed().size + activeReservations().length >= E_TURN_CAP ? { ok: false, reason: 'concurrent_reservation' }
        : { ok: true, remaining: E_TURN_CAP - consumed().size, inFlight: activeReservations().length },
    reserve(id, { grant = 'milestone03-e' } = {}) {
      const previous = latest().get(id)?.kind
      if (previous && previous !== 'cancelled') return { ok: false, reason: 'duplicate_id' }
      if (consumed().size >= E_TURN_CAP) return { ok: false, reason: 'cap_reached' }
      if (consumed().size + activeReservations().length >= E_TURN_CAP) return { ok: false, reason: 'concurrent_reservation' }
      const entry = { id, grant, kind: 'reserved', at: new Date().toISOString() }
      writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, entry, used: consumed().size, remaining: E_TURN_CAP - consumed().size }
    },
    /** Only a turnover of an active reservation; the reservation itself never counted. */
    sent(id, { turnStart = null } = {}) {
      if (!activeReservations().includes(id)) return { ok: false, reason: 'not_reserved' }
      writeFileSync(path, `${JSON.stringify({ id, kind: 'sent', turnStart, at: new Date().toISOString() })}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, used: consumed().size }
    },
    /** Reconciles an UNKNOWN send only when the product's own attempt start/end facts prove it was written. */
    reconcileUnknownAsSent(id, evidence) {
      if (latest().get(id)?.kind !== 'unknown') return { ok: false, reason: 'not_unknown' }
      if (!evidence || typeof evidence !== 'string') return { ok: false, reason: 'evidence_required' }
      writeFileSync(path, `${JSON.stringify({ id, kind: 'sent', reconciled: true, evidence, at: new Date().toISOString() })}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, used: consumed().size, remaining: E_TURN_CAP - consumed().size }
    },
    unknown(id, reason) {
      if (!activeReservations().includes(id)) return { ok: false, reason: 'not_reserved' }
      writeFileSync(path, `${JSON.stringify({ id, kind: 'unknown', reason, at: new Date().toISOString() })}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, used: consumed().size }
    },
    /** Setup failed before any write: cancel the in-flight reservation without consuming a turn. */
    cancel(id, reason = 'setup_failed_unsent') {
      if (!activeReservations().includes(id)) return { ok: false, reason: 'not_reserved' }
      writeFileSync(path, `${JSON.stringify({ id, kind: 'cancelled', reason, at: new Date().toISOString() })}\n`, { flag: 'a', mode: 0o600 })
      return { ok: true, used: consumed().size }
    },
    /**
     * Free-form un-sending is disabled. A consumed send/unknown cannot be revoked by a self-authored
     * string; historical unsent_confirmed entries are preserved but new corrections are refused.
     */
    correctUnsent() {
      return { ok: false, reason: 'correction_disabled' }
    },
    canRetry(id) {
      const last = read().filter(entry => entry.id === id).at(-1)?.kind
      return last !== 'unknown'
    },
  }
}

/**
 * Applies a patch to an isolated export of the project baseline and runs its original check.
 * The export is `git archive HEAD` (no .git, no linked-worktree pointer, no external symlinks); the
 * baseline index/HEAD/worktree is verified unchanged before and after. A non-empty target is refused.
 */
export function applyPatchToCopy({ baseline, copy, patchPath, checkArgs = ['--test'], checkCommand = null, gitTop = null }) {
  const top = gitTop ?? baseline
  const gitBaseline = args => execFileSync('git', ['-C', top, ...args], { encoding: 'utf8', timeout: 60_000 })
  const before = { head: gitBaseline(['rev-parse', 'HEAD']).trim(), index: gitBaseline(['write-tree']).trim(),
    status: gitBaseline(['status', '--porcelain']).trim() }
  if (existsSync(copy) && readdirSyncSafe(copy).length > 0) return { refused: 'target_not_empty' }
  mkdirSync(copy, { recursive: true })
  execFileSync('sh', ['-c', `git -C "${top}" archive HEAD | tar -x -C "${copy}"`], { timeout: 300_000 })
  // Refuse an export that kept any .git pointer, link or out-of-bounds symlink.
  const pointers = walk(copy).filter(entry => entry.endsWith('.git') || entry.includes('/.git/'))
  const links = walkLinks(copy)
  if (pointers.length > 0) return { refused: 'git_pointer_in_export', pointers }
  if (links.length > 0) return { refused: 'symlink_out_of_bounds', links }
  // git apply runs on the plain exported tree; no index or repository is created in the copy.
  execFileSync('git', ['-C', copy, 'apply', '--check', patchPath], { timeout: 60_000 })
  execFileSync('git', ['-C', copy, 'apply', patchPath], { timeout: 60_000 })
  const check = checkCommand
    ? execFileSync(process.execPath, ['-e', checkCommand], { cwd: copy, encoding: 'utf8', timeout: 300_000 })
    : execFileSync('npm', ['test', '--silent'], { cwd: copy, encoding: 'utf8', timeout: 300_000 })
  const after = { head: gitBaseline(['rev-parse', 'HEAD']).trim(), index: gitBaseline(['write-tree']).trim(),
    status: gitBaseline(['status', '--porcelain']).trim() }
  return { exported: true, check: String(check).slice(-400), applied: true,
    baselineUnchanged: before.head === after.head && before.index === after.index && before.status === after.status,
    before, after }
}

function readdirSyncSafe(dir) { try { return execFileSync('sh', ['-c', `ls -A "${dir}"`], { encoding: 'utf8' }).split('\n').filter(Boolean) } catch { return [] } }
function walk(dir) { return execFileSync('sh', ['-c', `find "${dir}" -name .git -print`], { encoding: 'utf8' }).split('\n').filter(Boolean) }
function walkLinks(dir) {
  const realRoot = realpathSync(dir)
  const out = execFileSync('sh', ['-c', `find "${dir}" -type l -print`], { encoding: 'utf8' }).split('\n').filter(Boolean)
  return out.filter(link => {
    const target = execFileSync('readlink', [link], { encoding: 'utf8' }).trim()
    if (target.startsWith('/')) return true
    const resolved = resolve(dirname(link), target)
    return resolved !== realRoot && !resolved.startsWith(`${realRoot}/`)
  })
}

/**
 * Makes an importable Git project from a real repository working tree. The source is copied as-is
 * (node_modules included, so the project's own checks are runnable) but its .git is never copied:
 * the backup gets a fresh repository, so no index/HEAD/link points at the original project.
 */
export function prepareRealProject({ source, target, name }) {
  mkdirSync(target, { recursive: true })
  // cp -R preserves the dependency tree (including pnpm links inside it); .git is excluded by name.
  execFileSync('sh', ['-c', `cd "${source}" && tar --exclude=.git -cf - . | tar -xf - -C "${target}"`], { timeout: 300_000 })
  const git = args => execFileSync('git', ['-C', target, ...args], { encoding: 'utf8', timeout: 60_000 })
  git(['init', '-q'])
  git(['add', '-A'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'real project backup'])
  const head = git(['rev-parse', 'HEAD']).trim()
  const packageJson = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  return { path: target, name, head, packageJson, testScript: packageJson.scripts?.test ?? null }
}

/** Runs the project's original test command and extracts the non-zero test count. */
export function runProjectCheck(projectPath, { timeoutMs = 180_000 } = {}) {
  const started = Date.now()
  const result = spawnSync('npm', ['test', '--silent'], { cwd: projectPath, encoding: 'utf8', timeout: timeoutMs })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const passed = output.match(/Tests\s+(\d+)\s+passed/iu) ?? output.match(/# pass (\d+)/u) ?? output.match(/ℹ pass (\d+)/u)
  const failed = output.match(/Tests\s+(\d+)\s+failed/iu) ?? output.match(/ℹ fail (\d+)/u)
  return { exit: result.status, passed: passed ? Number(passed[1]) : null, failed: failed ? Number(failed[1]) : 0,
    tail: output.slice(-600), durationMs: Date.now() - started }
}
