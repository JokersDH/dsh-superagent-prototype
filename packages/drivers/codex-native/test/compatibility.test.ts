import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectCodexCompatibility, observeCodexSchema, probeCodexSurface, codexRequiredSurface } from '../src/index.ts'
import type { AgentProfile } from '../../../contracts/src/types.ts'
import type { ProtocolSurface } from '../../../catalog/src/compatibility.ts'

const D = (ch: string) => ch.repeat(64)
const profile: AgentProfile = {
  id: 'profile-codex', revision: 1, driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0',
  executable: '/opt/codex', argv: [], expectedVersion: '0.164.0', nativeConfigRef: 'config-1',
  permissionPolicyRevision: 'policy-1', requiredFeatures: [],
}
const surface = (over: Partial<ProtocolSurface> = {}): ProtocolSurface => ({
  wireVersion: 'codex-app-server-json-schema', schemaDigest: D('b'),
  methods: ['initialize', 'thread/start', 'turn/start', 'turn/steer', 'turn/interrupt'],
  requestFields: {
    initialize: ['clientInfo', 'capabilities'], 'thread/start': ['model', 'approvalPolicy', 'sandbox'],
    'turn/start': ['threadId', 'input'], 'turn/steer': ['threadId', 'expectedTurnId', 'input'],
    'turn/interrupt': ['threadId', 'turnId'],
  },
  enums: {
    'turn/completed': ['failed', 'interrupted', 'completed'],
    'item/started': ['text', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall'],
  },
  notifications: ['item/started', 'item/updated', 'item/completed', 'turn/completed', 'thread/tokenUsage/updated', 'config/changed'],
  serverRequests: ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'],
  requestIdTypes: ['integer', 'string'], ...over,
})
const host = {
  async inspectExecutable() { return { version: '0.164.0', digest: D('a'), evidenceRef: 'exe:0.164.0' } },
  async inspectConfig() { return { fingerprint: D('c'), stability: 'frozen' as const } },
}
const observed = (over: Partial<ProtocolSurface> = {}) => async () => ({ status: 'observed' as const, surface: surface(over), evidenceRefs: ['schema:test'] })

test('exact version with complete surface is unverified-compatible unless original native evidence is supplied', async () => {
  const unverified = await inspectCodexCompatibility(profile, host, { probeSurface: observed() })
  assert.equal(unverified.verdict.class, 'compatible_unverified')
  assert.equal(unverified.verdict.admission, 'trial')
  assert.equal(unverified.report.readiness, 'inspection_passed')
  assert.ok(!unverified.report.evidenceRefs.includes('native_test_passed'))
  const verified = await inspectCodexCompatibility(profile, host, {
    probeSurface: observed(),
    verifiedVersions: [{ profileId: profile.id, profileRevision: profile.revision, driverId: profile.driverId,
      nativeVersion: '0.164.0', executableDigest: D('a'), driverRelease: profile.driverRelease,
      wireVersion: 'codex-app-server-json-schema', schemaDigest: D('b'), evidenceRef: 'native:run-1' }],
  })
  assert.equal(verified.verdict.class, 'verified')
  assert.equal(verified.verdict.nativeTestPassed, true)
})

test('a missing field/method is incompatible and unknown probe stays disabled', async () => {
  const broken = await inspectCodexCompatibility(profile, host, { probeSurface: observed({ methods: ['initialize'], requestFields: { initialize: ['clientInfo'] } }) })
  assert.equal(broken.verdict.class, 'incompatible')
  assert.equal(broken.report.readiness, 'incompatible')
  const unknown = await inspectCodexCompatibility(profile, host, { probeSurface: async () => ({ status: 'timeout', reason: 'probe timeout', evidenceRefs: [] }) })
  assert.equal(unknown.verdict.class, 'unknown')
  assert.equal(unknown.verdict.admission, 'disabled')
})

test('schema parser reads real fields/enums/notifications/request ids, not just method names', () => {
  const defs = {
    InitializeParams: { type: 'object', properties: { clientInfo: { type: 'object' }, capabilities: { type: 'object' } }, required: ['clientInfo'] },
    ThreadStartParams: { type: 'object', properties: { model: { type: ['string', 'null'] }, approvalPolicy: { type: 'string' }, sandbox: { type: 'string' } } },
    TurnStartParams: { type: 'object', properties: { threadId: { type: 'string' }, input: { type: 'array' } } },
    TurnSteerParams: { type: 'object', properties: { threadId: { type: 'string' }, expectedTurnId: { type: 'string' }, input: { type: 'array' } } },
    TurnInterruptParams: { type: 'object', properties: { threadId: { type: 'string' }, turnId: { type: 'string' } } },
    TurnCompletedParams: { type: 'object', properties: { turn: { type: 'object', properties: { status: { enum: ['failed', 'interrupted', 'completed'] } } } } },
    ItemStartedParams: { type: 'object', properties: { item: { type: 'object', properties: { type: { enum: ['text', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall'] } } } } },
  }
  const req = (method: string, ref: string) => ({ properties: { id: { $ref: '#/definitions/RequestId' }, method: { enum: [method] }, params: { $ref: `#/definitions/${ref}` } } })
  const note = (method: string, ref: string) => ({ properties: { method: { enum: [method] }, params: { $ref: `#/definitions/${ref}` } } })
  const parsed = observeCodexSchema({
    clientRequest: { definitions: defs, oneOf: [req('initialize', 'InitializeParams'), req('thread/start', 'ThreadStartParams'), req('turn/start', 'TurnStartParams'), req('turn/steer', 'TurnSteerParams'), req('turn/interrupt', 'TurnInterruptParams')] },
    serverRequest: { definitions: defs, oneOf: [{ properties: { method: { enum: ['item/commandExecution/requestApproval'] } } }, { properties: { method: { enum: ['item/tool/requestUserInput'] } } }] },
    serverNotification: { definitions: defs, oneOf: [note('turn/completed', 'TurnCompletedParams'), note('item/started', 'ItemStartedParams'), note('item/updated', 'ItemStartedParams'), note('item/completed', 'ItemStartedParams'), note('thread/tokenUsage/updated', 'ItemStartedParams'), note('config/changed', 'ItemStartedParams')] },
    requestId: { definitions: {}, anyOf: [{ type: 'integer' }, { type: 'string' }] },
  })
  assert.deepEqual(parsed.requestFields['turn/steer'], ['expectedTurnId', 'input', 'threadId'])
  assert.deepEqual(parsed.enums['turn/completed'], ['completed', 'failed', 'interrupted'])
  assert.ok(parsed.notifications.includes('config/changed'))
  assert.deepEqual(parsed.requestIdTypes, ['integer', 'string'])
  assert.match(parsed.schemaDigest, /^[a-f0-9]{64}$/)
})

test('probe executes only version + schema generation against the given executable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pa-fake-codex-'))
  const script = join(dir, 'codex')
  const schemaDir = join(dir, 'schemas')
  const files = {
    'ClientRequest.json': { definitions: { InitializeParams: { type: 'object', properties: { clientInfo: {}, capabilities: {} } } }, oneOf: [{ properties: { method: { enum: ['initialize'] }, params: { $ref: '#/definitions/InitializeParams' } } }] },
    'ServerRequest.json': { oneOf: [{ properties: { method: { enum: ['item/commandExecution/requestApproval'] } } }] },
    'ServerNotification.json': { oneOf: [{ properties: { method: { enum: ['turn/completed'] } } }] },
    'RequestId.json': { anyOf: [{ type: 'integer' }, { type: 'string' }] },
  }
  try {
    await writeFile(script, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi
out=""
while [ $# -gt 0 ]; do if [ "$1" = "--out" ]; then out="$2"; shift 2; else shift; fi; done
mkdir -p "$out"
${Object.entries(files).map(([name, body]) => `cat > "$out/${name}" <<'JSON'\n${JSON.stringify(body)}\nJSON`).join('\n')}
`)
    await chmod(script, 0o755)
    const probe = await probeCodexSurface({ executable: script })
    assert.equal(probe.status, 'observed')
    if (probe.status === 'observed') {
      assert.ok(probe.surface.methods.includes('initialize'))
      assert.ok(probe.surface.notifications.includes('turn/completed'))
    }
    const missing = await probeCodexSurface({ executable: join(dir, 'absent') })
    assert.equal(missing.status, 'missing')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
