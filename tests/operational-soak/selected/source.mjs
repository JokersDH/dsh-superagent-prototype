/**
 * Wave-28 selected-source binding.
 *
 * A channel result is only meaningful for the exact module that ran. This binder therefore takes an
 * explicit root plus expected git HEAD/blob identities, verifies regular files (no symlinks) before
 * and after a consumer run, and refuses a wrong root, a changed blob or a mid-run change instead of
 * labelling the newest checkout "current". It never edits B/I/main source.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function gitHead(root) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}

export function gitBlob(root, rel) {
  try { return execFileSync('git', ['-C', root, 'hash-object', '--no-filters', rel], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}

export function fileFact(root, rel) {
  const absolute = join(root, rel)
  let info
  try { info = lstatSync(absolute) } catch { return { rel, error: 'missing' } }
  if (info.isSymbolicLink()) return { rel, error: 'symlink' }
  if (!info.isFile()) return { rel, error: 'not_regular' }
  const bytes = readFileSync(absolute)
  return { rel, bytes: bytes.byteLength, sha256: sha256(bytes), blob: gitBlob(root, rel) }
}

/**
 * Verify one root against explicit expectations.
 * `expect`: { head?: string, blobs?: Record<rel, gitBlob>, files?: Record<rel, sha256> }
 */
export function bindSource({ role, root, expect = {} }) {
  const issues = []
  let real
  try { real = realpathSync(resolve(root)) } catch { return { role, root, ok: false, issues: ['root_missing'], head: null, files: [] } }
  const info = lstatSync(real)
  if (!info.isDirectory() || info.isSymbolicLink()) issues.push('root_not_directory')
  const head = gitHead(real)
  if (head === null) issues.push('not_a_git_root')
  if (expect.head !== undefined && head !== expect.head) issues.push(`head_mismatch:${head}`)
  const files = []
  for (const rel of Object.keys({ ...(expect.blobs ?? {}), ...(expect.files ?? {}) })) {
    const fact = fileFact(real, rel)
    files.push(fact)
    if (fact.error) { issues.push(`${rel}:${fact.error}`); continue }
    if (expect.blobs?.[rel] !== undefined && fact.blob !== expect.blobs[rel]) issues.push(`${rel}:blob_mismatch`)
    if (expect.files?.[rel] !== undefined && fact.sha256 !== expect.files[rel]) issues.push(`${rel}:sha256_mismatch`)
  }
  return { role, root: real, ok: issues.length === 0, issues, head, files }
}

/** Re-read the same identity after a consumer run; any change refuses the result. */
export function verifyUnchanged(binding) {
  const again = bindSource({ role: binding.role, root: binding.root, expect: {
    head: binding.head ?? undefined,
    blobs: Object.fromEntries(binding.files.filter((entry) => entry.blob).map((entry) => [entry.rel, entry.blob])),
    files: Object.fromEntries(binding.files.filter((entry) => entry.sha256).map((entry) => [entry.rel, entry.sha256])),
  } })
  return { ok: again.ok, issues: again.issues, head: again.head, files: again.files }
}

export function importFrom(root, rel) {
  return import(new URL(`file://${join(root, rel)}`).href)
}

export const EXPECTED = {
  I: {
    commit: 'd95df88bb9dfdeaef74fa49629dcc2aba25d4d1b',
    branch: 'codex/g5-coordinator-channel',
    head: '4bbef8650c2447a37b453f20c0d5511e73038193',
    blobs: {
      'apps/runner/src/attach-channel/coordinator-channel.ts': 'bf5b25a6e87b6de1f02838cd3b5fe9b5ec394007',
      'apps/runner/src/attach-channel/index.ts': '406b1c18d986b70fde08af7eb017ff2920b557f5',
    },
    materialize: {
      'apps/runner/src/attach-channel/coordinator-channel.ts': '6ad80b75bbae30669dd3746282a205e33e60b3809d0722ef96fee434121a3091',
      'apps/runner/src/attach-channel/errors.ts': 'b9c9bd111cd672b479314faf284d308ba6a1c2d3f5520af6decbded220d08b10',
      'apps/runner/src/attach-channel/index.ts': '1129ea715c50b32a026ce7f9fec538dc6c62ef46c38bc7e0ced286dd848cd04d',
      'packages/contracts/src/coordinator-channel.ts': 'a1445944e47379a13a3f47593173d35c5a20cd0d27a02daa6a880bce98a4f3c1',
      'packages/contracts/src/schemas.ts': '763732584c3b9150f90b644301b679465e252498d75dec19ad601b536f0db045',
      'packages/contracts/src/types.ts': 'ed6661e6bcaa26a24892ad82086bcd5375a19aec3a184f1d6f256af8655103ac',
    },
    dirtyNotice: 'owner worktree has uncommitted attach-channel edits; only the admitted commit is materialized',
  },
  B: {
    commit: 'cb4e97504157e500799284bfd63d51768740c9fc',
    branch: 'codex/g1-runtime',
    head: '423df04e46021f781adf4ee598ffb9b4b7620807',
    blobs: {
      'apps/runner/src/runner-service.ts': 'c2990056c0cd2858a57919f739e052fabadd374b',
      'apps/runner/src/business-channel.ts': '75809b1f4d79c115e2f7e470dbd4c0b51337b7e2',
    },
    materialize: {
      'apps/runner/src/business-channel.ts': '572a1522b01caf0b367d4f0edfc2ce46519839228a8dba4a92561a429220995b',
    },
  },
  main: {
    blobs: {
      'packages/contracts/src/coordinator-channel.ts': 'cf451efe433b8f9140d992ccfb415df9cd74b92c',
    },
  },
}

