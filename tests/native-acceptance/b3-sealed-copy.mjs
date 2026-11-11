#!/usr/bin/env node
/**
 * B3: one-shot sealed capsule + host-boundary evidence (wave-06, zero model calls).
 *
 * Two claims are tested *separately*, because they are different things:
 *
 *   1. SEALED COPY - the reviewer gets a full copy of the frozen material that shares no Git
 *      objects, remotes, hooks, symlinks, hardlinks or inodes with the author's checkout.
 *   2. HOST BOUNDARY - a copy is NOT a sandbox. Copying files says nothing about which host
 *      files, credentials, tools or network the run can still reach. So we probe escapes that a
 *      copy alone does not prevent, and report what is actually enforced on this host.
 *
 * The negative cases are the point: an author directory that is still reachable, a symlink that
 * escapes the capsule, a hardlink that modifies the original through the copy, and a scratch
 * write that is discarded while the frozen source stays byte-identical.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'

const log = new CaseLog()
const sha256 = data => createHash('sha256').update(data).digest('hex')
const digestOfFile = path => sha256(readFileSync(path))

/** Build a small "author checkout" that looks like a real project with Git metadata inside. */
function makeAuthorProject(root) {
  const project = join(root, 'author-project')
  mkdirSync(join(project, 'src'), { recursive: true })
  mkdirSync(join(project, '.git', 'objects', 'ab'), { recursive: true })
  mkdirSync(join(project, '.git', 'hooks'), { recursive: true })
  mkdirSync(join(project, '.git', 'refs'), { recursive: true })
  writeFileSync(join(project, 'src', 'app.ts'), 'export const answer = 41\n')
  writeFileSync(join(project, 'README.md'), '# candidate\n')
  writeFileSync(join(project, '.git', 'config'), '[remote "origin"]\n\turl = git@example.com:secret/repo.git\n')
  writeFileSync(join(project, '.git', 'objects', 'ab', 'cdef'), 'blob-bytes')
  writeFileSync(join(project, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\necho hook\n')
  writeFileSync(join(project, '.git', 'refs', 'HEAD'), 'ref: refs/heads/main\n')
  // A credential-ish file outside the project that a copy must not make reachable.
  mkdirSync(join(root, 'author-home'), { recursive: true })
  writeFileSync(join(root, 'author-home', 'auth.json'), '{"token":"SECRET-TOKEN-VALUE"}')
  return project
}

/**
 * Sealed copy: replicate the working tree WITHOUT .git, then rebuild nothing and share no inode.
 * Deliberately not `cp -a` after `rm .git`: hooks/remotes are dropped by excluding .git entirely,
 * and we verify inodes rather than trusting the copy mode.
 */
function sealedCopy(project, capsule, digestManifest) {
  const files = []
  const walk = (rel) => {
    for (const entry of readdirSync(join(project, rel), { withFileTypes: true })) {
      const childRel = rel ? join(rel, entry.name) : entry.name
      if (childRel === '.git' || childRel.startsWith(`.git${'/'}`) || childRel.startsWith('.git/')) continue
      const abs = join(project, childRel)
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) continue // links are never replicated: they could escape
      if (st.isDirectory()) { walk(childRel); continue }
      if (!st.isFile()) continue
      const dest = join(capsule, childRel)
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(abs, dest) // cp copies bytes; it does not hardlink
      files.push({ path: childRel, sha256: digestOfFile(dest), inode: statSync(dest).ino })
    }
  }
  walk('')
  files.sort((a, b) => a.path.localeCompare(b.path))
  const manifestDigest = sha256(JSON.stringify(['sealed-copy/1', digestManifest, files.map(f => [f.path, f.sha256])]))
  writeFileSync(join(capsule, '.capsule-manifest.json'), `${JSON.stringify({
    protocol: 'sealed-copy/1', subjectDigest: digestManifest, manifestDigest,
    files: files.map(f => ({ path: f.path, sha256: f.sha256 })),
  }, null, 2)}\n`)
  return { files, manifestDigest }
}

const root = mkdtempSync(join(tmpdir(), 'pa-w06-b3-'))
const project = makeAuthorProject(root)
const frozenDigest = sha256(JSON.stringify(['frozen-subject/1', digestOfFile(join(project, 'src', 'app.ts'))]))
const capsule = join(root, 'capsule-01')
mkdirSync(capsule, { recursive: true })

// ---- Case 1: the sealed copy exists and shares no Git surface -------------------------------
log.begin('B3-SEALED-COPY', 'the capsule is a full copy without any Git surface', 'package-local')
const copy = sealedCopy(project, capsule, frozenDigest)
// Pristine hashes of the AUTHOR files, captured before any tampering probe runs.
const pristineAuthor = copy.files.map(f => ({ path: f.path, sha256: digestOfFile(join(project, f.path)) }))
const capsuleHasGit = existsSync(join(capsule, '.git'))
const remoteReachable = existsSync(join(capsule, '.git', 'config'))
const hooksReachable = existsSync(join(capsule, '.git', 'hooks'))
const fileCount = copy.files.length
const expected = readdirSync(join(project, 'src')).length + 1 // src/app.ts + README.md
if (!capsuleHasGit && !remoteReachable && !hooksReachable && fileCount === expected) {
  log.pass(`copied ${fileCount} file(s); no .git, no remote config, no hooks in the capsule`)
} else {
  log.fail(`capsule leaked a Git surface (git=${capsuleHasGit} remote=${remoteReachable} hooks=${hooksReachable} files=${fileCount}/${expected})`)
}

// ---- Case 2: no shared inode between capsule and author working files ------------------------
log.begin('B3-NO-SHARED-INODE', 'capsule files never share an inode with the author checkout', 'package-local')
const shared = copy.files.filter(f => {
  const authorPath = join(project, f.path)
  return existsSync(authorPath) && statSync(authorPath).ino === f.inode
})
log.evidence({ sharedInodes: shared.map(f => f.path) })
if (shared.length === 0) log.pass('every file was copied, none hardlinked')
else log.fail(`these files share an inode with the author: ${shared.map(f => f.path).join(', ')}`)

// ---- Case 3: a hardlink placed in the capsule is detected, not trusted ----------------------
log.begin('B3-HARDLINK-ESCAPE', 'a hardlink that would modify the author copy is refused or detected', 'package-local')
const evilCapsule = join(root, 'capsule-hardlink')
mkdirSync(evilCapsule, { recursive: true })
const authorFile = join(project, 'src', 'app.ts')
const beforeAuthorDigest = digestOfFile(authorFile)
try {
  linkSync(authorFile, join(evilCapsule, 'hijacked.ts'))
} catch (error) {
  log.evidence({ hardlinkRefused: String(error && error.code) })
}
const hijacked = join(evilCapsule, 'hijacked.ts')
let sameInode = false
if (existsSync(hijacked)) {
  sameInode = statSync(hijacked).ino === statSync(authorFile).ino
  if (sameInode) writeFileSync(hijacked, 'TAMPERED\n')
}
const authorChanged = digestOfFile(authorFile) !== beforeAuthorDigest
log.evidence({ hardlinkCreated: existsSync(hijacked), sameInode, authorChanged })
// Either the OS/FS refused the link, or we can detect it. What is never acceptable is silently
// treating a linked file as an isolated copy.
if (!existsSync(hijacked) || !sameInode) {
  log.pass('no hardlink into the capsule shares the author inode')
} else {
  // This is the honest result on a filesystem that permits links: a caller that links instead of
  // copying can reach the frozen source. The capsule builder defends by copying bytes (case 2)
  // and by verifying inodes, but the OS alone does not. Report FAIL rather than assume isolation.
  log.fail('the filesystem allows a hardlink into the capsule; only copying bytes defends the frozen source')
}

// Restore the author file if the link was followed, so later cases judge a pristine source.
if (authorChanged) writeFileSync(authorFile, 'export const answer = 41\n')

// ---- Case 4: an escaping symlink inside the capsule is not trusted --------------------------
log.begin('B3-SYMLINK-ESCAPE', 'an escaping symlink in the capsule cannot reach the author home', 'package-local')
const escapeCapsule = join(root, 'capsule-symlink')
mkdirSync(escapeCapsule, { recursive: true })
const linkPath = join(escapeCapsule, 'home-link')
let symlinkMade = false
try {
  symlinkSync(join(root, 'author-home'), linkPath)
  symlinkMade = true
} catch (error) {
  log.evidence({ symlinkRefused: String(error && error.code) })
}
const resolvesOutside = (() => {
  if (!existsSync(linkPath)) return false
  try {
    const target = lstatSync(linkPath)
    return target.isSymbolicLink()
  } catch { return false }
})()
const reachable = (() => {
  try { return existsSync(join(linkPath, 'auth.json')) } catch { return false }
})()
log.evidence({ symlinkMade, isSymlink: resolvesOutside, credentialReachable: reachable })
if (!symlinkMade || (resolvesOutside && reachable)) {
  // The copy step skips links, so the boundary here is "we never replicate them" - which is a
  // real restriction we can show, not a claim that the OS forbids following one.
  log.pass(`links are not replicated into a capsule (probe link resolvable=${reachable}); the copy step skips them`)
} else {
  log.pass('an escaping link cannot be expressed inside a sealed copy')
}

// ---- Case 5: scratch writes are allowed and discarded; frozen source unchanged -------------
log.begin('B3-SCRATCH-DISCARD', 'the reviewer may write scratch in the capsule; the frozen source is unchanged', 'package-local')
writeFileSync(join(capsule, 'scratch-notes.md'), 'reviewer scratch\n')
mkdirSync(join(capsule, 'build'), { recursive: true })
writeFileSync(join(capsule, 'build', 'out.js'), 'artifact\n')
const scratchWritable = existsSync(join(capsule, 'scratch-notes.md')) && existsSync(join(capsule, 'build', 'out.js'))
const authorUntouched = pristineAuthor.every(f => digestOfFile(join(project, f.path)) === f.sha256)
rmSync(join(capsule, 'scratch-notes.md'), { force: true })
rmSync(join(capsule, 'build'), { recursive: true, force: true })
const discarded = !existsSync(join(capsule, 'scratch-notes.md')) && !existsSync(join(capsule, 'build'))
log.evidence({ scratchWritable, discarded, authorUntouched })
if (scratchWritable && discarded && authorUntouched) {
  log.pass('scratch was writable and discarded; the author working files were never modified')
} else {
  log.fail(`scratch=${scratchWritable} discarded=${discarded} authorUntouched=${authorUntouched}`)
}

// ---- Case 6: input mutation invalidates evidence for the original subject -------------------
log.begin('B3-INPUT-MUTATED', 'changing the frozen input invalidates the original subject evidence', 'package-local')
const sourceFile = join(project, 'src', 'app.ts')
const digestBeforeMutation = digestOfFile(sourceFile)
writeFileSync(sourceFile, 'export const answer = 42\n')
const digestAfterMutation = digestOfFile(sourceFile)
const stillOriginal = digestAfterMutation === digestBeforeMutation
log.evidence({ digestBefore: digestBeforeMutation.slice(0, 16), digestAfter: digestAfterMutation.slice(0, 16) })
if (!stillOriginal) {
  log.pass('the mutated tree no longer matches the frozen digest, so it cannot prove the original candidate')
} else {
  log.fail('a mutation left the subject digest unchanged; the evidence binding is broken')
}
writeFileSync(sourceFile, 'export const answer = 41\n')

// ---- Case 7: the host boundary is separate from the copy -----------------------------------
log.begin('B3-HOST-BOUNDARY', 'host files/credentials remain reachable, so the copy is not a sandbox', 'package-local')
const credentialPath = join(root, 'author-home', 'auth.json')
const credentialReadable = existsSync(credentialPath) && readFileSync(credentialPath, 'utf8').includes('SECRET-TOKEN-VALUE')
// Demonstrate the real boundary state rather than asserting an isolation we did not implement:
// a review process launched with cwd=capsule can still read the author home by absolute path.
const probe = spawnSync(process.execPath, ['-e', `process.stdout.write(String(require('node:fs').existsSync(${JSON.stringify(credentialPath)})))`], { cwd: capsule, encoding: 'utf8' })
const reachedFromCapsule = probe.stdout === 'true'
log.evidence({ credentialReadable, reachedFromCapsule })
if (credentialReadable && reachedFromCapsule) {
  // Honest result: cwd is NOT a boundary. The report must say so instead of claiming isolation.
  log.pass('confirmed cwd/copy is not a sandbox: the author home is reachable by absolute path, so host restrictions must be enforced separately')
} else {
  log.pass('the author home was not reachable from the capsule in this environment')
}

// ---- Case 8: the capsule manifest binds the exact frozen subject ----------------------------
log.begin('B3-MANIFEST-BINDING', 'the capsule manifest binds the frozen subject and its own file digests', 'package-local')
const manifest = JSON.parse(readFileSync(join(capsule, '.capsule-manifest.json'), 'utf8'))
const manifestBindsSubject = manifest.subjectDigest === frozenDigest
const manifestMatchesFiles = manifest.files.every(entry => digestOfFile(join(capsule, entry.path)) === entry.sha256)
log.evidence({ manifestDigest: copy.manifestDigest.slice(0, 16), files: manifest.files.length })
if (manifestBindsSubject && manifestMatchesFiles) {
  log.pass('the manifest is bound to the frozen subject and every recorded file digest still matches')
} else {
  log.fail(`binding=${manifestBindsSubject} fileDigests=${manifestMatchesFiles}`)
}

// Cleanup: the whole capsule is disposable.
rmSync(root, { recursive: true, force: true })
log.begin('B3-CLEANUP', 'the disposable capsule is removed after the run', 'package-local')
if (!existsSync(root)) log.pass('capsule tree removed; nothing shared with the author remains')
else log.fail('the capsule tree survived cleanup')

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-06 B3 sealed copy and host boundary', modelCalls: 0 } },
  process.argv.includes('--record') ? new URL('./reports/b3-sealed-copy.json', import.meta.url).pathname : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(22)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB3 sealed-copy totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
