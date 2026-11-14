import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { canonicalJson } from '@personal-agent/contracts/canonical'
import { buildPersonalChain, projectId } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const producer = join(repoRoot, 'packages/context/tools/wave24-a-manifest.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
const aModule = join(aWorktree, 'packages/workflows/src/data-manifest.ts')
const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value as never)).digest('hex')

test('A real producer builds and verifies the original subject, and rejects every unique drift', { timeout: 120000 }, async (t) => {
  if (!existsSync(aModule)) {
    t.diagnostic(`NOT_REACHED: A manifest source missing at ${aModule}`)
    return
  }
  const root = mkdtempSync(join(tmpdir(), 'pa-wave24-a-manifest-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const aHead = execFileSync('git', ['-C', aWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const aDirty = execFileSync('git', ['-C', aWorktree, 'status', '--porcelain', 'packages/workflows/src/data-manifest.ts'], { encoding: 'utf8' }).trim().length > 0
  const expectation = {
    sourceSha: aHead, snapshotFormat: 1, dataRoot: chain.source,
    ticketId: chain.ticketId, assignmentId: chain.assignmentId, attemptId: chain.attemptId, fenceEpoch: chain.fenceEpoch,
    contract: chain.contract, questionId: chain.question.id, answerId: chain.answerId,
    requiredCommandIds: ['w22-work', 'w22-answer'],
    requiredDispatch: [chain.dispatchWindows.written, chain.dispatchWindows.unknown],
    requiredDeliveryTargets: [chain.deliveryTargetId],
  }
  const expectationPath = join(root, 'expectation.json')
  writeFileSync(expectationPath, JSON.stringify(expectation, null, 2))
  const invoke = (mode: 'build' | 'verify', extra: string[] = [], target = expectationPath) => spawnSync(process.execPath,
    ['--experimental-strip-types', '--no-warnings', producer, '--mode', mode, '--a-module', aModule, '--a-worktree', aWorktree, '--db', join(chain.source, 'state.sqlite'),
      '--expectation', target, '--a-head', aHead, ...extra], { encoding: 'utf8', cwd: repoRoot, timeout: 60000 })
  const build = invoke('build', ['--output', join(root, 'manifest.json')])
  assert.equal(build.status, 0, build.stderr || build.stdout)
  const built = JSON.parse(String(build.stdout).trim().split('\n').at(-1)!)
  assert.equal(built.pid, build.pid)
  assert.notEqual(built.pid, process.pid)
  assert.equal(built.aModuleSha256, createHash('sha256').update(readFileSync(aModule)).digest('hex'))
  const manifest = built.manifest
  assert.equal(manifest.protocol, 'wave24-data-manifest/1')
  assert.equal(manifest.subject.attemptId, chain.attemptId)
  assert.equal(manifest.subject.ticketId, chain.ticketId)
  assert.equal(manifest.subject.assignmentId, chain.assignmentId)
  assert.equal(manifest.subject.fenceEpoch, chain.fenceEpoch)
  assert.deepEqual(manifest.subject.contract, chain.contract)
  assert.equal(manifest.question.id, chain.question.id)
  assert.equal(manifest.question.validity, 'answered')
  assert.equal(manifest.answer.id, chain.answerId)
  assert.equal(manifest.deliveries.some((entry: { targetBindingId: string; status: string }) =>
    entry.targetBindingId === chain.deliveryTargetId && entry.status === 'native_applied'), true)
  assert.equal(manifest.dispatch.length, 2)
  assert.equal(manifest.commands.length >= 2, true)
  assert.equal(manifest.counts.observations > 0, true)
  assert.match(manifest.digest, /^[a-f0-9]{64}$/)
  assert.equal(manifest.digest, sha((({ digest: _digest, ...rest }) => rest)(manifest)))
  assert.match(manifest.sourceFingerprint, /^[a-f0-9]{64}$/)

  // A separate Node PID re-verifies the manifest with A's own verifier.
  const verify = invoke('verify', ['--manifest', join(root, 'manifest.json')])
  assert.equal(verify.status, 0, verify.stderr || verify.stdout)
  const verified = JSON.parse(String(verify.stdout).trim().split('\n').at(-1)!)
  assert.notEqual(verified.pid, built.pid)
  assert.deepEqual(verified.verification, { ok: true, coverage: manifest.coverage })

  // A's own independent reader fixture re-verifies the same manifest in a separate Node PID.
  const readerFixture = join(aWorktree, 'packages/workflows/test/fixtures/wave23-reader.mjs')
  assert.equal(existsSync(readerFixture), true)
  const legacy = spawnSync(process.execPath, [readerFixture, join(chain.source, 'state.sqlite'), join(root, 'manifest.json'), expectationPath], { encoding: 'utf8', timeout: 20000 })
  assert.equal(legacy.status, 0, legacy.stderr)
  const observed = JSON.parse(String(legacy.stdout))
  assert.equal(observed.verification.ok, true)
  assert.notEqual(observed.pid, process.pid)
  assert.equal(observed.binding.attemptId, chain.attemptId)
  assert.equal(observed.binding.ticketId, chain.ticketId)
  assert.deepEqual(observed.binding.contract, chain.contract)
  assert.equal(observed.question.id, chain.question.id)
  assert.equal(observed.answer.id, chain.answerId)
  assert.equal(observed.deliveries[0].status, 'native_applied')

  // Unique expectation drift must fail in A's own builder.
  for (const [label, mutate] of [
    ['foreign attempt', (value: any) => { value.attemptId = 'f'.repeat(32) }],
    ['foreign ticket', (value: any) => { value.ticketId = 'e'.repeat(32) }],
    ['foreign contract', (value: any) => { value.contract = { ...value.contract, digest: 'd'.repeat(64) } }],
    ['empty commands', (value: any) => { value.requiredCommandIds = [] }],
    ['empty dispatch', (value: any) => { value.requiredDispatch = [] }],
    ['foreign delivery target', (value: any) => { value.requiredDeliveryTargets = ['foreign-target'] }],
    ['duplicate command', (value: any) => { value.requiredCommandIds = ['w22-work', 'w22-work'] }],
  ] as const) {
    const copy = structuredClone(expectation); mutate(copy)
    const path = join(root, `bad-${label.replaceAll(' ', '-')}.json`)
    writeFileSync(path, JSON.stringify(copy))
    assert.notEqual(invoke('build', ['--output', join(root, 'unused.json')], path).status, 0, label)
  }

  // Structural manifest drift must be rejected by A's verifier even with a recomputed digest.
  for (const [label, mutate] of [
    ['foreign subject attempt', (value: any) => { value.subject.attemptId = 'f'.repeat(32) }],
    ['deleted commands and requirements', (value: any) => { value.commands = []; value.requirements.commandIds = [] }],
    ['foreign delivery target', (value: any) => { value.requirements.deliveryTargets = ['foreign-target'] }],
    ['source sha', (value: any) => { value.subject.sourceSha = 'b'.repeat(40) }],
    ['snapshot format', (value: any) => { value.subject.snapshotFormat = 2 }],
    ['duplicate command requirement', (value: any) => { value.requirements.commandIds = ['w22-work', 'w22-work'] }],
  ] as const) {
    const copy = structuredClone(manifest); mutate(copy)
    copy.digest = sha((({ digest: _digest, ...rest }) => rest)(copy))
    const path = join(root, `mutated-${label.replaceAll(' ', '-')}.json`)
    writeFileSync(path, JSON.stringify(copy))
    const result = invoke('verify', ['--manifest', path])
    assert.equal(result.status, 0, result.stderr)
    const observed = JSON.parse(String(result.stdout).trim().split('\n').at(-1)!)
    assert.equal(observed.verification.ok, false, label)
  }
  assert.equal(typeof aDirty, 'boolean')
  assert.match(aHead, /^[a-f0-9]{40}$/)
})
