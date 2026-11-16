#!/usr/bin/env node
/** A portable entry into the unmodified packaged pa lifecycle. */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = dirname(fileURLToPath(import.meta.url))
const HELP = `Personal Agent Preview

Usage: Start.command [--port <port> --api-port <port>] [--discussion-only]
       Stop.command
       Settings.command
       runtime/bin/node personal-preview-launcher.mjs status|doctor

Start uses the original pa start and opens the browser. Keep its Terminal window
open while working; Stop.command asks that same package to stop its own instance.
The package never force-kills another process or changes an old installation.
Settings opens a private model JSON file, not a GUI key editor.
PA_MODEL_CONFIG may explicitly select your own private model JSON.
`
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

function metadata() {
  const value = JSON.parse(readFileSync(join(ROOT, 'preview-manifest.json'), 'utf8'))
  if (value.protocol !== 'personal-agent-preview/1' || value.launcherProtocol !== 'personal-agent-preview-launcher/1' ||
    !/^[a-f0-9]{16}$/.test(value.inner?.buildId ?? ''))
    throw new Error('预览包清单不正确，请重新解压完整发行包。')
  const install = JSON.parse(readFileSync(join(ROOT, 'install/install.json'), 'utf8'))
  if (install.buildId !== value.inner.buildId || install.source?.commit !== value.inner.source ||
    digest(readFileSync(join(ROOT, 'install/install.json'))) !== value.inner.installManifestSha256)
    throw new Error('预览包与内部安装清单不一致。')
  const nodePath = join(ROOT, 'runtime/bin/node')
  if (digest(readFileSync(nodePath)) !== value.runtime.sha256 ||
    digest(readFileSync(join(ROOT, 'runtime/LICENSE'))) !== value.runtime.licenseSha256)
    throw new Error('自带 Node 或许可证字节不一致，请重新解压发行包。')
  if (process.platform !== 'darwin' || process.arch !== 'arm64' ||
    process.versions.node !== value.runtime.version || process.versions.modules !== value.runtime.abi)
    throw new Error('此预览包仅支持 Apple Silicon Mac，请使用包内 Start.command 和自带 Node。')
  return value
}

function privateDirectory(path) {
  if (!existsSync(path)) {
    try { mkdirSync(path, { mode: 0o700 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    throw new Error(`私有目录的类型、拥有者或权限不正确：${path}。请保留现有内容并人工核对。`)
}

function context(manifest) {
  const parent = join(homedir(), 'Library/Application Support/PersonalAgent')
  const root = join(parent, `Preview-${manifest.inner.buildId}`)
  // Create only this application's namespace; never chmod or replace an existing user directory.
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 })
  privateDirectory(parent)
  privateDirectory(root)
  const roots = { config: join(root, 'config'), data: join(root, 'data'), cache: join(root, 'cache'),
    logs: join(root, 'logs'), workspace: join(root, 'workspaces') }
  for (const path of Object.values(roots)) privateDirectory(path)
  const defaultModel = join(homedir(), '.config/superagent-personal/model.json')
  const model = process.env.PA_MODEL_CONFIG ? resolve(process.env.PA_MODEL_CONFIG) :
    existsSync(defaultModel) ? defaultModel : join(roots.config, 'model.json')
  return { root, roots, model, bin: join(ROOT, 'install/bin/pa'), env: {
    ...process.env,
    PA_NODE: join(ROOT, 'runtime/bin/node'),
    PATH: `${join(ROOT, 'runtime/bin')}:${process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}`,
    PA_INSTALL_ROOT: join(ROOT, 'install/app'), PA_CONFIG_ROOT: roots.config, PA_DATA_ROOT: roots.data,
    PA_CACHE_ROOT: roots.cache, PA_LOGS_ROOT: roots.logs, PA_WORKSPACE_ROOT: roots.workspace, PA_MODEL_CONFIG: model,
  } }
}

function runJson(ctx, args) {
  const result = spawnSync(ctx.bin, [...args, '--json'], { cwd: ROOT, env: ctx.env,
    encoding: 'utf8', maxBuffer: 1024 * 1024 })
  // Original first-run/status own their probe deadlines; the wrapper adds no signal fallback.
  let body
  try { body = JSON.parse(result.stdout.trim()) } catch { /* Preserve original failure below. */ }
  const stopped = args[0] === 'status' && result.status === 2 && body?.status === 'STOPPED'
  const diagnosed = args[0] === 'doctor' && result.status === 1 && body?.status === 'DEGRADED' &&
    Array.isArray(body.checks) && body.checks.length > 0 && body.checks.every(check => ['PASS', 'WARN'].includes(check.status))
  if (result.error || (result.status !== 0 && !stopped && !diagnosed)) {
    if (body) process.stderr.write(`${JSON.stringify(body, null, 2)}\n`)
    throw new Error(`原启动器 ${args[0]} 未完成（${body?.code ?? result.error?.code ?? result.status}），请保留私有目录并运行 doctor。`)
  }
  return body
}

async function originalCli(ctx, args) {
  const child = spawn(ctx.bin, args, { cwd: ROOT, env: ctx.env, stdio: 'inherit' })
  return await new Promise((resolveCode, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) process.stderr.write(`原启动器因 ${signal} 结束；未知状态请保留数据并运行 status/doctor。\n`)
      resolveCode(code ?? 1)
    })
  })
}

