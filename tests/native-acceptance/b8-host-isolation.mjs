#!/usr/bin/env node
/**
 * B8: material-copy isolation and host isolation, proven SEPARATELY (wave-06 B, zero model calls).
 *
 * These are two different claims and must not be conflated:
 *
 *   1. MATERIAL COPY - the reviewer works on a disposable full copy that shares nothing with the
 *      author's checkout. Proven by construction and by inode/git/scratch checks.
 *   2. HOST ISOLATION - a copy is not a sandbox. The run must be prevented, by an actual OS
 *      mechanism, from touching the author's material, reading credentials it should not open, or
 *      sending data out. Proven by measuring deny/allow under a real enforcement profile.
 *
 * The host half uses macOS Seatbelt (`sandbox-exec`), which is enforced by the kernel for the
 * child process. For every axis we measure BOTH states: without the profile (allowed) and with it
 * (denied). A deny that also happens when the mechanism is absent proves nothing, so the
 * counter-case is part of the evidence.
 *
 * Scratch writes inside the capsule are intentionally ALLOWED: a review may need temp files, and
 * discarding them is cheaper than pretending read-only is required (Amendment 01).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'

const log = new CaseLog()
const sha256 = data => createHash('sha256').update(data).digest('hex')
const digestOf = path => sha256(readFileSync(path))

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w06-b8-')))
const authorProject = join(root, 'author-project')
const authorHome = join(root, 'author-home')
const capsule = join(root, 'capsule')

// --- author side -----------------------------------------------------------------------------
mkdirSync(join(authorProject, 'src'), { recursive: true })
mkdirSync(join(authorProject, '.git', 'objects'), { recursive: true })
mkdirSync(join(authorProject, '.git', 'hooks'), { recursive: true })
mkdirSync(authorHome, { recursive: true })
writeFileSync(join(authorProject, 'src', 'app.ts'), 'export const answer = 41\n')
writeFileSync(join(authorProject, '.git', 'config'), '[remote "origin"]\n\turl = git@example.com:private/repo.git\n')
writeFileSync(join(authorProject, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\necho hook\n')
writeFileSync(join(authorHome, 'auth.json'), '{"token":"SECRET-VALUE-DO-NOT-LEAK"}')
writeFileSync(join(authorHome, 'notes.md'), 'author private notes\n')
const pristineApp = readFileSync(join(authorProject, 'src', 'app.ts'))
const authorAppBefore = digestOf(join(authorProject, 'src', 'app.ts'))
const authorAuthBefore = digestOf(join(authorHome, 'auth.json'))

// --- capsule: full copy of the working tree, never .git --------------------------------------
function buildCapsule() {
  mkdirSync(capsule, { recursive: true })
  const files = []
  const walk = rel => {
    for (const entry of readdirSync(join(authorProject, rel), { withFileTypes: true })) {
      const childRel = rel ? join(rel, entry.name) : entry.name
      if (childRel === '.git' || childRel.startsWith('.git/')) continue
      const abs = join(authorProject, childRel)
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) { walk(childRel); continue }
      if (!st.isFile()) continue
      const dest = join(capsule, childRel)
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(abs, dest)
      files.push({ path: childRel, sha256: digestOf(dest), ino: statSync(dest).ino })
    }
  }
  walk('')
  return files
}

// ===============================================================================================
// Track 1: material copy isolation
// ===============================================================================================
const copied = buildCapsule()
const capsuleFiles = existsSync(capsule) ? copied : []
const gitEntries = []
const scanGit = rel => {
  for (const entry of readdirSync(join(capsule, rel), { withFileTypes: true })) {
    const childRel = rel ? join(rel, entry.name) : entry.name
    if (entry.name === '.git') { gitEntries.push(childRel); continue }
    if (entry.isDirectory()) scanGit(childRel)
  }
}
scanGit('')

log.begin('B8-COPY-NO-GIT', 'the capsule contains no Git surface at all', 'package-local')
const noRemote = !existsSync(join(capsule, '.git', 'config'))
const noHooks = !existsSync(join(capsule, '.git', 'hooks'))
const copiedAll = capsuleFiles.length === 2 // src/app.ts + nothing else tracked at top level
log.evidence({ capsuleFiles: capsuleFiles.map(f => f.path), gitEntries, noRemote, noHooks })
if (gitEntries.length === 0 && noRemote && noHooks) log.pass('no .git, no remote config, no hooks in the capsule')
else log.fail(`capsule leaked a Git surface: entries=${gitEntries.join(',')} remote=${!noRemote} hooks=${!noHooks}`)

log.begin('B8-COPY-NO-SHARED-INODE', 'no capsule file shares an inode with the author tree', 'package-local')
const shared = capsuleFiles.filter(f => statSync(join(authorProject, f.path)).ino === f.ino)
if (shared.length === 0) log.pass(`${capsuleFiles.length} file(s) copied by bytes; none hardlinked`)
else log.fail(`shared inodes: ${shared.map(f => f.path).join(', ')}`)

log.begin('B8-COPY-AUTHOR-UNCHANGED', 'working in the capsule never alters the author material', 'package-local')
// Simulate a review that edits its copy aggressively.
writeFileSync(join(capsule, 'src', 'app.ts'), 'export const answer = 0 // reviewer edit\n')
writeFileSync(join(capsule, 'scratch.md'), 'notes\n')
const authorStillOriginal = digestOf(join(authorProject, 'src', 'app.ts')) === authorAppBefore
log.evidence({ authorAppDigestMatchesOriginal: authorStillOriginal })
if (authorStillOriginal) log.pass('edits inside the capsule left the author working file byte-identical')
else log.fail('an edit inside the capsule changed the author file')

// ===============================================================================================
// Track 2: host isolation, measured with and without real enforcement
// ===============================================================================================
const canEnforce = spawnSync('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true']).status === 0

/** Run a shell snippet, optionally under a Seatbelt profile. Returns {status, output}. */
function run(snippet, { profile = null } = {}) {
  const args = profile ? ['-f', profile, '/bin/sh', '-c', snippet] : ['-c', snippet]
  const result = spawnSync(profile ? 'sandbox-exec' : '/bin/sh', args, { encoding: 'utf8', timeout: 30_000 })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

/** Build a profile: deny network, deny writes outside the capsule, deny reads of the author home. */
function writeProfile() {
  const path = join(root, 'review.sb')
  writeFileSync(path, [
    '(version 1)',
    '(allow default)',
    // No egress of any kind.
    '(deny network*)',
    // Credentials the reviewer has no business opening.
    `(deny file-read* (subpath "${authorHome}"))`,
    `(deny file-write* (subpath "${authorHome}"))`,
    // The author's working material is read-only at most; never a write target.
    `(deny file-write* (subpath "${authorProject}"))`,
    // Scratch outside the capsule is not allowed either.
    '(deny file-write* (subpath "/tmp"))',
    `(allow file-write* (subpath "${capsule}"))`,
  ].join('\n') + '\n')
  return path
}
const profile = canEnforce ? writeProfile() : null

const axes = [
  {
    id: 'B8-HOST-READ-CREDENTIAL',
    label: 'the reviewer cannot read the author credential file',
    snippet: `cat "${join(authorHome, 'auth.json')}"`,
  },
  {
    id: 'B8-HOST-WRITE-AUTHOR',
    label: 'the reviewer cannot modify the author material',
    snippet: `printf tampered > "${join(authorProject, 'src', 'app.ts')}"`,
  },
  {
    id: 'B8-HOST-NETWORK-EGRESS',
    label: 'the reviewer cannot send data out over the network',
    snippet: 'curl -s -m 4 -o /dev/null -w "http=%{http_code}" https://example.com',
  },
]

for (const axis of axes) {
  log.begin(axis.id, axis.label, 'package-local')
  const loose = run(axis.snippet)
  // The un-profiled probe is SUPPOSED to succeed - that is the counter-case proving the profile is
  // what denies it. Undo any damage it did so subsequent measurements start from a pristine tree.
  if (axis.id === 'B8-HOST-WRITE-AUTHOR') writeFileSync(join(authorProject, 'src', 'app.ts'), pristineApp)
  const strict = profile ? run(axis.snippet, { profile }) : { status: null, output: 'no enforcement available' }
  // "Allowed" means the operation completed; "denied" means a non-zero status or an explicit
  // permission error. Both states are recorded so the mechanism is shown to be doing the work.
  const looseAllowed = loose.status === 0
  const strictDenied = profile ? strict.status !== 0 || /not permitted|denied|operation not permitted|http=000/i.test(strict.output) : false
  log.evidence({
    withoutProfile: { status: loose.status, allowed: looseAllowed },
    withProfile: { status: strict.status, output: strict.output.slice(0, 120) },
    enforcement: canEnforce ? 'macos-seatbelt' : 'unavailable',
  })
  if (!canEnforce) {
    log.notTested('no host enforcement mechanism is available on this system, so denial cannot be shown')
  } else if (looseAllowed && strictDenied) {
    log.pass('allowed without the profile and denied with it, so the profile is what enforces this')
  } else {
    log.fail(`not isolated: without=${looseAllowed ? 'allowed' : 'blocked'} with=${strictDenied ? 'denied' : 'allowed'}`)
  }
}

log.begin('B8-HOST-SCRATCH-ALLOWED', 'scratch writes inside the capsule stay allowed under the profile', 'package-local')
if (profile) {
  const scratchPath = join(capsule, 'scratch-under-profile.md')
  const scratch = run(`printf scratch > "${scratchPath}" && cat "${scratchPath}"`, { profile })
  const wrote = scratch.status === 0 && existsSync(scratchPath)
  log.evidence({ status: scratch.status, wrote })
  if (wrote) log.pass('the profile permits scratch inside the capsule, so a review is not forced read-only')
  else log.fail('the profile blocked legitimate capsule scratch writes')
} else {
  log.notTested('no enforcement mechanism available')
}

log.begin('B8-HOST-PROFILE-DOES-NOT-BREAK-READS', 'the profile still permits reading the capsule and system tools', 'package-local')
if (profile) {
  const read = run(`cat "${join(capsule, 'src', 'app.ts')}"`, { profile })
  log.evidence({ status: read.status, output: read.output.slice(0, 80) })
  if (read.status === 0 && read.output.includes('answer')) log.pass('capsule reads still work under the profile')
  else log.fail('the profile broke ordinary capsule reads, so it is not a usable boundary')
} else {
  log.notTested('no enforcement mechanism available')
}

// ===============================================================================================
// Both tracks must leave the author's material intact.
// ===============================================================================================
log.begin('B8-AUTHOR-MATERIAL-INTACT', 'after every probe the author material and credentials are unchanged', 'package-local')
const authorAppAfter = digestOf(join(authorProject, 'src', 'app.ts'))
const authorAuthAfter = digestOf(join(authorHome, 'auth.json'))
log.evidence({ appMatches: authorAppAfter === authorAppBefore, authMatches: authorAuthAfter === authorAuthBefore })
if (authorAppAfter === authorAppBefore && authorAuthAfter === authorAuthBefore) {
  log.pass('the author working file and credential file are byte-identical to before the probes')
} else {
  log.fail('a probe changed author material or credentials')
}

rmSync(root, { recursive: true, force: true })

const report = writeReport(
  {
    cases: log.cases,
    environment: {
      note: 'wave-06 B8 material-copy vs host isolation',
      modelCalls: 0,
      enforcement: canEnforce ? 'macos-seatbelt (sandbox-exec)' : 'unavailable',
    },
  },
  process.argv.includes('--record') ? `${new URL('.', import.meta.url).pathname}reports/b8-host-isolation.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(30)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB8 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
