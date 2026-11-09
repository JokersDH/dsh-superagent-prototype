import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
async function stopExisting() {
  const file = join(root, '.local-state/workbench/workbench.json')
  if (!existsSync(file)) return
  const { pid } = JSON.parse(readFileSync(file, 'utf8'))
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return
  const command = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  if (command.status !== 0) return
  const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
  if (!/tools\/dev\/(start|workbench)\.mjs/.test(command.stdout) || !cwd.split('\n').includes(`n${realpathSync(root)}`))
    throw new Error('Recorded process does not belong to this workbench')
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
  if (args.every((arg) => ['--open', '--restart'].includes(arg))) {
    try {
      const health = await fetch('http://127.0.0.1:8796/v1/health', { signal: AbortSignal.timeout(500) })
      const data = await health.json()
      if (
        health.ok &&
        data.access === 'local-development' &&
        (await fetch('http://127.0.0.1:5180', { signal: AbortSignal.timeout(500) })).ok
      ) {
        console.log('Workbench: http://127.0.0.1:5180')
        if (args.includes('--open') && process.platform === 'darwin')
          spawn('open', ['http://127.0.0.1:5180'], { stdio: 'ignore' }).unref()
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
