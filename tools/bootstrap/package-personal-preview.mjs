#!/usr/bin/env node
/** Wrap an exact frozen installation with a Node runtime; never changes inner bytes. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { productGuideHTML } from './product-guide-html.mjs'

const DEFAULT_TAR = '/Users/hh/Desktop/joker/pa-artifacts/wave31-target/wave31-target-4dcd28f.tar.gz'
const DEFAULT_SHA = '405ecd02fcbf288bac0855e17911ec4035521b54fe27d81fa0b28feaf5addcc6'
const DEFAULT_BYTES = 20540568
const DEFAULT_NODE = '/Users/hh/.nvm/versions/node/v24.21.0'
const NODE_SHA = 'e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b'
const NODE_LICENSE_SHA = '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace'
const DEFAULT_OUTPUT = '/Users/hh/Desktop/joker/pa-artifacts/personal-preview-20261116'
const SOURCE = fileURLToPath(import.meta.url)
const HELPER = fileURLToPath(new URL('./personal-preview-launcher.mjs', import.meta.url))
const HELP = `Package a macOS Apple Silicon personal preview without starting it.

node tools/bootstrap/package-personal-preview.mjs [--output <new-directory>]
  [--tar <exact.tar.gz> --sha256 <expected-sha256> --bytes <expected-bytes>]
  [--node-root <Node24.21.0-directory>]

The default tar is the earlier4dcd28f R2 predecessor. A custom tar requires its
explicit expected digest and byte count; its manifest supplies build/source.
Output must not exist. No model key, user state, native auth or global runtime
is copied. The inner installation is verified and preserved byte for byte.
`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const safeRelative = value => typeof value === 'string' && value.length > 0 && !value.includes('\\') &&
  !posix.isAbsolute(value) && !value.split('/').includes('..') && !value.includes('\0')

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, timeout: 60000, ...options })
  if (result.error || result.status !== 0) throw new Error(`${basename(bin)} failed: ${result.error?.message ?? String(result.stderr).slice(-600)}`)
  return result.stdout
}

function validateInventory(install, manifest) {
  const actualRoot = realpathSync(install), seen = new Set(), mismatches = []
  let files = 0, links = 0
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 10000) throw new Error('Invalid inner inventory size')
  for (const entry of manifest.files) {
    if (!safeRelative(entry.path) || seen.has(entry.path)) throw new Error('Unsafe or duplicate inner inventory path')
    seen.add(entry.path)
    const path = join(install, entry.path), stat = lstatSync(path)
    if (entry.kind === 'file') {
      files++
      if (!stat.isFile() || stat.size !== entry.bytes || hash(readFileSync(path)) !== entry.sha256) mismatches.push(entry.path)
    } else if (entry.kind === 'symlink') {
      links++
      if (!stat.isSymbolicLink() || readlinkSync(path) !== entry.target || !realpathSync(path).startsWith(`${actualRoot}/`)) mismatches.push(entry.path)
    } else throw new Error('Unknown inner inventory kind')
  }
  if (mismatches.length) throw new Error(`Inner bytes or links mismatch: ${mismatches.slice(0, 10).join(', ')}`)
  return { entries: manifest.files.length, regularFiles: files, internalLinks: links }
}

function writeNew(path, text, mode = 0o644) { writeFileSync(path, text, { flag: 'wx', mode }); chmodSync(path, mode) }

function shellEntry(action) {
  return `#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/runtime/bin/node" "$DIR/personal-preview-launcher.mjs" ${action} "$@"\n`
}

function readme(manifest) {
  const guide = readFileSync(new URL('../../docs/PRODUCT-GUIDE.zh-CN.md', import.meta.url), 'utf8')
  return `# 个人 Agent 助理安装与使用\n\n源码：${manifest.inner.source}；构建：${manifest.inner.buildId}；Node：${manifest.runtime.version}。\n\n优先使用提供的DMG，将.app拖到“应用程序”后打开。此ZIP为备用命令版：保留整个解压目录，双击Start.command并保留终端；停止用Stop.command。网页“偏好设置”可配置模型，完整手册同时提供产品使用手册.html和产品使用手册.md。\n\nZIP私有根为 ~/Library/Application Support/PersonalAgent/Preview-${manifest.inner.buildId}/；桌面.app使用独立Desktop根。配置、账号、模型Key和运行数据不进入分享包。不要移动正在运行的安装。\n\n内部tar SHA256：${manifest.inner.tarSha256}\n原安装清单 SHA256：${manifest.inner.installManifestSha256}\nNode SHA256：${manifest.runtime.sha256}\n完整许可：runtime/LICENSE；原MIT和依赖许可保留在install内。\n\n封装本身只证明文件身份，启动修复/模型能力/跨机结论须按对应准确版本验收，不继承旧包PASS。\n\n---\n\n${guide}`
}

function outerInventory(root) {
  const entries = []
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name, absolute = join(dir, name), stat = lstatSync(absolute)
      if (relative === 'preview-manifest.json') continue
      if (stat.isDirectory()) walk(absolute, relative)
      else if (stat.isSymbolicLink()) entries.push({ path: relative, kind: 'symlink', mode: stat.mode & 0o777, target: readlinkSync(absolute) })
      else if (stat.isFile()) entries.push({ path: relative, kind: 'file', mode: stat.mode & 0o777, bytes: stat.size, sha256: hash(readFileSync(absolute)) })
      else throw new Error('Unexpected outer file type')
    }
  }
  walk(root)
  return entries
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { help: { type: 'boolean' }, output: { type: 'string' },
    tar: { type: 'string' }, sha256: { type: 'string' }, bytes: { type: 'string' }, 'node-root': { type: 'string' } } })
  if (values.help) { process.stdout.write(HELP); return }
  const tar = resolve(values.tar ?? DEFAULT_TAR), expectedSha = values.sha256 ?? DEFAULT_SHA,
    expectedBytes = values.bytes === undefined ? DEFAULT_BYTES : Number(values.bytes), output = resolve(values.output ?? DEFAULT_OUTPUT)
  if (values.tar && tar !== DEFAULT_TAR && (!values.sha256 || !values.bytes)) throw new Error('Custom --tar requires --sha256 and --bytes')
  if (!/^[a-f0-9]{64}$/.test(expectedSha) || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 100 * 1024 * 1024)
    throw new Error('Expected tar digest/bytes are invalid or exceed bounds')
  if (existsSync(output)) throw new Error(`Output already exists; nothing overwritten: ${output}`)
  if (statSync(tar).size !== expectedBytes || hash(readFileSync(tar)) !== expectedSha) throw new Error('Frozen tar identity mismatch')
  const listing = command('/usr/bin/tar', ['-tzf', tar]).trim().split('\n')
  if (listing.length > 10000 || listing.some(path => !safeRelative(path) || !path.startsWith('install/'))) throw new Error('Unsafe or oversized tar inventory')
  const manifestBytes = command('/usr/bin/tar', ['-xOzf', tar, 'install/install.json'])
  const installManifest = JSON.parse(manifestBytes)
  if (!/^[a-f0-9]{16}$/.test(installManifest.buildId ?? '') || !/^[a-f0-9]{40}$/.test(installManifest.source?.commit ?? '') || installManifest.source.dirty !== false)
    throw new Error('A clean exact build/source is required')
  for (const entry of installManifest.files ?? []) {
    if (!safeRelative(entry.path)) throw new Error('Unsafe manifest entry')
    if (entry.kind === 'symlink') {
      const target = posix.normalize(posix.join(posix.dirname(entry.path), entry.target ?? ''))
      if (!entry.target || posix.isAbsolute(entry.target) || target === '..' || target.startsWith('../')) throw new Error('External inner symlink')
    }
  }
  const nodeRoot = resolve(values['node-root'] ?? DEFAULT_NODE), node = join(nodeRoot, 'bin/node'), license = join(nodeRoot, 'LICENSE')
  if (!statSync(node).isFile() || !statSync(license).isFile()) throw new Error('Node binary and complete LICENSE are required')
  if (hash(readFileSync(node)) !== NODE_SHA || hash(readFileSync(license)) !== NODE_LICENSE_SHA)
    throw new Error('Node binary or complete LICENSE differs from the known24.21.0 runtime')
  const version = command(node, ['--version']).trim().replace(/^v/, '')
  if (version !== '24.21.0' || installManifest.producer?.node !== version || installManifest.producer?.arch !== 'arm64' || installManifest.producer?.platform !== 'darwin')
    throw new Error('The known Apple Silicon Node24.21.0 must match the inner producer')
  if (!command('/usr/bin/file', [node]).includes('arm64')) throw new Error('Node binary must include arm64')
  if (statSync(license).size < 100000) throw new Error('Complete Node LICENSE, including third-party notices, is required')
  mkdirSync(output, { mode: 0o700 })
  const folderName = `PersonalAgent-Preview-${installManifest.buildId.slice(0, 7)}`, folder = join(output, folderName)
  mkdirSync(folder, { mode: 0o755 })
  command('/usr/bin/tar', ['-xzf', tar, '-C', folder])
  const inventory = validateInventory(join(folder, 'install'), installManifest)
  mkdirSync(join(folder, 'runtime/bin'), { recursive: true, mode: 0o755 })
  copyFileSync(node, join(folder, 'runtime/bin/node')); chmodSync(join(folder, 'runtime/bin/node'), 0o755)
  copyFileSync(license, join(folder, 'runtime/LICENSE')); chmodSync(join(folder, 'runtime/LICENSE'), 0o644)
  if (hash(readFileSync(join(folder, 'runtime/bin/node'))) !== NODE_SHA ||
    hash(readFileSync(join(folder, 'runtime/LICENSE'))) !== NODE_LICENSE_SHA) throw new Error('Copied runtime identity mismatch')
  copyFileSync(HELPER, join(folder, 'personal-preview-launcher.mjs')); chmodSync(join(folder, 'personal-preview-launcher.mjs'), 0o644)
  const guide = fileURLToPath(new URL('../../docs/PRODUCT-GUIDE.zh-CN.md', import.meta.url))
  copyFileSync(guide, join(folder, '产品使用手册.md'))
  writeNew(join(folder, '产品使用手册.html'), productGuideHTML(guide))
  for (const [name, action] of [['Start', 'start'], ['Stop', 'stop'], ['Settings', 'settings']]) writeNew(join(folder, `${name}.command`), shellEntry(action), 0o755)
  const outer = { protocol: 'personal-agent-preview/1', launcherProtocol: 'personal-agent-preview-launcher/1', generatedAt: new Date().toISOString(),
    source: { packagerSha256: hash(readFileSync(SOURCE)), wrapperSha256: hash(readFileSync(HELPER)) },
    inner: { source: installManifest.source.commit, buildId: installManifest.buildId, tarSha256: expectedSha, tarBytes: expectedBytes,
      predecessor: expectedSha === DEFAULT_SHA, installManifestSha256: hash(readFileSync(join(folder, 'install/install.json'))), ...inventory },
    runtime: { name: 'Node.js', version, abi: '137', platform: 'darwin', arch: 'arm64',
      bytes: statSync(node).size, sha256: hash(readFileSync(node)), licenseBytes: statSync(license).size, licenseSha256: hash(readFileSync(license)) },
    limitations: ['unsigned macOS Apple Silicon personal preview', 'no independent E verdict for this outer package or new inner candidate',
      'no real model/native or cross-machine validation by this packager', 'no user state, model key or native auth copied', 'original pa lifecycle and execution admission remain authoritative'] }
  writeNew(join(folder, 'README.zh-CN.md'), readme(outer))
  outer.files = outerInventory(folder)
  writeNew(join(folder, 'preview-manifest.json'), `${JSON.stringify(outer, null, 2)}\n`)
  validateInventory(join(folder, 'install'), installManifest)
  const zip = join(output, `${folderName}.zip`)
  command('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--norsrc', '--noextattr', folder, zip], { timeout: 120000 })
  const zipStat = statSync(zip), result = { protocol: 'personal-agent-preview-build/1', status: 'PACKAGED_NOT_STARTED', folder, zip,
    zipBytes: zipStat.size, zipSha256: hash(readFileSync(zip)), manifestSha256: hash(readFileSync(join(folder, 'preview-manifest.json'))),
    inner: outer.inner, runtime: outer.runtime, files: outer.files.length, realModelNativeTurns: 0, servicesStarted: 0 }
  writeNew(join(output, 'package-result.json'), `${JSON.stringify(result, null, 2)}\n`, 0o600)
  writeNew(join(output, 'SHA256SUMS'), `${result.zipSha256}  ${basename(zip)}\n`)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === SOURCE) {
  try { await main() }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
