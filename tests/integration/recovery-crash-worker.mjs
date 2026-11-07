import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { FakeAgentSession } from '../../packages/testing/src/harness.ts'
import { openRecoveryFixture, recoveryRecord } from './recovery-fixture.mjs'
import { turnPayload } from './runtime-ingress-fixture.ts'

const [directory, mode] = process.argv.slice(2)
if (!directory || !['before-record', 'after-commit'].includes(mode)) throw new Error('Invalid disposable crash fixture arguments')
const h = openRecoveryFixture(directory)
const agent = await FakeAgentSession.start({ receiptsDir: directory, scenario: 'happy' })
const pid = agent.child.pid
const marker = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
writeFileSync(join(directory, 'owned-agent.json'), JSON.stringify({ pid, marker }), { flush: true })
agent.send({ type: 'begin', id: 'one-fixture-begin', preparedPolicyRef: 'fixture-only' })
await agent.waitForFrame(frame => frame.type === 'turn_ended')
const entry = recoveryRecord(turnPayload)
// A synced decoder-snapshot fixture, not certification of the unaccepted B journal writer.
writeFileSync(join(directory, 'recovery-snapshot.json'), JSON.stringify({ integrity: 'verified_snapshot', records: [entry] }), { flush: true })
if (mode === 'after-commit') {
  const result = await h.run([entry])
  if (result.accepted !== 1) throw new Error('Failed to reach the post-commit crash window')
}
writeFileSync(join(directory, 'crash-stage.json'), JSON.stringify({ mode }), { flush: true })
process.kill(process.pid, 'SIGKILL')