export const DEFAULT_ROOTS = {
  I: '/Users/hh/Desktop/joker/superagent-agent-i',
  B: '/Users/hh/Desktop/joker/superagent-agent-b',
  main: '/Users/hh/Desktop/joker/superagent-agent-h',
}


/**
 * Materialize exact files from an admitted commit into a new private directory.
 *
 * This reads only git objects (`git show <commit>:<path>`) and writes them under the caller's new
 * output root; it never touches the owner's worktree and is not a second runtime/implementation. The
 * extracted bytes are checked against the expected SHA-256 before any import.
 */
export function materializeFiles({ root, commit, files, dest, nodeModulesFrom = null }) {
  mkdirSync(dest, { recursive: true, mode: 0o700 })
  const issues = []
  const written = []
  for (const [rel, expected] of Object.entries(files)) {
    const result = spawnSync('git', ['-C', root, 'show', `${commit}:${rel}`], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
    if (result.status !== 0) { issues.push(`${rel}:unreadable`); continue }
    const bytes = result.stdout
    const digest = sha256(bytes)
    if (expected !== undefined && digest !== expected) { issues.push(`${rel}:sha256_mismatch`); continue }
    const absolute = join(dest, rel)
    mkdirSync(join(absolute, '..'), { recursive: true, mode: 0o700 })
    writeFileSync(absolute, bytes, { mode: 0o600 })
    written.push({ rel, bytes: bytes.byteLength, sha256: digest })
  }
  if (nodeModulesFrom !== null) {
    try { symlinkSync(nodeModulesFrom, join(dest, 'node_modules'), 'dir') } catch { /* existing symlink is fine */ }
  }
  return { commit, dest, ok: issues.length === 0, issues, files: written }
}

/** Verify that a root still contains the admitted commit and the exact blobs at that commit. */
export function verifyCommitted({ role, root, commit, branch: expectedBranch = null, head: expectedHead = null, blobs = {} }) {
  const issues = []
  let real
  try { real = realpathSync(resolve(root)) } catch { return { role, root, commit, ok: false, issues: ['root_missing'], head: null, blobs: {} } }
  const head = gitHead(real)
  if (head === null) issues.push('not_a_git_root')
  if (expectedBranch !== null) {
    const branch = spawnSync('git', ['-C', real, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? null
    if (branch !== expectedBranch) issues.push(`branch_mismatch:${branch}`)
  }
  // The admitted commit must be reachable from this root's HEAD. Exact HEAD equality is not required:
  // an owner may legitimately advance its branch, while a foreign worktree cannot make the commit an
  // ancestor of its own HEAD (all worktrees share one object database).
  const exists = spawnSync('git', ['-C', real, 'cat-file', '-e', `${commit}^{commit}`], { encoding: 'utf8' })
  if (exists.status !== 0) issues.push('commit_missing')
  else {
    const ancestor = spawnSync('git', ['-C', real, 'merge-base', '--is-ancestor', commit, head ?? commit], { encoding: 'utf8' })
    if (ancestor.status !== 0) issues.push('commit_not_ancestor')
  }
  if (expectedHead !== null && head === null) issues.push(`head_missing`)
  const observed = {}
  for (const [rel, expected] of Object.entries(blobs)) {
    const result = spawnSync('git', ['-C', real, 'rev-parse', `${commit}:${rel}`], { encoding: 'utf8' })
    const blob = result.status === 0 ? result.stdout.trim() : null
    observed[rel] = blob
    if (blob !== expected) issues.push(`${rel}:blob_mismatch`)
  }
  const dirty = spawnSync('git', ['-C', real, 'status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim().split('\n').filter(Boolean).length ?? null
  return { role, root: real, commit, ok: issues.length === 0, issues, head, blobs: observed, dirtyEntries: dirty }
}

/** Re-hash the materialized import files to prove the bytes that ran did not change mid-run. */
export function verifyMaterialized(dest, files) {
  const issues = []
  const observed = []
  for (const [rel, expected] of Object.entries(files)) {
    const fact = fileFact(dest, rel)
    observed.push(fact)
    if (fact.error) issues.push(`${rel}:${fact.error}`)
    else if (fact.sha256 !== expected) issues.push(`${rel}:sha256_mismatch`)
  }
  return { ok: issues.length === 0, issues, files: observed }
}
