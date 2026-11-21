#!/usr/bin/env node
/** Independent static integrity check. Never imports or executes code from the preview package. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const NODE_SHA = 'e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b'
const NODE_LICENSE_SHA = '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace'
// Independently read and reviewed: original pa CLI, private Settings, no second lifecycle or signals.
const REVIEWED_WRAPPERS = new Set([
  '8de31c59d8c9afe90d6464a9b9208d3757a57e76ea49d7af20e473b90360c5dc',
  '339bdac0912a05da701d04de0670e7b6cd49cc1d86687536fb809f45396d866c',
  // Desktop namespace and duplicate-copy URL reuse; original pa status still proves all identities.
  '07c834a9bfc5678861602173af2b2b59ab6a09fa994694a2d3402bd76723afb2',
])
const MAX_FILE = 256 * 1024 * 1024
const MAX_TOTAL = 1024 * 1024 * 1024
const MAX_ENTRIES = 30000
const HEX64 = /^[a-f0-9]{64}$/
const HEX40 = /^[a-f0-9]{40}$/
const HEX16 = /^[a-f0-9]{16}$/
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

class Refusal extends Error {
  constructor(code, path) { super(code); this.code = code; if (path) this.path = path }
}
const demand = (condition, code, path) => { if (!condition) throw new Refusal(code, path) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const within = (root, path) => path === root || path.startsWith(`${root}/`)
const safePath = path => typeof path === 'string' && path.length > 0 && path.length <= 4096 &&
  !/[\\:\u0000-\u001f\u007f]/.test(path) && !posix.isAbsolute(path) &&
  path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
const collisionKey = path => path.normalize('NFD').toLowerCase()

function regular(path, limit = MAX_FILE) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd)
    demand(before.isFile() && before.size <= limit, 'not_bounded_regular_file')
    const bytes = readFileSync(fd), after = fstatSync(fd)
    demand(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes.length === after.size, 'file_changed_during_read')
    return { bytes, mode: after.mode & 0o777, sha256: sha256(bytes) }
  } finally { closeSync(fd) }
}

function jsonFile(path) {
  const value = regular(path, 32 * 1024 * 1024)
  let parsed
  try { parsed = JSON.parse(value.bytes.toString('utf8')) } catch { throw new Refusal('invalid_json') }
  demand(object(parsed), 'manifest_must_be_object')
  return { ...value, value: parsed }
}

function walk(root) {
  const result = new Map(), names = new Set()
  const visit = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name
      demand(safePath(path) && !names.has(collisionKey(path)), 'unsafe_or_colliding_path', path)
      names.add(collisionKey(path))
      demand(names.size <= MAX_ENTRIES, 'too_many_entries')
      const absolute = join(root, path), stat = lstatSync(absolute)
      const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'special'
      demand(kind !== 'special' && (stat.mode & 0o6000) === 0, 'special_or_privileged_file', path)
      result.set(path, { kind, mode: stat.mode & 0o777 })
      if (kind === 'directory') visit(absolute, path)
    }
  }
  visit(root)
  return result
}

function secretPolicy(path, bytes) {
  demand(!path.split('/').some(part => ['.git', '.codex', '.ssh', '.aws', '.env', 'auth.json', 'api.key',
    'credentials.json', 'model.json', 'instance.json', 'launcher.json', 'start.lock', 'native-sessions'].includes(part)),
  'user_state_or_credentials_path', path)
  demand(!/\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm))?$/.test(path), 'database_in_package', path)
  if (path.startsWith('install/var/')) demand(['install/var/config', 'install/var/config/release.json'].includes(path), 'runtime_data_in_package', path)
  if (!bytes || bytes.subarray(0, 8192).includes(0)) return
  // Known literal key/token forms, not generic field names or source-code references to API keys.
  demand(!/(?:\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,})/.test(bytes.toString('utf8')),
    'credential_literal_in_package', path)
}

function inventory(root, records, { self, modes = false, policy = false } = {}) {
  root = realpathSync(root)
  demand(Array.isArray(records) && records.length > 0 && records.length <= MAX_ENTRIES, 'invalid_inventory')
  const actual = walk(root), expected = new Map(), directories = new Set(), cache = new Map()
  let files = 0, links = 0, bytes = 0
  if (self) expected.set(self, null)
  for (const entry of records) {
    demand(object(entry) && safePath(entry.path) && !expected.has(entry.path), 'invalid_or_duplicate_inventory_path', entry?.path)
    demand(entry.kind === 'file' || entry.kind === 'symlink', 'unsupported_inventory_kind', entry.path)
    expected.set(entry.path, entry)
  }
  for (const path of expected.keys()) {
    let parent = posix.dirname(path)
    while (parent !== '.') { directories.add(parent); parent = posix.dirname(parent) }
  }
  for (const [path, observed] of actual) {
    if (policy) secretPolicy(path)
    demand(observed.kind === 'directory' ? directories.has(path) : expected.has(path), 'unlisted_file_or_directory', path)
  }
  for (const [path, entry] of expected) {
    const observed = actual.get(path)
    demand(observed !== undefined && observed.kind === (entry?.kind ?? 'file'), 'missing_or_wrong_type', path)
    if (!entry) continue
    if (modes) demand(Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode <= 0o777 && entry.mode === observed.mode,
      'mode_mismatch', path)
    const absolute = join(root, path)
    if (entry.kind === 'file') {
      demand(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= MAX_FILE && HEX64.test(entry.sha256),
        'invalid_file_record', path)
      const file = regular(absolute)
      demand(file.bytes.length === entry.bytes && file.sha256 === entry.sha256, 'file_digest_mismatch', path)
      if (policy) secretPolicy(path, file.bytes)
      cache.set(path, { sha256: file.sha256, bytes: file.bytes.length })
      files++; bytes += file.bytes.length
      demand(bytes <= MAX_TOTAL, 'inventory_byte_limit')
    } else {
      demand(typeof entry.target === 'string' && entry.target.length > 0 && entry.target.length <= 4096 &&
        !/[\\\u0000-\u001f\u007f]/.test(entry.target) && !isAbsolute(entry.target), 'unsafe_symlink_target', path)
      demand(readlinkSync(absolute) === entry.target, 'symlink_target_mismatch', path)
      demand(within(root, resolve(dirname(absolute), entry.target)) && within(root, realpathSync(absolute)), 'foreign_symlink', path)
      links++
    }
  }
  return { entries: records.length, regularFiles: files, internalLinks: links, bytes, cache }
}

function shellEntry(action) {
  return `#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/runtime/bin/node" "$DIR/personal-preview-launcher.mjs" ${action} "$@"\n`
}

function scriptCheck(root, source) {
  for (const [name, action] of [['Start', 'start'], ['Stop', 'stop'], ['Settings', 'settings']]) {
    const file = regular(join(root, `${name}.command`), 4096)
    demand(file.bytes.toString('utf8') === shellEntry(action) && (file.mode & 0o111) !== 0, 'command_template_mismatch', `${name}.command`)
  }
  const wrapper = regular(join(root, 'personal-preview-launcher.mjs'), 128 * 1024)
  demand(REVIEWED_WRAPPERS.has(wrapper.sha256) && source?.wrapperSha256 === wrapper.sha256, 'unreviewed_launcher_bytes')
  demand(HEX64.test(source?.packagerSha256), 'invalid_packager_provenance')
}

function identity(outer, inner, release, expected) {
  demand(HEX40.test(outer.inner?.source) && HEX16.test(outer.inner?.buildId) && HEX64.test(outer.inner?.tarSha256) &&
    Number.isSafeInteger(outer.inner?.tarBytes) && outer.inner.tarBytes > 0 && typeof outer.inner.predecessor === 'boolean', 'invalid_inner_identity')
  demand(inner.format === 'pa-install' && inner.formatVersion === 1 && release.format === 'pa-release' && release.formatVersion === 1,
    'unsupported_inner_manifests')
  demand(inner.source?.dirty === false && release.source?.dirty === false &&
    inner.source.commit === outer.inner.source && release.source.commit === outer.inner.source &&
    inner.buildId === outer.inner.buildId && release.buildId === outer.inner.buildId, 'source_or_build_mismatch')
  if (expected.source) demand(outer.inner.source === expected.source, 'unexpected_source')
  if (expected.buildId) demand(outer.inner.buildId === expected.buildId, 'unexpected_build_id')
  for (const producer of [inner.producer, release.producer]) demand(producer?.node === '24.21.0' && producer.arch === 'arm64' &&
    producer.platform === 'darwin' && producer.productSchema === 18, 'unsupported_producer')
  demand(release.admission?.abi === '137' && inner.producer.abi === '137' && release.build?.consoleMode === 'http', 'unsupported_abi_or_console')
  demand(inner.appRoot === 'app' && inner.entry === 'bin/pa' && inner.entryFile === 'app/apps/launcher/bin/pa.mjs' &&
    inner.releaseManifest === 'var/config/release.json' && inner.entrypoints?.launcher === inner.entryFile &&
    inner.entrypoints?.consoleEntry === 'app/apps/console/dist/index.html', 'unexpected_inner_entrypoints')
}

export function verifyDirectory(input, expected = {}) {
  demand(lstatSync(input).isDirectory() && !lstatSync(input).isSymbolicLink(), 'directory_required')
  const root = realpathSync(input), manifest = jsonFile(join(root, 'preview-manifest.json')), outer = manifest.value
  demand(outer.protocol === 'personal-agent-preview/1' && outer.launcherProtocol === 'personal-agent-preview-launcher/1', 'unsupported_preview_protocol')
  secretPolicy('preview-manifest.json', manifest.bytes)
  const checked = inventory(root, outer.files, { self: 'preview-manifest.json', modes: true, policy: true })
  const topFiles = new Set(['Start.command', 'Stop.command', 'Settings.command', 'README.zh-CN.md', 'personal-preview-launcher.mjs',
    'runtime/bin/node', 'runtime/LICENSE', 'preview-manifest.json'])
  const productDocs = ['产品使用手册.md', '产品使用手册.html']
  for (const path of topFiles) if (path !== 'preview-manifest.json') demand(checked.cache.has(path), 'required_outer_file_missing', path)
  for (const path of checked.cache.keys()) demand(path.startsWith('install/') || topFiles.has(path) || productDocs.includes(path), 'unexpected_outer_payload', path)
  if (productDocs.some(path => checked.cache.has(path)))
    demand(productDocs.every(path => checked.cache.has(path)), 'incomplete_product_guide')
  const installRoot = join(root, 'install')
  demand(lstatSync(installRoot).isDirectory() && !lstatSync(installRoot).isSymbolicLink(), 'inner_directory_required')
  const install = jsonFile(join(installRoot, 'install.json')), release = jsonFile(join(installRoot, 'var/config/release.json'))
  demand(install.sha256 === outer.inner?.installManifestSha256, 'inner_manifest_digest_mismatch')
  identity(outer, install.value, release.value, expected)
  const inner = inventory(installRoot, install.value.files, { self: 'install.json' })
  for (const key of ['entries', 'regularFiles', 'internalLinks']) demand(inner[key] === outer.inner[key], 'inner_inventory_count_mismatch')
  scriptCheck(root, outer.source)
  const runtime = outer.runtime, node = regular(join(root, 'runtime/bin/node')), license = regular(join(root, 'runtime/LICENSE'))
  demand(runtime?.name === 'Node.js' && runtime.version === '24.21.0' && runtime.abi === '137' && runtime.platform === 'darwin' &&
    runtime.arch === 'arm64' && runtime.sha256 === NODE_SHA && node.sha256 === NODE_SHA && runtime.bytes === node.bytes.length &&
    (node.mode & 0o111) !== 0, 'runtime_node_mismatch')
  demand(node.bytes.length > 32 && node.bytes.readUInt32LE(0) === 0xfeedfacf && node.bytes.readUInt32LE(4) === 0x0100000c, 'runtime_not_arm64_macho')
  demand(runtime.licenseSha256 === NODE_LICENSE_SHA && license.sha256 === NODE_LICENSE_SHA &&
    runtime.licenseBytes === license.bytes.length && license.bytes.length >= 100000, 'runtime_license_mismatch')
  demand(license.bytes.toString('utf8').includes('Node.js is licensed'), 'node_license_header_missing')
  const wrapper = regular(join(installRoot, 'bin/pa'), 8192).bytes.toString('utf8')
  const originalWrapper = '#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\n' +
    'export PA_INSTALL_ROOT="$DIR/app"\nexport PA_CONFIG_ROOT="${PA_CONFIG_ROOT:-$DIR/var/config}"\n' +
    'export PA_DATA_ROOT="${PA_DATA_ROOT:-$DIR/var/data}"\nexport PA_CACHE_ROOT="${PA_CACHE_ROOT:-$DIR/var/cache}"\n' +
    'export PA_LOGS_ROOT="${PA_LOGS_ROOT:-$DIR/var/logs}"\nexport PA_WORKSPACE_ROOT="${PA_WORKSPACE_ROOT:-$DIR/var/workspaces}"\n' +
    'exec "${PA_NODE:-node}" "$DIR/app/apps/launcher/bin/pa.mjs" "$@"\n'
  demand(wrapper === originalWrapper, 'unreviewed_inner_cli_wrapper')
  for (const path of ['app/apps/launcher/bin/pa.mjs', 'app/apps/coordinator/product/demo.ts', 'app/apps/console/dist/index.html'])
    demand(inner.cache.has(path), 'required_original_entry_missing', path)
  return { protocol: 'personal-agent-preview-verification/1', status: 'VERIFIED_STATIC',
    manifestSha256: manifest.sha256, source: outer.inner.source, buildId: outer.inner.buildId, predecessor: outer.inner.predecessor,
    outer: { entries: checked.entries, regularFiles: checked.regularFiles, internalLinks: checked.internalLinks, bytes: checked.bytes },
    inner: { entries: inner.entries, regularFiles: inner.regularFiles, internalLinks: inner.internalLinks, manifestSha256: install.sha256,
      originalTarSha256: outer.inner.tarSha256, originalTarBytes: outer.inner.tarBytes },
    runtime: { version: runtime.version, abi: runtime.abi, arch: runtime.arch, sha256: node.sha256, licenseSha256: license.sha256 },
    commandTemplatesExact: true, reviewedLauncherSha256: outer.source.wrapperSha256, userDataPathsAndKnownCredentialFormsChecked: true,
    limitation: 'Static integrity, pinned entry/runtime bytes and manifest consistency only. Original tar identity is recorded, not re-derived from an expanded directory. No package code, runtime version probe, service, model or native task was executed. This is not a signature, release approval or functional startup verdict.',
    servicesStarted: 0, modelNativeTurns: 0, signals: 0, releaseApproved: false }
}

// The development-side verifier uses the standard library, not package code or an archive framework.
const EXTRACT_ZIP = String.raw`
import json, os, pathlib, stat, sys, unicodedata, zipfile
archive, destination = sys.argv[1:]
destination=os.path.realpath(destination)
def require(ok, code):
    if not ok: raise ValueError(code)
def safe(name):
    return bool(name) and len(name) <= 4096 and not name.startswith('/') and chr(92) not in name and ':' not in name and all(ord(c)>=32 and ord(c)!=127 for c in name) and all(p not in ('', '.', '..') for p in name.split('/'))
with zipfile.ZipFile(archive) as z:
    entries=z.infolist(); require(0 < len(entries) <= 30000, 'zip_entry_limit')
    members={}; aliases=set(); total=0
    for e in entries:
        name=e.filename.rstrip('/') if e.is_dir() else e.filename
        require(safe(name), 'unsafe_zip_path')
        key=unicodedata.normalize('NFD', name).casefold()
        require(key not in aliases, 'duplicate_zip_path'); aliases.add(key)
        require(not e.flag_bits & 1 and e.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'unsupported_zip_encoding')
        require(0 <= e.file_size <= 268435456 and e.compress_size <= 536870912, 'zip_file_limit')
        total+=e.file_size; require(total <= 1073741824, 'zip_total_limit')
        mode=e.external_attr >> 16
        kind='link' if stat.S_ISLNK(mode) else 'dir' if e.is_dir() or stat.S_ISDIR(mode) else 'file'
        require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK) and not mode & 0o6000, 'zip_special_file')
        if kind=='dir': require(e.file_size==0 and e.CRC==0,'zip_directory_payload')
        members[name]=(e,kind,mode)
    roots={name.split('/')[0] for name in members}; require(len(roots)==1, 'zip_single_root_required')
    root=next(iter(roots)); require(root.startswith('PersonalAgent-Preview-'), 'unexpected_zip_root')
    for name,(e,kind,mode) in members.items():
        parent=pathlib.PurePosixPath(name).parent
        while str(parent) != '.':
            require(str(parent) not in members or members[str(parent)][1]=='dir', 'zip_parent_not_directory')
            parent=parent.parent
    os.makedirs(destination, mode=0o700, exist_ok=True)
    for name,(e,kind,mode) in sorted(members.items(), key=lambda pair: (len(pathlib.PurePosixPath(pair[0]).parts), pair[0])):
        target=os.path.join(destination,*name.split('/'))
        if kind=='dir': os.makedirs(target,mode=0o700,exist_ok=True)
        elif kind=='file':
            os.makedirs(os.path.dirname(target),mode=0o700,exist_ok=True)
            written=0
            with z.open(e) as src, open(target,'xb') as out:
                while True:
                    block=src.read(1048576)
                    if not block: break
                    written+=len(block); require(written<=e.file_size,'zip_expansion_limit'); out.write(block)
            require(written==e.file_size,'zip_size_mismatch')
            os.chmod(target, (mode & 0o777) if mode else 0o644)
    for name,(e,kind,mode) in members.items():
        if kind!='link': continue
        require(e.file_size<=4096,'zip_link_limit')
        link=z.read(e).decode('utf-8'); require(link and not os.path.isabs(link) and chr(92) not in link and not any(ord(c)<32 for c in link),'unsafe_zip_link')
        target=os.path.join(destination,*name.split('/'))
        resolved=os.path.abspath(os.path.join(os.path.dirname(target),link))
        base=os.path.join(destination,root)
        require(os.path.commonpath((base,resolved))==base,'foreign_zip_link')
        os.makedirs(os.path.dirname(target),mode=0o700,exist_ok=True); os.symlink(link,target)
    for name,(e,kind,mode) in members.items():
        if kind=='link':
            target=os.path.join(destination,*name.split('/'))
            require(os.path.exists(target) and os.path.commonpath((os.path.join(destination,root),os.path.realpath(target)))==os.path.join(destination,root),'foreign_or_dangling_zip_link')
    print(json.dumps({'root':root,'entries':len(entries),'expandedBytes':total,'crcChecked':True}))
`

function extractZip(archive, destination) {
  demand(lstatSync(archive).isFile() && !lstatSync(archive).isSymbolicLink() && lstatSync(archive).size <= 512 * 1024 * 1024, 'zip_file_required_or_too_large')
  const result = spawnSync('python3', ['-c', EXTRACT_ZIP, archive, destination], { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 120000 })
  demand(!result.error && result.status === 0, 'zip_preflight_or_extract_refused')
  let parsed
  try { parsed = JSON.parse(result.stdout) } catch { throw new Refusal('invalid_zip_inspection_result') }
  demand(safePath(parsed.root) && !parsed.root.includes('/'), 'unsafe_zip_result')
  return parsed
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'pa-preview-verifier-test-')), cases = []
  const run = (id, expectedCode, action) => {
    try { action(); cases.push({ id, status: expectedCode ? 'FAIL' : 'PASS' }) }
    catch (error) { cases.push({ id, status: expectedCode && error.code === expectedCode ? 'PASS' : 'FAIL', code: error.code ?? 'unexpected_error' }) }
  }
  try {
    const fixture = join(root, 'inventory'); mkdirSync(fixture)
    const path = join(fixture, 'entry.mjs'), bytes = Buffer.from('export const value = 1\n')
    writeFileSync(path, bytes)
    const record = { path: 'entry.mjs', kind: 'file', bytes: bytes.length, sha256: sha256(bytes) }
    run('inventory_positive', null, () => inventory(fixture, [record]))
    run('missing_file_refused', 'missing_or_wrong_type', () => inventory(fixture, [record, { ...record, path: 'missing.mjs' }]))
    run('wrong_sha_refused', 'file_digest_mismatch', () => inventory(fixture, [{ ...record, sha256: '0'.repeat(64) }]))
    symlinkSync('../inventory/entry.mjs', join(fixture, 'internal'))
    const link = { path: 'internal', kind: 'symlink', target: '../inventory/entry.mjs' }
    run('internal_link_positive', null, () => inventory(fixture, [record, link]))
    symlinkSync('/dev/null', join(fixture, 'foreign'))
    run('absolute_link_refused', 'unsafe_symlink_target', () => inventory(fixture, [record, link, { path: 'foreign', kind: 'symlink', target: '/dev/null' }]))
    rmSync(join(fixture, 'foreign')); writeFileSync(join(root, 'outside'), 'outside')
    symlinkSync('../outside', join(fixture, 'foreign'))
    run('relative_foreign_link_refused', 'foreign_symlink', () => inventory(fixture, [record, link, { path: 'foreign', kind: 'symlink', target: '../outside' }]))
    run('credential_literal_refused', 'credential_literal_in_package', () => secretPolicy('install/app/test.txt', Buffer.from(`sk-${'z'.repeat(24)}`)))
    const scripts = join(root, 'scripts'); mkdirSync(scripts)
    for (const [name, action] of [['Start', 'start'], ['Stop', 'stop'], ['Settings', 'settings']]) writeFileSync(join(scripts, `${name}.command`), shellEntry(action), { mode: 0o755 })
    writeFileSync(join(scripts, 'Start.command'), `${shellEntry('start')}echo unexpected\n`)
    run('extra_shell_command_refused', 'command_template_mismatch', () => scriptCheck(scripts, {}))
    const positiveZip = join(root, 'positive.zip')
    const createPositive = spawnSync('python3', ['-c', "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z: z.writestr('PersonalAgent-Preview-test/entry.mjs','payload')", positiveZip], { encoding: 'utf8', timeout: 10000 })
    demand(createPositive.status === 0, 'self_test_zip_creation_failed')
    run('zip_positive_crc_checked', null, () => extractZip(positiveZip, join(root, 'positive-extract')))
    const zip = join(root, 'traversal.zip')
    const make = spawnSync('python3', ['-c', "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z: z.writestr('../outside','blocked')", zip], { encoding: 'utf8', timeout: 10000 })
    demand(make.status === 0, 'self_test_zip_creation_failed')
    run('zip_traversal_refused', 'zip_preflight_or_extract_refused', () => extractZip(zip, join(root, 'extract')))
    return { protocol: 'personal-agent-preview-verifier-self-test/1', status: cases.every(value => value.status === 'PASS') ? 'PASS' : 'FAIL', cases,
      scope: 'Synthetic independent file-inventory, exact-script, credential and standard ZIP refusal controls; not a full preview or runtime startup.',
      servicesStarted: 0, modelNativeTurns: 0, signals: 0 }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { help: { type: 'boolean' }, dir: { type: 'string' }, zip: { type: 'string' },
    'expect-source': { type: 'string' }, 'expect-build-id': { type: 'string' }, 'expect-zip-sha256': { type: 'string' }, 'self-test': { type: 'boolean' } } })
  if (values.help) {
    process.stdout.write('Usage: node tools/bootstrap/verify-personal-preview.mjs --dir <preview-folder> | --zip <archive.zip>\n  [--expect-source <40hex>] [--expect-build-id <16hex>] [--expect-zip-sha256 <64hex>]\n  --self-test runs only synthetic pure/file controls. ZIP verification needs development-side Python3; the preview itself does not.\n')
    return
  }
  if (values['self-test']) {
    demand(!values.dir && !values.zip, 'self_test_requires_no_package')
    const report = selfTest(); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = report.status === 'PASS' ? 0 : 1; return
  }
  demand(Boolean(values.dir) !== Boolean(values.zip), 'choose_exactly_one_dir_or_zip')
  if (values['expect-source']) demand(HEX40.test(values['expect-source']), 'invalid_expected_source')
  if (values['expect-build-id']) demand(HEX16.test(values['expect-build-id']), 'invalid_expected_build_id')
  if (values['expect-zip-sha256']) demand(values.zip && HEX64.test(values['expect-zip-sha256']), 'invalid_expected_zip_hash')
  const expected = { source: values['expect-source'], buildId: values['expect-build-id'] }
  let temporary
  try {
    let input = resolve(values.dir ?? '.'), archive
    if (values.zip) {
      const zip = resolve(values.zip), file = regular(zip, 512 * 1024 * 1024)
      if (values['expect-zip-sha256']) demand(file.sha256 === values['expect-zip-sha256'], 'unexpected_zip_hash')
      temporary = mkdtempSync(join(tmpdir(), 'pa-preview-verify-'))
      const pinnedZip = join(temporary, 'input.zip'), destination = join(temporary, 'contents')
      writeFileSync(pinnedZip, file.bytes, { flag: 'wx', mode: 0o600 })
      const extracted = extractZip(pinnedZip, destination)
      input = join(destination, extracted.root)
      archive = { sha256: file.sha256, bytes: file.bytes.length, ...extracted }
    }
    const report = verifyDirectory(input, expected)
    process.stdout.write(`${JSON.stringify({ ...report, ...(archive ? { archive } : {}),
      externallyExpectedSource: expected.source ?? null, externallyExpectedBuildId: expected.buildId ?? null,
      externallyExpectedArchiveHash: values['expect-zip-sha256'] ?? null }, null, 2)}\n`)
  } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ protocol: 'personal-agent-preview-verification/1', status: 'REFUSED',
      code: error instanceof Refusal ? error.code : 'unreadable_or_invalid_package',
      ...(error instanceof Refusal && error.path ? { path: error.path } : {}),
      servicesStarted: 0, modelNativeTurns: 0, signals: 0, releaseApproved: false }, null, 2)}\n`)
    process.exitCode = 1
  }
}
