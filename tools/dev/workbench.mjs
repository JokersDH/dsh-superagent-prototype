import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ApplicationConfigurationSchema } from '../../packages/contracts/dist/index.js'
import { localCredentials } from '../../apps/coordinator/http/local-state.ts'
import { processStart } from './local-instance.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '5180' },
    'api-port': { type: 'string', default: '8796' },
    state: { type: 'string', default: join(root, '.local-state/workbench') },
    'require-login': { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    fixture: { type: 'boolean', default: false },
    'discussion-only': { type: 'boolean', default: false },
    'review-restored-scope': { type: 'string' },
  },
})
if (values.fixture && values['discussion-only']) throw new Error('Discussion-only personal mode cannot use fixture execution')
if (values.fixture && values['review-restored-scope']) throw new Error('Restored review is an explicit personal entry')
const port = (name) => {
  const value = Number(values[name])
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65535)
    throw new Error(`${name} must be a local port from 1024 to 65535`)
  return value
}
const consolePort = port('port'),
  apiPort = port('api-port')
if (consolePort === apiPort) throw new Error('Console and API ports must differ')
const consoleURL = `http://127.0.0.1:${consolePort}`,
  apiURL = `http://127.0.0.1:${apiPort}`
const stateRoot = resolve(values.state),
  credential = localCredentials(stateRoot)
const requireConsole = createRequire(join(root, 'apps/console/package.json'))
const vite = join(dirname(requireConsole.resolve('vite/package.json')), 'bin/vite.js')
const children = []
let closing

function signal(child, value) {
  if (!Number.isInteger(child.pid) || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === 'win32') child.kill(value)
    else process.kill(-child.pid, value)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
async function shutdown() {
  closing ??= (async () => {
    for (const { child } of children) signal(child, 'SIGTERM')
    const deadline = setTimeout(() => {
      for (const { child } of children) signal(child, 'SIGKILL')
    }, 6000)
    try {
      await Promise.all(children.map((item) => item.exited))
    } finally {
      clearTimeout(deadline)
    }
  })()
  return closing
}
function launch(args, cwd, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  const exited = new Promise((resolve) => {
    child.once('error', (error) => {
      console.error(error.message)
      process.exitCode = 1
      resolve()
      void shutdown()
    })
    child.once('exit', (code) => {
      resolve()
      if (!closing) {
        process.exitCode = code || 1
        void shutdown()
      }
    })
  })
  children.push({ child, exited })
  return child
}
async function freePort(value) {
  const socket = createServer()
  await new Promise((resolve, reject) => {
    socket.once('error', (error) => reject(error.code === 'EADDRINUSE'
      ? new Error(`本机端口 ${value} 已被占用。请运行 pnpm doctor 核对已有服务，或使用 pnpm dev:workbench --port <其他网页端口> --api-port <其他接口端口> --state <独立状态目录>。`)
      : error))
    socket.listen(value, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())))
}
async function waitFor(url, child) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !closing) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('A workbench child exited before becoming ready')
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return
    } catch {
      /* Startup is bounded by the outer deadline. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Workbench startup deadline exceeded: ${url}`)
}
process.once('SIGINT', () => {
  void shutdown()
})
process.once('SIGTERM', () => {
  void shutdown()
})

async function main() {
  await freePort(apiPort)
  await freePort(consolePort)
  const api = launch(
    [
      'apps/coordinator/product/demo.ts',
      '--port',
      String(apiPort),
      '--state',
      stateRoot,
      '--console-origin',
      consoleURL,
      '--assistant',
      ...(!values.fixture ? ['--native'] : []),
      ...(values['discussion-only'] ? ['--discussion-only'] : []),
      ...(values['review-restored-scope'] ? ['--review-restored-scope', resolve(values['review-restored-scope'])] : []),
      ...(!values['require-login'] ? ['--local-access'] : []),
    ],
    root,
  )
  await waitFor(`${apiURL}/v1/health`, api)
  const health = await (await fetch(`${apiURL}/v1/health`, { signal: AbortSignal.timeout(3000) })).json()
  const response = await fetch(`${apiURL}/v1/configuration`, {
    headers: { authorization: `Bearer ${credential('api.key')}` },
    signal: AbortSignal.timeout(3000),
  })
  if (!response.ok) throw new Error('The product configuration is not available')
  const configuration = ApplicationConfigurationSchema.parse(await response.json())
  const project = configuration.projects.find((project) => project.dispatchAllowed) ?? configuration.projects[0]
  if (!project) throw new Error('No configured workspace is available')
  const profiles = configuration.profiles.filter(
    (profile) => profile.dispatchAllowed && project.profileIds.includes(profile.id),
  )
  if (values.fixture && profiles.some((profile) => profile.kind !== 'controlled_fixture'))
    throw new Error('No compatible admitted executor is available')
  const check = project.defaultCriteria.find((criterion) => criterion.kind === 'machine' && criterion.required)
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')))
  // Compatibility projection for the admitted console checkpoint; A owns its direct configuration transport.
  const console = launch(
    [vite, '--host', '127.0.0.1', '--port', String(consolePort), '--strictPort'],
    join(root, 'apps/console'),
    {
      ...environment,
      VITE_CONSOLE_MODE: 'http',
      VITE_API_TARGET: apiURL,
      VITE_CONVERSATION_ID: 'conv-main',
      VITE_PROFILE_IDS: profiles.map((profile) => profile.id).join(','),
      VITE_DEFAULT_PROFILE: project.defaultProfileId ?? '',
      VITE_CHECK_DEFINITION: check?.checkDefinitionRef ?? '',
      VITE_CHECK_CRITERION_ID: check?.id ?? '',
    },
  )
  await waitFor(consoleURL, console)
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  writeFileSync(
    join(stateRoot, 'workbench.json'),
    JSON.stringify(
      {
        protocol: 'personal-workbench/1',
        pid: process.pid,
        processStart: await processStart(),
        apiPid: api.pid,
        consolePid: console.pid,
        consoleURL,
        apiURL,
        configurationRevision: configuration.revision,
        executionAvailability: configuration.executionAvailability,
        ...(health.restoredReviewDigest ? { restoredReviewDigest: health.restoredReviewDigest } : {}),
        mode: values.fixture ? 'fixture' : 'personal',
        access: values['require-login'] ? 'token' : 'local-development',
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  )
  process.stdout.write(`Workbench: ${consoleURL}\n`)
  if (values['require-login']) process.stdout.write(`Private login credential: ${join(stateRoot, 'bootstrap.key')}\n`)
  if (values.open && process.platform === 'darwin') spawn('open', [consoleURL], { stdio: 'ignore' }).unref()
}
main().catch(async (error) => {
  console.error(error.message)
  process.exitCode = 1
  await shutdown()
})
