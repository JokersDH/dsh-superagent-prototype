/**
 * Read-only preflight for one staged install: either a frozen `pa-install` tar.gz or an already
 * extracted install directory.
 *
 * The package's own structured manifests are the authority (`install.json` = pa-install/1,
 * `var/config/release.json` = pa-release/1). This module verifies the archive bytes against those
 * manifests and never invents a second identity: no directory name, tag or "looks similar" version
 * is accepted as identity, and no dependency is installed, no database is opened and no state is
 * migrated.
 *
 * Archive handling deliberately uses the platform `tar` (bsdtar/libarchive) rather than a bespoke
 * parser. libarchive refuses absolute/`..` members and extraction through symlinks; the caller also
 * validates the member listing before extraction, checks every extracted symlink stays inside the
 * new root, and extracts only into a brand-new private directory owned by this run.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, statfs } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { LIMITS } from './limits.mjs'
import { TrialKitError } from './output.mjs'

const FORBIDDEN_MATERIAL = /(?:^|\/)(?:api\.key|auth\.json|\.env|instance\.json|launcher\.json|start\.lock|native-sessions)(?:\/|$)/
const COMMIT = /^[a-f0-9]{40}$/
const BUILD_ID = /^[a-f0-9]{8,64}$/

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function sha256FileSync(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', rejectPromise)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}

function run(command, args, { timeout = LIMITS.commandTimeoutMs, maxBuffer = LIMITS.maxListingBytes } = {}) {
  const result = spawnSync(command, args, { encoding: 'buffer', timeout, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) {
    const code = result.error.code ?? 'spawn_failed'
    throw new TrialKitError(code === 'ETIMEDOUT' ? 'command_timeout' : 'command_failed', `${command} could not run`, { code })
  }
  return {
    status: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8').slice(0, 4000),
  }
}

function validateMember(name) {
  if (name.length === 0) return 'empty'
  if (name.length > LIMITS.maxPathLength) return 'path_too_long'
  if (name.startsWith('/')) return 'absolute'
  if (name.includes('\\')) return 'backslash'
  const segments = name.split('/')
  if (segments.some((segment) => segment === '..')) return 'parent_reference'
  if (segments.some((segment) => segment.length === 0)) return 'empty_segment'
  if (segments.some((segment) => segment.length > LIMITS.maxPathComponent)) return 'component_too_long'
  return null
}

/** List archive members without extracting anything. Refuses absolute/`..`/duplicate/overlong names. */
function listArchive(tarPath) {
  const listing = run('tar', ['-tzf', tarPath])
  if (listing.status !== 0) throw new TrialKitError('archive_listing_failed', 'tar could not list the archive', { stderr: listing.stderr })
  const raw = listing.stdout.toString('utf8')
  if (raw.length > LIMITS.maxListingBytes) throw new TrialKitError('archive_limit_exceeded', 'Archive listing exceeds the report budget')
  const lines = raw.split('\n').filter((line) => line.length > 0)
  if (lines.length === 0) throw new TrialKitError('archive_empty', 'Archive has no members')
  if (lines.length > LIMITS.maxEntries) throw new TrialKitError('archive_limit_exceeded', 'Archive has too many members', { entries: lines.length })
  const entries = []
  const seen = new Set()
  for (const line of lines) {
    const name = line.replace(/\/+$/, '')
    const issue = validateMember(name)
    if (issue !== null) throw new TrialKitError('archive_unsafe_path', 'Archive member path is refused', { path: name.slice(0, 200), issue })
    if (seen.has(name)) throw new TrialKitError('archive_duplicate_entry', 'Archive has a duplicate member', { path: name.slice(0, 200) })
    seen.add(name)
    entries.push({ path: name, directory: line.endsWith('/') })
  }
  return entries
}

function readMember(tarPath, memberPath) {
  const result = run('tar', ['-xzOf', tarPath, memberPath], { maxBuffer: LIMITS.maxManifestBytes })
  if (result.status !== 0) throw new TrialKitError('archive_member_unreadable', 'Archive member cannot be read', { path: memberPath, stderr: result.stderr })
  if (result.stdout.byteLength > LIMITS.maxManifestBytes) throw new TrialKitError('archive_limit_exceeded', 'Archive member exceeds the manifest budget', { path: memberPath })
  return result.stdout
}

function parseJsonMember(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new TrialKitError('manifest_invalid', `${label} is not valid JSON`, { cause: String(error?.message ?? error).slice(0, 200) })
  }
}

async function walk(root) {
  const files = []
  const symlinks = []
  const directories = []
  const other = []
  let visit
  let visited = 0
  visit = async (absolute, rel) => {
    const entries = await readdir(absolute, { withFileTypes: true })
    for (const entry of entries) {
      visited += 1
      if (visited > LIMITS.maxFilesVerified) throw new TrialKitError('tree_limit_exceeded', 'Extracted tree exceeds the entry budget')
      const childAbsolute = join(absolute, entry.name)
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      const info = lstatSync(childAbsolute)
      if (info.isDirectory()) {
        directories.push(childRel)
        await visit(childAbsolute, childRel)
      } else if (info.isFile()) {
        files.push({ path: childRel, bytes: info.size, mtimeMs: info.mtimeMs, mode: info.mode & 0o777 })
      } else if (info.isSymbolicLink()) {
        symlinks.push({ path: childRel, mtimeMs: info.mtimeMs })
      } else {
        other.push(childRel)
      }
    }
  }
  await visit(root, '')
  return { files, symlinks, directories, other }
}

