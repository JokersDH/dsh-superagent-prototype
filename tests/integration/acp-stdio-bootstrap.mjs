/** Explicit zero-model native setup probe. It never sends session/prompt or a positive permission. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { ProcessHost } from '../../apps/runner/src/process-host.ts'
import { installDshAcpPolicy, inspectDshAcpProfile } from '../../packages/drivers/acp-v1/native-policies/dsh-policy-installation.mjs'
import { createDshAcpPolicyHost } from '../../packages/drivers/acp-v1/native-policies/dsh-policy-host.mjs'
import { AcpV1SettingsSchema, acpStream, acpV1ConformanceDeclaration, deadline } from '../../packages/drivers/acp-v1/src/index.ts'
import { attemptIdentity } from '../../packages/driver-kit/src/index.ts'
import { makeAttemptSpec } from '../../packages/testing/src/fixtures.ts'

const { values } = parseArgs({ options: { execute: { type: 'boolean', default: false }, 'dsh-entry': { type: 'string' } } })
if (!values.execute) {
  console.log('NOT_RUN: pass --execute for an owned, private, initialize/session-new-only DSH setup probe; model turns and signals are zero.')
} else {
  const root = mkdtempSync(join(tmpdir(), 'pa-acp-stdio-')), workspace = join(root, 'workspace')
  mkdirSync(workspace, { mode: 0o700 })
  const nodeExecutable = realpathSync(process.execPath)
  const dshEntry = values['dsh-entry'] ?? join(dirname(dirname(nodeExecutable)), 'lib/node_modules/@deepseek-ai/dsh/lib/bin.js')
  const require = createRequire(new URL('../../packages/drivers/acp-v1/package.json', import.meta.url))
  const { client, methods, PROTOCOL_VERSION } = await import(require.resolve('@agentclientprotocol/sdk'))
  const syntheticKey = 'controlled-local-trap-only-no-vendor-credential'
  const methodsWritten = [], payloads = new Map()
  let modelRequests = 0, connection, child, originalIdentity, stderr = '', exited
  const trap = createServer((request, response) => {
    modelRequests++
    request.resume(); response.writeHead(503, { 'content-type': 'application/json' })
    response.end('{"error":{"message":"No model request is permitted in this setup probe"}}')
  })
  const result = { scope: 'native DSH stdio and policy setup only; no original product Work or dispatch authority',
    status: 'UNKNOWN', root, methodsWritten, modelRequests: 0, modelTurns: 0, signals: 0,
    physicalQuiescenceProven: false, steps: [] }
  const host = new ProcessHost({ resolveCwd: () => workspace })
  try {
    await new Promise((resolve, reject) => { trap.once('error', reject); trap.listen(0, '127.0.0.1', resolve) })
    const address = trap.address()
    assert(address && typeof address !== 'string')
    assert(!((address.port >= 5180 && address.port <= 5191) || (address.port >= 8796 && address.port <= 8807)))
    const installed = await installDshAcpPolicy({ connectionRoot: join(root, 'connection'), profileId: 'profile-acp-owned-setup-probe',
      nodeExecutable, dshEntry, model: { id: 'controlled-no-completion-model', baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: syntheticKey } })
    result.steps.push('native_module_policy_and_model_configuration')
    const identity = inspectDshAcpProfile(installed.profile)
    const spec = { ...makeAttemptSpec(), profile: installed.profile }
    const settings = AcpV1SettingsSchema.parse({ kind: 'acp-v1-settings/1', workspacePath: workspace,
      scope: { projectId: 'controlled-native-setup', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }, timeoutMs: 10000 })
    const io = { runtime: host, payloads: {
      async read(ref) { assert(payloads.has(ref)); return payloads.get(ref) },
      async store(value) { const ref = `controlled-policy-payload-${payloads.size + 1}`; payloads.set(ref, value); return ref },
    }, commands: (async function* () {})(), record() { throw new Error('This probe cannot create a durable product receipt') }, publishProgress() {} }
    const policyHost = createDshAcpPolicyHost({ runtime: host })
    await policyHost.beforeSpawn({ spec, settings, io })
    child = await host.spawn({ executable: installed.profile.executable, argv: [...installed.profile.argv],
      cwdRef: 'controlled-native-setup-workspace', environmentRef: 'controlled-native-setup' })
    originalIdentity = host.originalIdentity(child.resourceRef)
    assert(originalIdentity, 'original immutable spawn identity is required')
    writeFileSync(join(root, 'original-spawn.json'), JSON.stringify({ resourceRef: child.resourceRef, identity: originalIdentity,
      workspace, profile: installed.profile }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    void (async () => { for await (const chunk of child.stderr) if (stderr.length < 16384) stderr += Buffer.from(chunk).toString('utf8') })().catch(() => undefined)
    const app = client({ name: 'personal-agent-owned-setup-probe' })
    connection = app.connect(acpStream({ resourceRef: child.resourceRef, stdout: child.stdout,
      write: bytes => host.write(child.resourceRef, bytes) }, {
      beforeBytesWrite(message) {
        if ('method' in message) {
          assert(['initialize', 'session/new', '$/cancel_request'].includes(message.method), 'setup may not send business methods')
          methodsWritten.push(message.method)
        } else if ('result' in message) throw new Error('Setup may not approve an unsolicited request')
      },
    }))
    const initialized = await deadline(connection.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {}, clientInfo: { name: 'personal-agent-owned-setup-probe', version: '0.1.0' } }), 10000, 'initialize_timeout')
    assert.equal(initialized.protocolVersion, 1)
    result.steps.push('standard_initialize')
    result.agentInfo = initialized.agentInfo
    result.advertisedCapabilities = initialized.agentCapabilities
    result.nativeVersion = identity.nativeVersion
    const declaration = acpV1ConformanceDeclaration({ protocolVersion: initialized.protocolVersion,
      agentName: initialized.agentInfo?.name, agentVersion: initialized.agentInfo?.version,
      capabilities: initialized.agentCapabilities ?? {}, evidenceRefs: ['actual-owned-standard-initialize'] })
    result.sdkVersion = declaration.sdkVersion
    result.sdkEntrypoint = declaration.sdkEntrypoint
    result.schemaDigest = declaration.schemaDigest
    result.capabilityEvidence = { initialize: 'observed', sessionNew: 'NOT_TESTED',
      prompt: 'NOT_TESTED', permission: 'NOT_TESTED', runningCancel: 'NOT_TESTED', resume: 'NOT_TESTED', model: 'NOT_TESTED' }
    const session = await deadline(connection.agent.request(methods.agent.session.new, { cwd: workspace, mcpServers: [] }), 10000, 'session_setup_timeout')
    result.steps.push('standard_session_new_without_prompt')
    result.capabilityEvidence.sessionNew = 'observed'
    const input = { spec, settings, io, initialized, session, resourceRef: child.resourceRef }
    const prepared = await policyHost.prepare(input)
    for (const [field, value] of Object.entries(attemptIdentity(spec))) assert.deepEqual(prepared.policy[field], value)
    assert.equal(prepared.policy.enforcement, 'enforced')
    assert.equal(prepared.policy.verification, 'passed')
    assert.equal(await policyHost.currentFingerprint(input), prepared.currentFingerprint)
    result.steps.push('actual_original_process_and_guard_policy_binding')
    result.status = 'PASS_SETUP_ONLY'
  } catch (error) {
    result.status = 'FAIL_SETUP_ONLY'
    const message = error instanceof Error ? error.message : ''
    result.reason = /^(?:dsh-policy|acp-connection):[a-z0-9_]+$/.test(message) ? message : 'native_bootstrap_or_policy_setup_failed'
  } finally {
    connection?.close()
    if (child) {
      try { await host.closeInput(child.resourceRef) } catch { result.stdinEOF = 'unknown' }
      exited = await Promise.race([child.exited, new Promise(resolve => setTimeout(() => resolve(undefined), 2500))])
      result.leaderExit = exited ?? 'UNKNOWN'
      if (!exited || exited.code !== 0 || exited.signal !== null) result.status = 'UNKNOWN_EXIT'
    }
    await new Promise(resolve => trap.close(resolve))
    result.modelRequests = modelRequests
    if (modelRequests !== 0) result.status = 'FAIL_UNEXPECTED_MODEL_REQUEST'
    // Keep the entire original private setup/material. A leader exit alone never proves the full
    // owned resource group quiescent, so this probe does not delete or release anything by inference.
    if (stderr) writeFileSync(join(root, 'private-stderr.log'), stderr.replaceAll(syntheticKey, '<REDACTED>'), { flag: 'wx', mode: 0o600 })
    writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.status === 'PASS_SETUP_ONLY' ? 0 : 1
    if (child && !exited) process.exit(1) // End this probe controller normally; preserve its exact unknown owned child record.
  }
}
