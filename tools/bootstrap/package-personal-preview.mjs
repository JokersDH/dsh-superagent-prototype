#!/usr/bin/env node
/** Wrap an exact frozen installation with a Node runtime; never changes inner bytes. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

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
  return `# 个人开发助手预览\n\n版本：${manifest.inner.buildId}；源码：${manifest.inner.source}。\n仅支持 macOS Apple Silicon。已附 Node ${manifest.runtime.version}，无需 Git、pnpm 或全局 Node 来打开工作台。导入和开发自己的 Git 项目仍需要本机 Git；原生开发需要你自己的已准入 Codex 及认证。\n\n## 开始使用\n\n1. 把整个文件夹解压到固定位置；保留 runtime 和 install 目录，不在运行时移动文件夹。\n2. 双击 Start.command，启动窗口会打印网页地址并打开浏览器。请保留启动窗口；默认普通模式按原执行器可用性降级，缺执行器时仍可讨论和审阅，不回退固定流程。\n3. 双击 Settings.command，用文本编辑器打开自己的私有模型 JSON。填入网关、key 和模型名后保存；这不是网页 API key 编辑器。没有配置也可先打开工作台。\n4. 结束时双击 Stop.command，继续由原 pa 启动器核对并停止此版本的实例。BLOCKED、UNKNOWN 或停止失败时保留现场，不删除 state/record、不强杀未知进程。\n\n若 macOS 提示未签名/无法验证，请先按下面的来源和 SHA 核对，再按你组织允许的系统打开方式操作；不要移除组织安全策略。当前是未签名个人预览，不是公证应用。\n\n## 数据和模型配置\n\n此版本的五个私有目录位于：\n\n\`~/Library/Application Support/PersonalAgent/Preview-${manifest.inner.buildId}/\`\n\nconfig、data、cache、logs、workspaces 不放入分享文件夹，重新分发此原始 ZIP 不携带运行后数据。保留完整原始 ZIP，勿把自己的私有目录一起发给同事。\n\n模型选择依次为：显式 PA_MODEL_CONFIG、当前用户已有的 \`~/.config/superagent-personal/model.json\`、此版本 config/model.json。Settings 仅在文件不存在时创建无秘密占位模板，绝不覆盖已有配置；目录需0700、文件需0600。HTTP 网关必须显式 allowInsecureHttp=true；网页只能切换 allowedModels 中的模型。\n\n原生执行认证使用同事自己的本机凭据；分享包没有作者的 key、账号目录、native session 或旧授权。正常启动不发送模型任务，用户明确发送对话或开发委托后才可能产生调用。\n\n## 操作与端口\n\nStart 优先复用原 pa 已核实的此版本实例；首次启动选两个空闲127.0.0.1端口。如端口竞争导致拒绝，保留实例后重试，或在终端用：\n\n\`./Start.command --port 5260 --api-port 8860\`\n\n仅对话可用 \`./Start.command --discussion-only\`；不要对已启用开发的实例静默换模式。状态和诊断可用：\n\n\`./runtime/bin/node ./personal-preview-launcher.mjs status\`\n\`./runtime/bin/node ./personal-preview-launcher.mjs doctor\`\n\n这些入口固定使用本包、自带 Node 和同一组五个私有根，不会替换旧5180–5191实例，也不借其 state 或凭据。\n\n## 功能和证据范围\n\n可见能力依包内版本：主对话、项目和明确委托、问题中心、检查/patch/人工接受、有限上下文与来源、模板、7/30天观察和 JSON 导出。开发需本机执行器就绪；机器检查和原授权守卫保持，人工接受不自动合并/push。\n\n${manifest.inner.predecessor ? '这是旧 R2 4dcd28f 的便携封装，不包含后续 terminal lease 修复；仅用于封装验证，不冒称修后新版。' : '这是以此清洁源码和冻结字节生成的新候选，具体修复由对应 source 证据说明；封装本身不增加发行或执行授权。'}\n\n独立 E 同包验收、真实 native 控制/中途恢复、两真实项目完整重开、跨机长期运行及创新收益均不能由此封装推出；macOS arm64 之外不支持。外层 ZIP 的实际启动和同事机器验收应单独记录。\n\n## 可核对身份\n\n- 内部 tar SHA256：${manifest.inner.tarSha256}\n- 内部 tar 字节数：${manifest.inner.tarBytes}\n- 原始 install 清单 SHA256：${manifest.inner.installManifestSha256}\n- Node 二进制 SHA256：${manifest.runtime.sha256}\n- Node 完整许可：runtime/LICENSE（SHA256 ${manifest.runtime.licenseSha256}）\n- 全部外层文件和构建来源：preview-manifest.json\n\n外层未改写 install 内任何文件或链接，保留原 MIT/第三方许可。不要运行来自未知来源或摘要不一致的包。\n`
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