function safeInside(root, candidate) {
  const rel = relative(root, candidate)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

function manifestIdentity(install) {
  const issues = []
  if (install?.format !== 'pa-install') issues.push('format')
  if (install?.formatVersion !== 1) issues.push('formatVersion')
  if (!COMMIT.test(String(install?.source?.commit ?? ''))) issues.push('source.commit')
  if (typeof install?.source?.dirty !== 'boolean') issues.push('source.dirty')
  if (!BUILD_ID.test(String(install?.buildId ?? ''))) issues.push('buildId')
  if (install?.producer?.product !== 'dsh-superagent') issues.push('producer.product')
  if (typeof install?.producer?.version !== 'string' || install.producer.version.length === 0) issues.push('producer.version')
  if (!Number.isSafeInteger(install?.producer?.productSchema) || install.producer.productSchema <= 0) issues.push('producer.productSchema')
  if (typeof install?.producer?.platform !== 'string' || install.producer.platform.length === 0) issues.push('producer.platform')
  if (typeof install?.producer?.arch !== 'string' || install.producer.arch.length === 0) issues.push('producer.arch')
  if (!/^\d+$/.test(String(install?.producer?.abi ?? ''))) issues.push('producer.abi')
  if (typeof install?.appRoot !== 'string' || install.appRoot.length === 0) issues.push('appRoot')
  if (!Array.isArray(install?.files) || install.files.length === 0) issues.push('files')
  if (!Array.isArray(install?.dependencies)) issues.push('dependencies')
  if (!install?.entrypoints || typeof install.entrypoints !== 'object' || Array.isArray(install.entrypoints)) issues.push('entrypoints')
  else if (Object.values(install.entrypoints).some((value) => typeof value !== 'string' || value.length === 0)) issues.push('entrypoints.values')
  if (!install?.supportMatrix || typeof install.supportMatrix !== 'object') issues.push('supportMatrix')
  return issues
}

function releaseIdentity(release) {
  const issues = []
  if (release?.format !== 'pa-release') issues.push('format')
  if (release?.formatVersion !== 1) issues.push('formatVersion')
  if (!BUILD_ID.test(String(release?.buildId ?? ''))) issues.push('buildId')
  if (!Array.isArray(release?.artifacts)) issues.push('artifacts')
  if (!Array.isArray(release?.dependencies)) issues.push('dependencies')
  if (!release?.build || typeof release.build !== 'object') issues.push('build')
  return issues
}

function closureDigestOf(files) {
  const lines = files
    .filter((entry) => entry.kind === 'file')
    .map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`)
  return sha256(lines.join('\n'))
}

function parseNodeRange(range) {
  const match = /^>=(\d+)\.(\d+)\.(\d+)\s+<(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(range ?? '').trim())
  if (!match) return null
  return { min: [Number(match[1]), Number(match[2]), Number(match[3])], maxMajor: Number(match[4]) }
}

function satisfiesNode(version, parsed) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return null
  const current = [Number(match[1]), Number(match[2]), Number(match[3])]
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== parsed.min[index]) return current[index] > parsed.min[index]
  }
  return current[0] < parsed.maxMajor
}

function compareFileToRecord(absolute, record) {
  let info
  try { info = lstatSync(absolute) } catch { return { ok: false, reason: 'missing' } }
  if (!info.isFile() || info.isSymbolicLink()) return { ok: false, reason: 'not_a_regular_file' }
  if (info.size !== record.bytes) return { ok: false, reason: 'size_mismatch', expected: record.bytes, observed: info.size }
  return { ok: true, record }
}

/**
 * Inspect one package. `input` is `{ kind: 'tar', tarPath, artifactPath?, out, keepExtract }` or
 * `{ kind: 'install', installPath, out }`. Returns a complete report plus the exit code.
 */
export async function preflight(input) {
  const checks = []
  const unknowns = []
  const observed = {}
  const method = { commands: [], limits: { ...LIMITS }, extraction: null }

  const record = (status, id, detail) => checks.push(detail === undefined ? { id, status } : { id, status, detail })

  let installRoot
  let rootPrefix = ''
  let extractRoot = null
  let tarBefore = null
  let tarAfter = null
  let installSnapshot = null
  let installManifestBytes = null
  let releaseManifestBytes = null

  if (input.kind === 'tar') {
    const tarPath = resolve(input.tarPath)
    let info
    try { info = statSync(tarPath) } catch { throw new TrialKitError('input_missing', 'Tar input does not exist', { path: tarPath }) }
    if (!info.isFile()) throw new TrialKitError('input_invalid', 'Tar input is not a regular file', { path: tarPath })
    if (info.size === 0) throw new TrialKitError('input_invalid', 'Tar input is empty', { path: tarPath })
    if (info.size > LIMITS.maxArchiveBytes) throw new TrialKitError('input_too_large', 'Tar input exceeds the archive budget', { bytes: info.size })
    tarBefore = { bytes: info.size, mtimeMs: info.mtimeMs, sha256: await sha256FileSync(tarPath) }
    observed.archiveBytes = tarBefore.bytes
    observed.archiveSha256 = tarBefore.sha256
    record('PASS', 'input_readable', { kind: 'tar', bytes: info.size })

    let members
    try {
      members = listArchive(tarPath)
      record('PASS', 'archive_listing', { members: members.length, directories: members.filter((m) => m.directory).length })
      record('PASS', 'archive_paths', { checked: members.length })
      record('PASS', 'archive_limits', { members: members.length, maxEntries: LIMITS.maxEntries, bytes: info.size })
    } catch (error) {
      record('FAIL', 'archive_listing', { code: error.code ?? 'unknown', message: error.message, detail: error.detail })
      return finish({ checks, unknowns, observed, method, input, record })
    }

    const manifestMembers = members.filter((member) => !member.directory && /(?:^|\/)install\.json$/.test(member.path))
    if (manifestMembers.length !== 1) {
      record('FAIL', 'install_manifest_present', { candidates: manifestMembers.map((m) => m.path).slice(0, 5) })
      return finish({ checks, unknowns, observed, method, input, record })
    }
    const manifestMember = manifestMembers[0].path
    rootPrefix = manifestMember.slice(0, manifestMember.length - 'install.json'.length).replace(/\/$/, '')
    installManifestBytes = readMember(tarPath, manifestMember)
    observed.installManifestSha256 = sha256(installManifestBytes)
    let install
    try {
      install = parseJsonMember(installManifestBytes, 'install.json')
    } catch (error) {
      record('FAIL', 'install_manifest_format', { code: error.code ?? 'invalid', message: error.message })
      return finish({ checks, unknowns, observed, method, input, record })
    }
    record('PASS', 'install_manifest_present', { path: manifestMember })

    const outsidePrefix = members.filter((member) => rootPrefix.length > 0 && member.path !== rootPrefix && !member.path.startsWith(`${rootPrefix}/`))
    const unsafeManifest = manifestIdentity(install)
    record(unsafeManifest.length === 0 ? 'PASS' : 'FAIL', 'install_manifest_format', unsafeManifest.length === 0 ? { format: install.format, formatVersion: install.formatVersion } : { issues: unsafeManifest })
    if (unsafeManifest.length > 0) return finish({ checks, unknowns, observed, method, input, record })

    const releaseMember = `${rootPrefix ? `${rootPrefix}/` : ''}var/config/release.json`
    let release = null
    try {
      releaseManifestBytes = readMember(tarPath, releaseMember)
      observed.releaseManifestSha256 = sha256(releaseManifestBytes)
      release = parseJsonMember(releaseManifestBytes, 'release.json')
      const issues = releaseIdentity(release)
      record(issues.length === 0 ? 'PASS' : 'FAIL', 'release_manifest_format', issues.length === 0 ? { format: release.format, formatVersion: release.formatVersion } : { issues })
    } catch (error) {
      record('FAIL', 'release_manifest_present', { path: releaseMember, code: error.code, message: error.message })
    }
    if (outsidePrefix.length > 0) record('FAIL', 'archive_members_scoped', { outsidePrefix: outsidePrefix.slice(0, 5).map((m) => m.path.slice(0, 160)), count: outsidePrefix.length })

    // Extract into a brand-new private directory inside the caller's own output root only.
    const extractionDir = join(input.out, 'extract')
    try {
      await mkdir(extractionDir, { recursive: false, mode: 0o700 })
    } catch (error) {
      record('FAIL', 'archive_extract', { reason: 'extract_root_unavailable', cause: String(error?.code ?? error) })
      return finish({ checks, unknowns, observed, method, input, record })
    }
    // Bound the decompression budget before writing anything: a hostile archive may still be refused
    // after extraction, but it must first fit in this machine's free space.
    try {
      const free = await statfs(extractionDir)
      const freeBytes = free.bavail * free.bsize
      const required = Math.min(tarBefore.bytes * 8, LIMITS.maxTotalVerifiedBytes) + LIMITS.minFreeBytes
      if (freeBytes < required) {
        record('FAIL', 'archive_extract', { reason: 'insufficient_free_space', freeBytes, requiredBytes: required })
        return finish({ checks, unknowns, observed, method, input, record })
      }
    } catch { /* statfs unavailable: the extraction still enforces member/path bounds */ }
    const extraction = run('tar', ['-xzf', tarPath, '-C', extractionDir])
    if (extraction.status !== 0) {
      record('FAIL', 'archive_extract', { reason: 'tar_refused', stderr: extraction.stderr.slice(0, 1200) })
      return finish({ checks, unknowns, observed, method, input, record })
    }
    extractRoot = extractionDir
    installRoot = rootPrefix.length > 0 ? join(extractionDir, rootPrefix) : extractionDir
    method.commands.push({ command: 'tar', arguments: ['-tzf', '<input>'], exit: 0 }, { command: 'tar', arguments: ['-xzf', '<input>', '-C', '<out>/extract'], exit: 0 })
    method.extraction = { root: 'extract', prefix: rootPrefix, retained: input.keepExtract === true }
    record('PASS', 'archive_extract', { prefix: rootPrefix, retained: input.keepExtract === true })

    const report = await verifyTree({ install, release, installRoot, record, observed, unknowns })
    if (report && report.fatal) return finish({ checks, unknowns, observed, method, input, record })
  } else {
    const installPath = resolve(input.installPath)
    let info
    try { info = statSync(installPath) } catch { throw new TrialKitError('input_missing', 'Install directory does not exist', { path: installPath }) }
    if (!info.isDirectory()) throw new TrialKitError('input_invalid', 'Install input is not a directory', { path: installPath })
    installRoot = installPath
    record('PASS', 'input_readable', { kind: 'install' })
    let install
    try {
      installManifestBytes = await readFile(join(installRoot, 'install.json'))
      observed.installManifestSha256 = sha256(installManifestBytes)
    } catch (error) {
      record('FAIL', 'install_manifest_present', { path: 'install.json', code: error?.code ?? 'invalid', message: String(error?.message ?? error).slice(0, 200) })
      return finish({ checks, unknowns, observed, method, input, record })
    }
    try {
      install = JSON.parse(installManifestBytes.toString('utf8'))
    } catch (error) {
      record('FAIL', 'install_manifest_format', { code: 'invalid_json', message: String(error?.message ?? error).slice(0, 200) })
      return finish({ checks, unknowns, observed, method, input, record })
    }
    const issues = manifestIdentity(install)
    record(issues.length === 0 ? 'PASS' : 'FAIL', 'install_manifest_format', issues.length === 0 ? { format: install.format, formatVersion: install.formatVersion } : { issues })
    if (issues.length > 0) return finish({ checks, unknowns, observed, method, input, record })
    record('PASS', 'archive_listing', { members: install.files.length, skipped: 'install-input' })
    record('PASS', 'archive_paths', { checked: install.files.length })
    record('PASS', 'archive_limits', { members: install.files.length })
    record('PASS', 'archive_extract', { skipped: 'install-input' })
    let release = null
    try {
      releaseManifestBytes = await readFile(join(installRoot, 'var/config/release.json'))
      observed.releaseManifestSha256 = sha256(releaseManifestBytes)
      release = JSON.parse(releaseManifestBytes.toString('utf8'))
      const releaseIssues = releaseIdentity(release)
      record(releaseIssues.length === 0 ? 'PASS' : 'FAIL', 'release_manifest_format', releaseIssues.length === 0 ? { format: release.format } : { issues: releaseIssues })
    } catch (error) {
      record('FAIL', 'release_manifest_present', { path: 'var/config/release.json', code: error?.code ?? 'invalid' })
    }
    installSnapshot = await snapshotTree(installRoot, null)
    await verifyTree({ install, release, installRoot, record, observed, unknowns })
  }

  // Input immutability: preflight must never modify the package it inspects.
  if (input.kind === 'tar') {
    const after = statSync(resolve(input.tarPath))
    tarAfter = { bytes: after.size, mtimeMs: after.mtimeMs, sha256: await sha256FileSync(resolve(input.tarPath)) }
    const unchanged = tarAfter.sha256 === tarBefore.sha256 && tarAfter.bytes === tarBefore.bytes
    record(unchanged ? 'PASS' : 'FAIL', 'input_immutability', { before: { bytes: tarBefore.bytes, sha256: tarBefore.sha256 }, after: { bytes: tarAfter.bytes, sha256: tarAfter.sha256 } })
  } else {
    const after = await snapshotTree(installRoot, null)
    const changed = []
    for (const [path, recordBefore] of Object.entries(installSnapshot ?? {})) {
      const recordAfter = after[path]
      if (!recordAfter || recordAfter.bytes !== recordBefore.bytes || recordAfter.mtimeMs !== recordBefore.mtimeMs) changed.push(path)
    }
    const added = Object.keys(after).filter((path) => installSnapshot?.[path] === undefined)
    record(changed.length === 0 && added.length === 0 ? 'PASS' : 'FAIL', 'input_immutability', { changed: changed.slice(0, 10), added: added.slice(0, 10) })
  }

  // Expected tuple assertions (all optional; absence is not a pass).
  const expectations = input.expectations ?? {}
  const expectationChecks = []
  if (expectations.sha256 !== undefined) {
    const actual = input.kind === 'tar' ? observed.archiveSha256 : observed.closureDigest
    expectationChecks.push({ field: 'sha256', expected: expectations.sha256, actual: actual ?? null, ok: actual === expectations.sha256 })
  }
  if (expectations.schema !== undefined) expectationChecks.push({ field: 'schema', expected: expectations.schema, actual: observed.productSchema ?? null, ok: observed.productSchema === expectations.schema })
  if (expectations.build !== undefined) expectationChecks.push({ field: 'build', expected: expectations.build, actual: observed.buildId ?? null, ok: observed.buildId === expectations.build })
  if (expectations.source !== undefined) expectationChecks.push({ field: 'source', expected: expectations.source, actual: observed.sourceCommit ?? null, ok: observed.sourceCommit === expectations.source })
  if (expectationChecks.length > 0) {
    const failed = expectationChecks.filter((entry) => !entry.ok)
    record(failed.length === 0 ? 'PASS' : 'FAIL', 'expected_tuple', { comparisons: expectationChecks })
  } else {
    record('UNKNOWN', 'expected_tuple', { reason: 'not_requested', note: 'Pass --expect-sha256/--expect-schema/--expect-build/--expect-source to bind this report to a published tuple' })
    unknowns.push('expected_tuple')
  }

  // Cleanup only our own extraction directory.
  if (input.kind === 'tar' && extractRoot !== null && input.keepExtract !== true) {
    await rm(extractRoot, { recursive: true, force: false })
    record(lstatSafe(extractRoot) === null ? 'PASS' : 'FAIL', 'extraction_cleanup', { removed: extractRoot === null ? null : 'extract' })
  }

  return finish({ checks, unknowns, observed, method, input, record })
}

function lstatSafe(path) {
  try { return lstatSync(path) } catch { return null }
}

async function snapshotTree(root, listed) {
  const entries = listed ?? []
  const result = {}
  const recordOne = (rel) => {
    const info = lstatSync(join(root, rel))
    result[rel] = { bytes: info.isFile() ? info.size : null, mtimeMs: info.mtimeMs }
  }
  if (entries.length > 0) {
    for (const entry of entries) recordOne(entry.path)
    return result
  }
  const walkRoot = async (absolute, rel) => {
    for (const name of await readdir(absolute)) {
      const childAbsolute = join(absolute, name)
      const childRel = rel === '' ? name : `${rel}/${name}`
      const info = lstatSync(childAbsolute)
      result[childRel] = { bytes: info.isFile() ? info.size : null, mtimeMs: info.mtimeMs }
      if (info.isDirectory()) await walkRoot(childAbsolute, childRel)
    }
  }
  await walkRoot(root, '')
  return result
}

async function verifyTree({ install, release, installRoot, record, observed, unknowns }) {
  const files = install.files
  const declaredFiles = files.filter((entry) => entry.kind === 'file')
  const declaredLinks = files.filter((entry) => entry.kind === 'symlink')
  const undeclaredKinds = files.filter((entry) => !['file', 'symlink'].includes(entry.kind))
  const unsafeDeclared = files.filter((entry) => validateMember(entry.path) !== null)
  const forbidden = files.filter((entry) => FORBIDDEN_MATERIAL.test(entry.path))

  record(undeclaredKinds.length === 0 ? 'PASS' : 'FAIL', 'manifest_file_kinds', undeclaredKinds.length === 0 ? { files: declaredFiles.length, symlinks: declaredLinks.length } : { kinds: [...new Set(undeclaredKinds.map((e) => e.kind))] })
  record(unsafeDeclared.length === 0 ? 'PASS' : 'FAIL', 'manifest_paths', unsafeDeclared.length === 0 ? { checked: files.length } : { unsafe: unsafeDeclared.slice(0, 5) })
  record(forbidden.length === 0 ? 'PASS' : 'FAIL', 'forbidden_material', forbidden.length === 0 ? { checked: files.length } : { paths: forbidden.slice(0, 5).map((entry) => entry.path) })

  const tree = await walk(installRoot)
  if (tree.other.length > 0) record('FAIL', 'tree_entry_types', { unsupported: tree.other.slice(0, 5) })

  // The install manifest cannot list itself; that single file is the only permitted undeclared entry.
  const allowedUndeclared = new Set(['install.json'])
  const declaredSet = new Set(files.map((entry) => entry.path))
  const actualEntries = [...tree.files.map((entry) => entry.path), ...tree.symlinks.map((entry) => entry.path)]
  const undeclared = actualEntries.filter((path) => !declaredSet.has(path) && !allowedUndeclared.has(path))
  record(undeclared.length === 0 ? 'PASS' : 'FAIL', 'unlisted_entries', { count: undeclared.length, sample: undeclared.slice(0, 10) })

  const digestByPath = new Map()
  let verifiedBytes = 0
  const mismatches = []
  for (const entry of declaredFiles) {
    const absolute = join(installRoot, entry.path)
    const comparison = compareFileToRecord(absolute, entry)
    if (!comparison.ok) {
      mismatches.push({ path: entry.path, ...comparison })
      continue
    }
    const digest = await sha256FileSync(absolute)
    digestByPath.set(entry.path, { sha256: digest, bytes: entry.bytes })
    verifiedBytes += entry.bytes
    if (verifiedBytes > LIMITS.maxTotalVerifiedBytes) throw new TrialKitError('tree_limit_exceeded', 'Verified bytes exceed the budget')
    if (digest !== entry.sha256) mismatches.push({ path: entry.path, reason: 'digest_mismatch', expected: entry.sha256, observed: digest })
  }
  record(mismatches.length === 0 ? 'PASS' : 'FAIL', 'file_digests', { verified: declaredFiles.length, mismatches: mismatches.slice(0, 10), mismatchCount: mismatches.length })

  const linkFailures = []
  const { readlinkSync } = await import('node:fs')
  for (const entry of declaredLinks) {
    const absolute = join(installRoot, entry.path)
    let info
    try { info = lstatSync(absolute) } catch { linkFailures.push({ path: entry.path, reason: 'missing' }); continue }
    if (!info.isSymbolicLink()) { linkFailures.push({ path: entry.path, reason: 'not_a_symlink' }); continue }
    const actualTarget = readlinkSync(absolute)
    if (actualTarget !== entry.target) { linkFailures.push({ path: entry.path, reason: 'target_mismatch', expected: entry.target, observed: actualTarget }); continue }
    if (isAbsolute(actualTarget)) { linkFailures.push({ path: entry.path, reason: 'absolute_target' }); continue }
    const resolvedTarget = resolve(join(installRoot, entry.path, '..'), actualTarget)
    if (!safeInside(installRoot, resolvedTarget)) { linkFailures.push({ path: entry.path, reason: 'external_target', target: actualTarget }); continue }
    if (lstatSafe(resolvedTarget) === null) linkFailures.push({ path: entry.path, reason: 'dangling_target', target: actualTarget })
  }
  record(linkFailures.length === 0 ? 'PASS' : 'FAIL', 'symlink_closure', { verified: declaredLinks.length, failures: linkFailures.slice(0, 10), failureCount: linkFailures.length })

  // Publish the recomputed identity exactly like the freezer did.
  const closureDigest = closureDigestOf(files)
  observed.closureDigest = closureDigest
  observed.fileCounts = { declared: files.length, files: declaredFiles.length, symlinks: declaredLinks.length, directories: tree.directories.length }
  observed.verifiedFileBytes = verifiedBytes
  const actualFileBytes = tree.files.reduce((sum, entry) => sum + entry.bytes, 0)
  const declaredFileBytes = declaredFiles.reduce((sum, entry) => sum + entry.bytes, 0)
  record(actualFileBytes <= declaredFileBytes + LIMITS.diskHeadroomBytes ? 'PASS' : 'FAIL', 'extraction_budget', { actualFileBytes, declaredFileBytes })
  observed.maxPathLength = files.reduce((max, entry) => Math.max(max, entry.path.length), 0)
  observed.buildId = install.buildId
  observed.sourceCommit = install.source?.commit ?? null
  observed.sourceDirty = install.source?.dirty ?? null
  observed.productSchema = install.producer?.productSchema ?? null
  observed.producer = { ...install.producer }
  observed.supportMatrix = { ...install.supportMatrix }
  observed.dependencies = install.dependencies.map((dependency) => ({ name: dependency.name, version: dependency.version, digest: dependency.digest ?? null }))
  observed.workspacePackages = Array.isArray(install.workspacePackages) ? install.workspacePackages.map((entry) => ({ name: entry.name, path: entry.path })) : []

  record('PASS', 'closure_digest', { computed: closureDigest })

  // Entry points and launcher.
  const entrypoints = install.entrypoints ?? {}
  const missingEntrypoints = Object.entries(entrypoints).filter(([, path]) => lstatSafe(join(installRoot, path)) === null)
  record(missingEntrypoints.length === 0 ? 'PASS' : 'FAIL', 'entrypoints', missingEntrypoints.length === 0 ? { checked: Object.keys(entrypoints).length } : { missing: missingEntrypoints })
  const launcherPath = join(installRoot, install.entry ?? '')
  const launcherInfo = install.entry === undefined ? null : lstatSafe(launcherPath)
  const launcherOk = launcherInfo !== null && launcherInfo.isFile() && (launcherInfo.mode & 0o111) !== 0
  record(install.entry === undefined ? 'FAIL' : launcherOk ? 'PASS' : 'FAIL', 'launcher', { entry: install.entry ?? null, executable: launcherOk })

  // External dependency closure: version and license presence, no install performed.
  const dependencyFailures = []
  const appRoot = install.appRoot ?? 'app'
  for (const dependency of install.dependencies) {
    const packageJson = join(installRoot, appRoot, 'node_modules', dependency.name, 'package.json')
    let manifest
    try { manifest = JSON.parse(await readFile(packageJson, 'utf8')) } catch { dependencyFailures.push({ name: dependency.name, reason: 'unreadable' }); continue }
    if (manifest.version !== dependency.version) { dependencyFailures.push({ name: dependency.name, reason: 'version_mismatch', expected: dependency.version, observed: manifest.version }); continue }
    for (const license of dependency.licenseFiles ?? []) {
      if (lstatSafe(join(installRoot, appRoot, 'node_modules', dependency.name, license)) === null) dependencyFailures.push({ name: dependency.name, reason: 'license_missing', license })
    }
  }
  record(dependencyFailures.length === 0 ? 'PASS' : 'FAIL', 'external_dependencies', { checked: install.dependencies.length, failures: dependencyFailures })

  const workspaceFailures = []
  for (const entry of install.workspacePackages ?? []) {
    const packageJson = join(installRoot, entry.path, 'package.json')
    let manifest
    try { manifest = JSON.parse(await readFile(packageJson, 'utf8')) } catch { workspaceFailures.push({ name: entry.name, reason: 'unreadable' }); continue }
    if (manifest.name !== entry.name) workspaceFailures.push({ name: entry.name, reason: 'name_mismatch', observed: manifest.name })
  }
  record(workspaceFailures.length === 0 ? 'PASS' : 'FAIL', 'workspace_packages', { checked: (install.workspacePackages ?? []).length, failures: workspaceFailures })

  // Release manifest consistency: identity, console stamp, recorded artifact bytes.
  if (release !== null) {
    const identityMismatch = []
    for (const field of ['buildId']) if (release[field] !== install[field]) identityMismatch.push(field)
    for (const field of ['product', 'version', 'productSchema', 'platform', 'arch']) if (release.producer?.[field] !== install.producer?.[field]) identityMismatch.push(`producer.${field}`)
    record(identityMismatch.length === 0 ? 'PASS' : 'FAIL', 'release_identity', { mismatches: identityMismatch })

    const stampPath = join(installRoot, appRoot, release.build?.consoleRoot ?? '', '.pa-console-build.json')
    let stampOk = false
    let stampDetail = { path: '.pa-console-build.json' }
    try {
      const stamp = JSON.parse(await readFile(stampPath, 'utf8'))
      stampOk = stamp.protocol === 'personal-console-build/1' && stamp.mode === 'http' && stamp.digest === release.build?.consoleDigest
      stampDetail = { protocol: stamp.protocol ?? null, mode: stamp.mode ?? null, digestMatches: stamp.digest === release.build?.consoleDigest }
    } catch (error) {
      stampDetail = { reason: 'stamp_unreadable', code: error?.code ?? 'invalid' }
    }
    record(stampOk ? 'PASS' : 'FAIL', 'console_stamp', stampDetail)

    const artifactFailures = []
    let checkedArtifacts = 0
    for (const artifact of release.artifacts) {
      const rel = `${appRoot}/${artifact.path}`
      if (validateMember(rel) !== null) { artifactFailures.push({ path: artifact.path, reason: 'unsafe_path' }); continue }
      const known = digestByPath.get(rel)
      if (known === undefined) {
        const info = lstatSafe(join(installRoot, rel))
        if (info === null || !info.isFile()) artifactFailures.push({ path: artifact.path, reason: 'missing' })
        else if (info.size !== artifact.bytes) artifactFailures.push({ path: artifact.path, reason: 'size_mismatch' })
        else {
          const digest = await sha256FileSync(join(installRoot, rel))
          if (digest !== artifact.sha256) artifactFailures.push({ path: artifact.path, reason: 'digest_mismatch' })
          else checkedArtifacts += 1
        }
        continue
      }
      if (known.bytes !== artifact.bytes || known.sha256 !== artifact.sha256) artifactFailures.push({ path: artifact.path, reason: 'digest_mismatch' })
      else checkedArtifacts += 1
    }
    record(artifactFailures.length === 0 ? 'PASS' : 'FAIL', 'release_artifacts', { checked: checkedArtifacts, failures: artifactFailures.slice(0, 10), failureCount: artifactFailures.length })
  } else {
    record('FAIL', 'release_identity', { reason: 'release_manifest_missing' })
    record('FAIL', 'console_stamp', { reason: 'release_manifest_missing' })
    record('FAIL', 'release_artifacts', { reason: 'release_manifest_missing' })
  }

  // Host compatibility: report only; never upgrade an unmeasured combination to "compatible".
  const host = { platform: process.platform, arch: process.arch, node: process.versions.node, abi: process.versions.modules, sqlite: null }
  const platformOk = install.producer.platform === host.platform && install.producer.arch === host.arch
  record(platformOk ? 'PASS' : 'WARN', 'host_platform', { observed: { platform: host.platform, arch: host.arch }, producer: { platform: install.producer.platform, arch: install.producer.arch } })
  const parsedRange = parseNodeRange(install.supportMatrix?.node)
  const nodeOk = parsedRange === null ? null : satisfiesNode(host.node, parsedRange)
  record(nodeOk === true ? 'PASS' : nodeOk === false ? 'WARN' : 'UNKNOWN', 'host_node', { observed: host.node, supportMatrix: install.supportMatrix?.node ?? null })
  if (nodeOk === null) unknowns.push('host_node')
  const abiOk = String(install.producer.abi) === String(host.abi)
  record(abiOk ? 'PASS' : 'WARN', 'host_abi', { observed: host.abi, producer: install.producer.abi, supportMatrix: install.supportMatrix?.abi ?? null })
  record('UNKNOWN', 'host_sqlite', { reason: 'requires_executing_native_binding', owner: 'package doctor verifies SQLite at runtime' })
  unknowns.push('host_sqlite')

  const maxPath = observed.maxPathLength
  record(maxPath <= LIMITS.maxPathLength ? 'PASS' : 'FAIL', 'path_lengths', { maxMemberPath: maxPath, limit: LIMITS.maxPathLength })

  const totalNeeded = declaredFiles.reduce((sum, entry) => sum + entry.bytes, 0)
  try {
    const free = await statfs(join(installRoot, '..'))
    const freeBytes = free.bavail * free.bsize
    const needed = Math.ceil(totalNeeded * 1.2) + LIMITS.diskHeadroomBytes
    record(freeBytes >= needed ? 'PASS' : 'FAIL', 'disk_space', { freeBytes, neededBytes: needed })
  } catch (error) {
    record('UNKNOWN', 'disk_space', { reason: 'statfs_failed', code: error?.code ?? 'unknown' })
    unknowns.push('disk_space')
  }
  return { fatal: false }
}

function finish({ checks, unknowns, observed, method, input, record }) {
  // Artifact-manifest binding is checked here so both input modes share it.
  const artifact = input.artifact
  if (artifact !== undefined) {
    const comparisons = []
    if (artifact?.digests?.tarSha256 !== undefined && observed.archiveSha256 !== undefined)
      comparisons.push({ field: 'tarSha256', expected: artifact.digests.tarSha256, observed: observed.archiveSha256, ok: artifact.digests.tarSha256 === observed.archiveSha256 })
    if (artifact?.digests?.tarBytes !== undefined && observed.archiveBytes !== undefined)
      comparisons.push({ field: 'tarBytes', expected: artifact.digests.tarBytes, observed: observed.archiveBytes, ok: artifact.digests.tarBytes === observed.archiveBytes })
    if (artifact?.digests?.closureDigest !== undefined && observed.closureDigest !== undefined)
      comparisons.push({ field: 'closureDigest', expected: artifact.digests.closureDigest, observed: observed.closureDigest, ok: artifact.digests.closureDigest === observed.closureDigest })
    if (artifact?.digests?.installManifestSha256 !== undefined && observed.installManifestSha256 !== undefined)
      comparisons.push({ field: 'installManifestSha256', expected: artifact.digests.installManifestSha256, observed: observed.installManifestSha256, ok: artifact.digests.installManifestSha256 === observed.installManifestSha256 })
    if (artifact?.digests?.releaseManifestSha256 !== undefined && observed.releaseManifestSha256 !== undefined)
      comparisons.push({ field: 'releaseManifestSha256', expected: artifact.digests.releaseManifestSha256, observed: observed.releaseManifestSha256, ok: artifact.digests.releaseManifestSha256 === observed.releaseManifestSha256 })
    for (const field of ['buildId', 'schema']) {
      const expected = field === 'buildId' ? artifact?.buildId : artifact?.producer?.productSchema
      const actual = field === 'buildId' ? observed.buildId : observed.productSchema
      if (expected !== undefined && actual !== undefined) comparisons.push({ field, expected, observed: actual, ok: expected === actual })
    }
    if (artifact?.source?.commit !== undefined && observed.sourceCommit !== undefined)
      comparisons.push({ field: 'source.commit', expected: artifact.source.commit, observed: observed.sourceCommit, ok: artifact.source.commit === observed.sourceCommit })
    const failed = comparisons.filter((entry) => !entry.ok)
    record(failed.length === 0 && comparisons.length > 0 ? 'PASS' : comparisons.length === 0 ? 'UNKNOWN' : 'FAIL', 'artifact_manifest', comparisons.length === 0 ? { reason: 'no_comparable_fields' } : { comparisons })
    if (failed.length > 0) unknowns.push('artifact_manifest_mismatch')
  } else {
    record('UNKNOWN', 'artifact_manifest', { reason: 'not_supplied', note: 'Pass --artifact <install-artifact.json> to bind the published tar/closure digests' })
    unknowns.push('artifact_manifest')
  }

  // Human-facing install identity must never be inferred from a directory name.
  const result = checks.some((entry) => entry.status === 'FAIL') ? 'REFUSED'
    : checks.some((entry) => ['WARN', 'UNKNOWN'].includes(entry.status)) ? 'DEGRADED' : 'OK'
  const exitCode = result === 'OK' ? 0 : result === 'DEGRADED' ? 1 : 2
  return { checks, unknowns, observed, method, result, exitCode }
}

/** Load and validate an optional artifact manifest file (JSON only). */
export async function loadArtifact(path) {
  if (path === undefined) return undefined
  let raw
  try { raw = await readFile(resolve(path), 'utf8') } catch (error) { throw new TrialKitError('artifact_missing', 'Artifact manifest cannot be read', { path, code: error?.code }) }
  if (raw.length > LIMITS.maxManifestBytes) throw new TrialKitError('artifact_too_large', 'Artifact manifest exceeds the byte budget')
  let value
  try { value = JSON.parse(raw) } catch (error) { throw new TrialKitError('artifact_invalid', 'Artifact manifest is not valid JSON', { cause: String(error?.message ?? error).slice(0, 200) }) }
  if (value?.protocol !== 'pa-install-artifact/1') throw new TrialKitError('artifact_invalid', 'Artifact manifest protocol is not pa-install-artifact/1', { protocol: value?.protocol ?? null })
  return value
}

export { sha256 }
