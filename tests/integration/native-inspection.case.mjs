import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inspectNativeExecutor } from '../../apps/coordinator/product/native-inspection.ts'
import { NativeAdmissionError } from '../../apps/coordinator/product/native-startup.ts'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'

function fakeCli(t, { loginCode = 0, version = 'codex-cli 0.999.1', malformed = false, mutate = false, schemaFailure = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pa-native-inspection-')))
  const executable = join(root, 'fake-codex.mjs'), calls = join(root, 'calls.jsonl')
  // A local executable fixture, not an installed vendor CLI. All branches exit normally.
  writeFileSync(executable, `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n')
if (args.length === 1 && args[0] === '--version') { console.log(${JSON.stringify(version)}); process.exit(0) }
if (JSON.stringify(args) === JSON.stringify(['login', 'status'])) {
  console.log('PRIVATE_AUTH_OUTPUT_MUST_NOT_LEAVE_PROCESS'); process.exit(${loginCode})
}
if (args[0] === 'app-server' && args.includes('generate-json-schema')) {
  if (${schemaFailure}) { console.error('PRIVATE_AUTH_OUTPUT_MUST_NOT_LEAVE_PROCESS'); process.exit(2) }
  const out = args[args.indexOf('--out') + 1]
  const client = { oneOf: [
    { properties: { method: { enum: ['initialize'] }, params: { type: 'object', properties: { clientInfo: { type: 'object' }, capabilities: { type: 'object' } }, required: ['clientInfo'] } } },
    ...['thread/start', 'turn/start', 'turn/steer', 'turn/interrupt'].map(method => ({ properties: {
      method: { enum: [method] }, params: { type: 'object', properties: {
        model: { type: ['string', 'null'] }, approvalPolicy: { type: ['string', 'null'] }, sandbox: { type: ['string', 'null'] },
        threadId: { type: 'string' }, input: { type: 'array' }, expectedTurnId: { type: 'string' }, turnId: { type: 'string' },
      }, required: method === 'thread/start' ? [] : method === 'turn/start' ? ['threadId', 'input']
        : method === 'turn/steer' ? ['threadId', 'expectedTurnId', 'input'] : ['threadId', 'turnId'] },
    } })),
  ] }
  const notifications = { oneOf: ['item/started', 'item/completed', 'turn/completed', 'thread/tokenUsage/updated'].map(method => ({ properties: {
    method: { enum: [method] }, params: { type: 'object', properties: { status: { enum: ['failed', 'interrupted', 'completed', 'text', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall'] } } },
  } })) }
  const servers = { oneOf: ['item/command/requestApproval', 'item/tool/requestUserInput'].map(method => ({ properties: { method: { enum: [method] } } })) }
  for (const [name, schema] of Object.entries({ 'ClientRequest.json': client, 'ServerRequest.json': servers,
    'ServerNotification.json': notifications, 'RequestId.json': { anyOf: [{ type: 'integer' }, { type: 'string' }] } }))
    writeFileSync(join(out, name), ${malformed} ? '{malformed' : JSON.stringify(schema))
  if (${mutate}) appendFileSync(process.argv[1], '\\n// changed binary identity\\n')
  process.exit(0)
}
console.error('Unexpected command'); process.exit(7)
`)
  chmodSync(executable, 0o700)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { executable, calls: () => readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) }
}

test('fake installed CLI inspection uses real version/hash/schema without granting native or trial execution', async t => {
  const fixture = fakeCli(t), before = createHash('sha256').update(readFileSync(fixture.executable)).digest('hex')
  const result = await inspectNativeExecutor({ executable: fixture.executable })
  assert.equal(result.profile.expectedVersion, 'codex-cli 0.999.1')
  assert.equal(result.profile.id, 'profile-codex-native')
  assert.deepEqual(result.profile.argv, ['app-server', '--disable', 'apps', '-c', 'mcp_servers={}', '-c', 'web_search="disabled"'])
  assert.equal(result.profile.permissionPolicyRevision, 'codex-worktree-1')
  assert.equal(result.verdict.identity.executableDigest, before)
  assert.equal(result.verdict.identity.configStability, 'frozen')
  assert.equal(result.profile.nativeConfigRef, 'codex-product-request-policy-v1')
  assert.equal(result.verdict.class, 'compatible_unverified')
  assert.equal(result.verdict.admission, 'trial')
  assert.equal(result.verdict.nativeTestPassed, false)
  assert.equal(result.identityDigest, canonicalDigest(result.verdict.identity))
  assert.match(result.policyDigest, /^[a-f0-9]{64}$/)
  assert(result.verdict.evidenceRefs.includes('native-resolved-config:unobserved'))
  assert(result.operations.every(operation => !operation.enabled))
  assert.equal(result.operations.find(operation => operation.operation === 'begin').validation, 'controlled')
  assert.equal(result.operations.find(operation => operation.operation === 'resume').supported, null)
  assert(!JSON.stringify(result).includes('PRIVATE_AUTH_OUTPUT'))
  const calls = fixture.calls()
  assert.deepEqual(calls[0], ['--version']); assert.deepEqual(calls[1], ['login', 'status'])
  assert.equal(calls.length, 3)
  assert(calls[2].includes('generate-json-schema'))
  assert(calls.every(args => !args.some(value => /^(?:thread\/start|turn\/start|session\/prompt)$/.test(value))))
})

test('a normal login refusal stops before schema and does not expose authentication output', async t => {
  const fixture = fakeCli(t, { loginCode: 1 })
  await assert.rejects(inspectNativeExecutor({ executable: fixture.executable }), error =>
    error instanceof NativeAdmissionError && error.reason === 'needs_auth' && !String(error).includes('PRIVATE_AUTH_OUTPUT'))
  assert.deepEqual(fixture.calls(), [['--version'], ['login', 'status']])
})

test('malformed schema remains unknown without inventing an observed compatibility identity', async t => {
  const fixture = fakeCli(t, { malformed: true })
  const result = await inspectNativeExecutor({ executable: fixture.executable })
  assert.equal(result.verdict.class, 'unknown')
  assert.equal(result.verdict.identity, undefined)
  assert.equal(result.verdict.nativeTestPassed, false)
  assert(result.operations.every(operation => !operation.enabled))
  assert.match(result.identityDigest, /^[a-f0-9]{64}$/)
})

test('failed schema command stderr does not escape through classifier reasons or evidence', async t => {
  const fixture = fakeCli(t, { schemaFailure: true })
  const result = await inspectNativeExecutor({ executable: fixture.executable })
  assert.equal(result.verdict.class, 'unknown')
  assert(!JSON.stringify(result).includes('PRIVATE_AUTH_OUTPUT'))
  assert(result.verdict.reasons.includes('probe_failed:schema_probe_failed'))
})

test('an executable that changes while schema is exported cannot retain its earlier inspection identity', async t => {
  const fixture = fakeCli(t, { mutate: true })
  await assert.rejects(inspectNativeExecutor({ executable: fixture.executable }), error =>
    error instanceof NativeAdmissionError && error.reason === 'probe_failed')
})

test('unrecognized CLI version text is refused without copying arbitrary output into evidence', async t => {
  const fixture = fakeCli(t, { version: 'PRIVATE_AUTH_OUTPUT_MUST_NOT_LEAVE_PROCESS' })
  await assert.rejects(inspectNativeExecutor({ executable: fixture.executable }), error =>
    error instanceof NativeAdmissionError && error.reason === 'probe_failed' && !String(error).includes('PRIVATE_AUTH_OUTPUT'))
  assert.deepEqual(fixture.calls(), [['--version']])
})
