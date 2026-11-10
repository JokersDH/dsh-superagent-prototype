import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { instanceState, probeInstance, readInstanceRecord, verifyLauncher } from './local-instance.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
const { values } = parseArgs({ args, options: {
  stop: { type: 'boolean' }, restart: { type: 'boolean' }, open: { type: 'boolean' }, fixture: { type: 'boolean' },
  'require-login': { type: 'boolean' }, state: { type: 'string' }, port: { type: 'string' }, 'api-port': { type: 'string' },
} })
const selectedState = instanceState(root, values.state)
async function stopExisting() {
  let record
  try { record = readInstanceRecord(selectedState) }
  catch (error) {
    if (error.code === 'state_missing') return
    throw new Error('无法读取可信启动记录，请运行 pnpm doctor。')
  }
  const { pid } = record
  if (pid === process.pid) throw new Error('Refusing to stop the launcher itself')
  try { process.kill(pid, 0) }
  catch (error) {
    if (error.code === 'ESRCH') return
    throw error
  }
  await verifyLauncher(root, record)
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Workbench is still shutting down')
}
async function start() {
  if (args.includes('--stop') || args.includes('--restart')) {
    await stopExisting()
    if (args.includes('--stop')) {
      console.log('Workbench stopped')
      return
    }
    process.argv = [...process.argv.slice(0, 2), ...args.filter((arg) => arg !== '--restart')]
  }
  {
    try {
      const { ApplicationConfigurationSchema } = await import('../../packages/contracts/dist/index.js')
      const instance = await probeInstance({
        root, state: selectedState, expectedMode: values.fixture ? 'fixture' : 'personal',
        parseConfiguration: (value) => ApplicationConfigurationSchema.parse(value),
      })
      if ((values['require-login'] ? instance.health.access === undefined : instance.health.access === 'local-development') &&
          (!values.port || new URL(instance.record.consoleURL).port === values.port) &&
          (!values['api-port'] || new URL(instance.record.apiURL).port === values['api-port'])) {
        console.log(`Workbench: ${instance.record.consoleURL}`)
        if (args.includes('--open') && process.platform === 'darwin')
          spawn('open', [instance.record.consoleURL], { stdio: 'ignore' }).unref()
        return
      }
    } catch {
      /* Build and start when the local instance is not already running. */
    }
  }
  const packages = [
    'contracts',
    'orchestrator-core',
    'effects',
    'storage',
    'questions',
    'application',
    'workspaces',
    'verification',
    'environment-preparation',
  ]
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    [...packages.flatMap((name) => ['--filter', `@personal-agent/${name}`]), '-r', 'build'],
    { cwd: root, stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) throw new Error('Startup build failed; check the command output')
  await import('./workbench.mjs')
}
start().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
