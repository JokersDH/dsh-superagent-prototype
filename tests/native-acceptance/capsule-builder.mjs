/**
 * Sealed capsule builder with a hard rejection of link-based copies (wave-07 B3).
 *
 * Wave-06 measured 8 PASS / 1 FAIL: this filesystem permits `linkSync`, so a caller that hardlinks
 * instead of copying can modify the frozen source. Wave-07 fixes the *right* thing: the OS is not
 * required to forbid hardlinks - the production builder must simply never use them, and any request
 * to build a capsule by linking must be refused at admission rather than reported after the fact.
 *
 * So there are two distinct facts, and the tests keep them apart:
 *   - unsafe negative control: a deliberate hardlink builder CAN corrupt the author tree on this FS
 *   - safe production builder: copies bytes, shares no inode, and REFUSES a link mode
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sha256 = value => createHash('sha256').update(value).digest('hex')

/** Copy modes a caller may name. Only `bytes` produces a sealed copy. */
export const SAFE_COPY_MODES = Object.freeze(['bytes'])

/** Modes that would share the author's inodes or follow links out of the tree. */
export const UNSAFE_COPY_MODES = Object.freeze(['hardlink', 'link', 'reflink-shared-inode', 'symlink'])

/**
 * Is the requested copy mode unsafe?
 *
 * Returns a refusal message, or null when the mode is safe. An unspecified mode defaults to the
 * safe path: a caller that says nothing gets a byte copy, not a link.
 */
export function detectUnsafeLinkBuilder(request = {}) {
  const mode = request.mode
  if (mode === undefined || mode === null) return null
  if (typeof mode !== 'string') return `copyMode must be a string; got ${typeof mode}`
  if (UNSAFE_COPY_MODES.includes(mode)) {
    return `refusing copyMode "${mode}": a sealed copy must copy bytes and share no inode with the author tree`
  }
  if (!SAFE_COPY_MODES.includes(mode)) {
    return `refusing unknown copyMode "${mode}": only ${SAFE_COPY_MODES.join(', ')} produces a sealed copy`
  }
  return null
}

/**
 * Build a sealed capsule: a full tree copy with no Git surface, no links and no shared inodes.
 *
 * Links are never followed - a symlink could escape the tree, so it is skipped and recorded rather
 * than silently copied. The manifest binds the frozen subject so a later mutation is detectable.
 */
export function createSealedCapsule({ authorProject, capsuleRoot, subjectDigest, copyMode = 'bytes' }) {
  const refusal = detectUnsafeLinkBuilder({ mode: copyMode })
  if (refusal) throw new Error(refusal)
  if (!authorProject || !existsSync(authorProject)) throw new Error('authorProject must exist')
  const root = capsuleRoot
  mkdirSync(root, { recursive: true })
  const capsulePath = join(root, `capsule-${Date.now().toString(36)}`)
  mkdirSync(capsulePath, { recursive: true })

  const files = []
  const skippedLinks = []
  const walk = rel => {
    for (const entry of readdirSync(join(authorProject, rel), { withFileTypes: true })) {
      const childRel = rel ? join(rel, entry.name) : entry.name
      // The Git surface is never copied: it carries remotes, hooks and object identity.
      if (childRel === '.git' || childRel.startsWith('.git/')) continue
      const abs = join(authorProject, childRel)
      const stat = lstatSync(abs)
      if (stat.isSymbolicLink()) {
        skippedLinks.push(childRel)
        continue
      }
      if (stat.isDirectory()) {
        walk(childRel)
        continue
      }
      if (!stat.isFile()) continue
      const dest = join(capsulePath, childRel)
      mkdirSync(join(dest, '..'), { recursive: true })
      cpSync(abs, dest) // copies bytes; never links
      files.push({ path: childRel, sha256: sha256(readFileSync(dest)), ino: statSync(dest).ino })
    }
  }
  walk('')

  // Any file that still shares an inode with the author tree is a builder defect, not a warning.
  const sharedInodes = files.filter(file => {
    const source = join(authorProject, file.path)
    return existsSync(source) && statSync(source).ino === file.ino
  }).map(file => file.path)

  const gitEntries = []
  const scanForGit = rel => {
    for (const entry of readdirSync(join(capsulePath, rel), { withFileTypes: true })) {
      const childRel = rel ? join(rel, entry.name) : entry.name
      if (entry.name === '.git') {
        gitEntries.push(childRel)
        continue
      }
      if (entry.isDirectory()) scanForGit(childRel)
    }
  }
  scanForGit('')

  const manifestDigest = sha256(JSON.stringify(['sealed-copy/2', subjectDigest ?? null, files.map(file => [file.path, file.sha256])]))
  writeFileSync(
    join(capsulePath, '.capsule-manifest.json'),
    `${JSON.stringify({
      protocol: 'sealed-copy/2',
      subjectDigest: subjectDigest ?? null,
      manifestDigest,
      copyMode,
      skippedLinks,
      files: files.map(file => ({ path: file.path, sha256: file.sha256 })),
    }, null, 2)}\n`,
  )

  return { capsulePath, files, fileCount: files.length, manifestDigest, gitEntries, sharedInodes, skippedLinks }
}

/**
 * The deliberate unsafe builder, used ONLY as a negative control in tests.
 *
 * It hardlinks instead of copying, which on this filesystem lets a capsule write reach the author's
 * file. Its purpose is to prove the admission check is doing real work: replacing the production
 * builder with this one must be rejected.
 */
export function unsafeHardlinkCapsule({ authorProject, capsuleRoot }) {
  const capsulePath = join(capsuleRoot, `unsafe-${Date.now().toString(36)}`)
  mkdirSync(capsulePath, { recursive: true })
  const linked = []
  // Mirror the safe builder's recursion so the control reaches the same files (including src/).
  const walk = rel => {
    for (const entry of readdirSync(join(authorProject, rel), { withFileTypes: true })) {
      const childRel = rel ? join(rel, entry.name) : entry.name
      if (childRel === '.git' || childRel.startsWith('.git/')) continue
      const abs = join(authorProject, childRel)
      const stat = lstatSync(abs)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) { walk(childRel); continue }
      if (!stat.isFile()) continue
      const dest = join(capsulePath, childRel)
      mkdirSync(join(dest, '..'), { recursive: true })
      linkSync(abs, dest)
      linked.push(childRel)
    }
  }
  walk('')
  return { capsulePath, linked }
}
