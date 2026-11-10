import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ProcessHost } from '../src/process-host.ts'
import { RunnerCommandProcess } from '../src/command-process.ts'

const environment = { PATH: process.env.PATH ?? '/usr/bin:/bin', COMMAND_TEST_VALUE: 'isolated' }
const defaults = { cwd: process.cwd(), env: environment, timeoutMs: 3000, maxOutputBytes: 4096 }
const run = (port: RunnerCommandProcess, text: string, extra = {}) => port.run(process.execPath, ['-e', text], { ...defaults, ...extra })

test('preparation command uses explicit cwd/env and shares the Runner resource inventory', async (t) => {
  const directory = mkdtempSync('/tmp/pa-command-context-')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(join(directory, 'workspace'))
  const host = new ProcessHost(), port = new RunnerCommandProcess(host)
  const result = await run(port, 'process.stdout.write(JSON.stringify({cwd:process.cwd(),value:process.env.COMMAND_TEST_VALUE,home:process.env.HOME}));process.stdin.on("end",()=>process.exit(0));process.stdin.resume()', { cwd: join(directory, 'workspace') })
  assert.equal(result.code, 0)
  assert.equal(result.quiescence, 'confirmed')
  const output = JSON.parse(result.stdout)
  assert.equal(output.cwd, execFileSync('pwd', ['-P'], { cwd: join(directory, 'workspace'), encoding: 'utf8' }).trim())
  assert.equal(output.value, 'isolated')
  assert.equal(output.home, undefined)
  assert.deepEqual(host.resources(), [])
  assert.equal(host.inventory().find(item => item.ref === result.resourceRef)?.writer, 'quiescent')
})
test('stdout/stderr and multibyte output have one combined byte budget', async () => {
  const host = new ProcessHost(), port = new RunnerCommandProcess(host)
  for (const text of ['process.stdout.write("a".repeat(15));process.stderr.write("b".repeat(15))', 'process.stdout.write("中文".repeat(40));process.stderr.write("输出".repeat(40))', 'process.stdout.write(Buffer.alloc(30,255))']) {
    const result = await run(port, text, { maxOutputBytes: 20 })
    assert.equal(result.outputLimited, true)
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 20)
    assert.equal(result.quiescence, 'confirmed')
  }
})
test('cancel and deadline stop actual writes and leave no active inventory', async (t) => {
  const directory = mkdtempSync('/tmp/pa-command-stop-')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const cancel of [false, true]) {
    const host = new ProcessHost(), port = new RunnerCommandProcess(host), controller = new AbortController()
    const started = Date.now()
    const running = run(port, 'require("fs").writeFileSync("started",String(process.pid));setInterval(()=>require("fs").appendFileSync("writes","x"),5)', { cwd: directory, timeoutMs: cancel ? 3000 : 200, signal: controller.signal })
    if (cancel) setTimeout(() => controller.abort(), 200)
    const result = await running
    assert.equal(cancel ? result.cancelled : result.timedOut, true)
    assert.equal(result.quiescence, 'confirmed')
    assert.ok(Date.now() - started < 2500)
    const pid = Number(readFileSync(join(directory, 'started'), 'utf8'))
    assert.throws(() => process.kill(pid, 0), (error: NodeJS.ErrnoException) => error.code === 'ESRCH')
    assert.ok(host.inventory().every(item => item.writer === 'quiescent'))
  }
})
test('a normal leader exit still stops the same-group writer descendant', async (t) => {
  const directory = mkdtempSync('/tmp/pa-command-descendant-')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const host = new ProcessHost(), port = new RunnerCommandProcess(host)
  const code = 'const child=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},100)"],{stdio:"ignore"});require("fs").writeFileSync("descendant",String(child.pid));child.unref()'
  const result = await run(port, code, { cwd: directory })
  assert.equal(result.quiescence, 'confirmed')
  const descendant = Number(readFileSync(join(directory, 'descendant'), 'utf8'))
  const listing = execFileSync('ps', ['-A', '-o', 'pid=,stat='], { encoding: 'utf8' })
  const member = listing.split('\n').find(line => Number(line.trim().split(/\s+/)[0]) === descendant)
  assert.ok(!member || member.trim().split(/\s+/)[1]?.startsWith('Z'))
})
test('pre-aborted or refused preparation admission cannot start a command', async () => {
  const host = new ProcessHost(), controller = new AbortController()
  controller.abort()
  const result = await run(new RunnerCommandProcess(host), 'throw new Error("never")', { signal: controller.signal })
  assert.equal(result.cancelled, true)
  assert.deepEqual(host.inventory(), [])
  await assert.rejects(run(new RunnerCommandProcess(host, async () => { throw new Error('intent not registered') }), 'throw new Error("never")'), /intent not registered/)
  assert.deepEqual(host.inventory(), [])
  host.closeAdmission()
  const closed = await run(new RunnerCommandProcess(host), 'throw new Error("never")')
  assert.equal(closed.spawnError, 'admission_closed')
  assert.deepEqual(host.inventory(), [])
})
test('closing host admission during execution cancels the same command through stopAll', async () => {
  const host = new ProcessHost(), port = new RunnerCommandProcess(host)
  const running = run(port, 'setInterval(()=>{},100)')
  while (!host.inventory().length) await new Promise(resolve => setTimeout(resolve, 5))
  host.closeAdmission()
  const stopped = await host.stopAll(500)
  const result = await running
  assert.equal(stopped.quiescence, 'confirmed')
  assert.equal(result.quiescence, 'confirmed')
  assert.ok(host.inventory().every(item => item.writer === 'quiescent'))
})
test('an unknown process identity never returns confirmed even when the child naturally exits', async () => {
  const host = new ProcessHost({ readStartMarker: () => null }), port = new RunnerCommandProcess(host)
  const result = await run(port, 'process.stdout.write("done")')
  assert.equal(result.quiescence, 'indeterminate')
  assert.equal(host.inventory()[0]?.writer, 'indeterminate')
})
test('invalid limits, argv and non-absolute paths refuse before process creation', async () => {
  const host = new ProcessHost(), port = new RunnerCommandProcess(host)
  for (const extra of [{ timeoutMs: 0 }, { maxOutputBytes: 0 }, { maxOutputBytes: Infinity }, { cwd: '.' }, { env: { INVALID: 'value\0' } }])
    await assert.rejects(run(port, 'never', extra), TypeError)
  await assert.rejects(port.run('node', [], defaults), TypeError)
  await assert.rejects(port.run(process.execPath, ['bad\0'], defaults), TypeError)
  assert.deepEqual(host.inventory(), [])
})