async function availablePort(excluded = []) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = await new Promise((resolvePort, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const value = server.address().port
        server.close(error => error ? reject(error) : resolvePort(value))
      })
    })
    if (port >= 1024 && !excluded.includes(port) && !(port >= 5180 && port <= 5191) && !(port >= 8796 && port <= 8807)) return port
  }
  throw new Error('未能选择空闲端口，请用 --port 和 --api-port 明确选择另一对端口。')
}

function portNumber(raw) {
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1024 || Number(raw) > 65535)
    throw new Error('端口必须是 1024 到 65535 之间的整数。')
  return Number(raw)
}

function settings(ctx) {
  if (!existsSync(ctx.model)) {
    const parent = dirname(ctx.model)
    if (parent !== ctx.roots.config) {
      if (!existsSync(parent)) throw new Error('显式 PA_MODEL_CONFIG 的目录不存在，请先创建自己的私有目录。')
      privateDirectory(parent)
    }
    const template = { baseURL: 'https://your-gateway.example/v1', apiKey: '<replace-with-your-private-key>',
      model: '<replace-with-supported-model-id>', allowedModels: ['<replace-with-supported-model-id>'],
      allowInsecureHttp: false, maxOutputTokens: 1200 }
    writeFileSync(ctx.model, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  }
  privateDirectory(dirname(ctx.model))
  const fd = openSync(ctx.model, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 16384)
      throw new Error('模型配置必须是当前用户拥有的普通私有文件（0600），请人工核对。')
  } finally { closeSync(fd) }
  process.stdout.write(`编辑私有模型配置：${ctx.model}\n仅修改自己的连接信息；配置不进入分享包。\n`)
  const opened = spawnSync('/usr/bin/open', ['-a', 'TextEdit', ctx.model], { stdio: 'inherit' })
  return opened.status ?? 1
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean' }, port: { type: 'string' }, 'api-port': { type: 'string' }, 'discussion-only': { type: 'boolean' },
  } })
  if (parsed.values.help || !parsed.positionals.length) { process.stdout.write(HELP); return 0 }
  const [command, ...rest] = parsed.positionals
  if (rest.length || !['start', 'stop', 'settings', 'status', 'doctor'].includes(command)) throw new Error(HELP)
  if (command !== 'start' && (parsed.values.port || parsed.values['api-port'] || parsed.values['discussion-only'])) throw new Error(HELP)
  const manifest = metadata(), ctx = context(manifest)
  if (command === 'settings') return settings(ctx)
  if (command !== 'start') return await originalCli(ctx, [command, '--json'])
  const explicitPort = portNumber(parsed.values.port), explicitApi = portNumber(parsed.values['api-port'])
  if (!existsSync(join(ctx.roots.config, 'launcher.json'))) {
    const result = runJson(ctx, ['first-run'])
    if (result?.status !== 'OK') throw new Error('首次初始化未完成，请保留数据并运行 doctor。')
  }
  const status = runJson(ctx, ['status'])
  if (!['RUNNING', 'STOPPED'].includes(status?.status)) throw new Error('原实例身份尚未核实，请先运行 status/doctor。')
  const existing = status.status === 'RUNNING' ? status.instance : undefined
  const consolePort = explicitPort ?? (existing ? portNumber(new URL(existing.consoleURL).port) : await availablePort())
  const apiPort = explicitApi ?? (existing ? portNumber(new URL(existing.apiURL).port) : await availablePort([consolePort]))
  if (consolePort === apiPort) throw new Error('网页端口与接口端口不能相同。')
  let discussionOnly = parsed.values['discussion-only'] === true
  if (!existing && !discussionOnly) {
    const diagnosis = runJson(ctx, ['doctor'])
    const executor = diagnosis.checks?.find(check => check.id === 'executor_codex')
    const detail = executor?.detail
    if (!detail || !['PASS', 'WARN'].includes(executor.status)) throw new Error('无法核对原启动器的执行器事实，请先运行 doctor。')
    const authorReady = detail.available === true && detail.authPresent === true &&
      detail.evidence?.status === 'PASS_REAL_NATIVE_PRODUCT' && typeof detail.evidence.profileVersion === 'string' &&
      detail.version === detail.evidence.profileVersion
    if (!authorReady) {
      discussionOnly = true
      process.stdout.write('原启动器尚未确认可用的开发执行器，本次明确以仅对话模式启动。\n')
    }
  }
  process.stdout.write(`个人预览 ${manifest.inner.buildId}\n私有数据：${ctx.root}\n模型配置：${ctx.model}\n请保留启动窗口；结束时双击 Stop.command。\n`)
  return await originalCli(ctx, ['start', '--port', String(consolePort), '--api-port', String(apiPort), '--open',
    ...(discussionOnly ? ['--discussion-only'] : [])])
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main() }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
