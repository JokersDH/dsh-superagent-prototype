import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { ProcessHost } from '../src/process-host.ts'
import { CodexConnection } from '../../../packages/drivers/codex-native/src/protocol.ts'

if (!process.argv.includes('--execute-local-probe'))
  throw new Error('Pass --execute-local-probe for the private local native sandbox/stop probe; it starts no model turn')
const root = realpathSync(mkdtempSync('/tmp/pa-native-safety-'))
const workspace = join(root, 'workspace'),
  outside = join(root, 'outside')
mkdirSync(workspace)
mkdirSync(outside)
const executable = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim()
const host = new ProcessHost({ resolveCwd: () => workspace })
const child = await host.spawn({
  executable,
  argv: ['app-server', '--disable', 'apps', '-c', 'mcp_servers={}'],
  cwdRef: 'workspace',
  environmentRef: 'probe',
})
let connection,
  writes = Promise.resolve(),
  stderrBytes = 0,
  writerPid,
  writerMarker
connection = new CodexConnection((bytes) => {
  writes = writes.then(() => child.write(bytes))
  void writes.catch(() => connection.close('write-failed'))
})
const reading = (async () => {
  for await (const bytes of child.stdout) connection.receive(bytes)
})()
void reading.catch(() => connection.close('stdout-failed'))
void (async () => {
  for await (const bytes of child.stderr) stderrBytes += bytes.length
})().catch(() => undefined)
const cases = [],
  started = Date.now()
const readMarker = (pid) => {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const report = {
  status: 'FAIL_NATIVE_SAFETY',
  modelTurns: 0,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  checkedAt: new Date().toISOString(),
  version: execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(),
  cases,
}
try {
  await connection.initialize({ name: 'personal_agent_native_probe', version: '0.1.0' })
  const thread = await connection.request('thread/start', {
    cwd: workspace,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    ephemeral: true,
    config: {
      mcp_servers: {},
      features: { apps: false },
      sandbox_workspace_write: { network_access: false, exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
    },
  })
  assert.equal(thread.cwd, workspace)
  assert.equal(thread.sandbox.type, 'workspaceWrite')
  assert.equal(thread.sandbox.networkAccess, false)
  const positive = join(workspace, 'inside-probe')
  const common = { cwd: workspace, sandboxPolicy: thread.sandbox, timeoutMs: 3000, outputBytesCap: 4096 }
  const inside = await connection.request('command/exec', { ...common, command: ['/usr/bin/touch', positive] })
  cases.push({
    id: 'NATIVE-SANDBOX-ALLOWS-ASSIGNED-WORKTREE',
    status: inside.exitCode === 0 && existsSync(positive) ? 'PASS' : 'FAIL',
  })
  const forbidden = join(outside, 'forbidden-probe')
  const negative = await connection.request('command/exec', { ...common, command: ['/usr/bin/touch', forbidden] })
  cases.push({
    id: 'NATIVE-SANDBOX-REFUSES-OUTSIDE-WRITE',
    status:
      negative.exitCode !== 0 &&
      !existsSync(forbidden) &&
      /not permitted|permission denied|read-only|sandbox/i.test(negative.stderr)
        ? 'PASS'
        : 'FAIL',
    exitCode: negative.exitCode,
    fileCreated: existsSync(forbidden),
  })
  const marker = join(workspace, 'writer-info.json'),
    heartbeat = join(workspace, 'writer-heartbeat')
  const command = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'tick\\n'),25)`
  const pending = connection.request('command/exec', {
    ...common,
    command: [process.execPath, '-e', command],
    processId: 'owned-writer-probe',
    timeoutMs: 20000,
    streamStdoutStderr: true,
  })
  void pending.catch(() => undefined)
  const deadline = Date.now() + 5000
  while ((!existsSync(marker) || !existsSync(heartbeat)) && Date.now() < deadline) await setTimeout(20)
  assert.ok(existsSync(marker) && existsSync(heartbeat), 'The stop probe needs an actual live private writer')
  writerPid = JSON.parse(readFileSync(marker, 'utf8')).pid
  writerMarker = readMarker(writerPid)
  assert.ok(writerPid > 1 && writerMarker && alive(writerPid))
  const stopped = await host.stopOwned(child.resourceRef, 1500)
  const before = readFileSync(heartbeat).length
  await setTimeout(150)
  const stillWriting = readFileSync(heartbeat).length > before
  cases.push({
    id: 'NATIVE-OWNED-STOP-INCLUDES-COMMAND-CHILD',
    status: stopped.quiescence === 'confirmed' && !alive(writerPid) && !stillWriting ? 'PASS' : 'FAIL',
    quiescence: stopped.quiescence,
    writerAlive: alive(writerPid),
    writerStillWriting: stillWriting,
  })
  report.status = cases.every((item) => item.status === 'PASS') ? 'PASS_NATIVE_SAFETY' : 'FAIL_NATIVE_SAFETY'
} catch (error) {
  report.error = String(error)
    .replace(/sk-[A-Za-z0-9_-]+|Bearer\s+\S+/g, '<REDACTED>')
    .slice(0, 1200)
} finally {
  if (writerPid && writerMarker && readMarker(writerPid) === writerMarker && alive(writerPid))
    process.kill(writerPid, 'SIGTERM')
  connection.close('probe-finished')
  await host.stopAll(1000)
  await reading.catch(() => undefined)
  report.elapsedMs = Date.now() - started
  report.stderrBytes = stderrBytes
  report.limitations = [
    'Zero model turns; only the installed Codex local command/sandbox and owned-stop path',
    'No actual human approval or model tool-loop proof',
  ]
  mkdirSync(resolve('apps/runner/reports/native-mvp'), { recursive: true })
  writeFileSync(resolve('apps/runner/reports/native-mvp/native-safety.json'), JSON.stringify(report, null, 2) + '\n')
  rmSync(root, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
assert.equal(report.status, 'PASS_NATIVE_SAFETY')
