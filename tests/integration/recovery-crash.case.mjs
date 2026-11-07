import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding } from './runtime-ingress-fixture.ts'

const worker = fileURLToPath(new URL('./recovery-crash-worker.mjs', import.meta.url))
function cleanOwnedAgent(directory) {
  if (!existsSync(join(directory, 'owned-agent.json'))) return
  const { pid, marker } = JSON.parse(readFileSync(join(directory, 'owned-agent.json'), 'utf8'))
  let current
  try { current = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return }
  if (current !== marker) throw new Error('Refusing to signal a reused fixture PID')
  const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  if (state.startsWith('Z')) return
  const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
  if (!command.includes('packages/testing/src/fake-agent.ts')) throw new Error('Unknown fixture process identity')
  try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
}
for (const mode of ['before-record', 'after-commit']) {
  test(`real SIGKILL ${mode}: restore facts, preserve committed receipts and never issue a second native begin`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'g1-recovery-crash-'))
    t.after(() => { cleanOwnedAgent(directory); rmSync(directory, { recursive: true, force: true }) })
    const child = spawn(process.execPath, [worker, directory, mode], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = '', timer
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const outcome = await new Promise((resolve, reject) => {
      timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Crash worker timeout: ${stderr}`)) }, 5000)
      child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }))
    }).finally(() => clearTimeout(timer))
    assert.equal(outcome.signal, 'SIGKILL', stderr)
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'crash-stage.json'), 'utf8')), { mode })
    const snapshot = JSON.parse(readFileSync(join(directory, 'recovery-snapshot.json'), 'utf8'))
    const h = openRecoveryFixture(directory)
    try {
      const id = snapshot.records[0].fact.factId, original = h.store.facts.get(id)
      assert.equal(!!original, mode === 'after-commit')
      const result = await h.run(snapshot.records, snapshot.integrity)
      assert.equal(result.failures.length, 0)
      assert.equal(result.accepted, mode === 'before-record' ? 1 : 0)
      assert.equal(result.replayed, mode === 'after-commit' ? 1 : 0)
      if (original) assert.equal(h.store.facts.get(id).seq, original.seq)
      assert.equal(h.store.observations.forAttempt(binding.attemptId).length, 1)
      assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
      const receipts = readFileSync(join(directory, 'receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
      assert.equal(receipts.filter(entry => entry.type === 'begin.accepted').length, 1)
    } finally { h.close() }
  })
}
