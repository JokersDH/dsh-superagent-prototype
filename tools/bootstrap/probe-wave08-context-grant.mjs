import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Read-only consumer probe against an explicit candidate checkout, with no model or ledger access.
const candidateRoot = process.argv[2]
if (!candidateRoot) throw new Error('Usage: node tools/bootstrap/probe-wave08-context-grant.mjs <candidate-root>')
const { ContextComposer } = await import(pathToFileURL(resolve(candidateRoot, 'packages/context/src/composer.ts')).href)
const now = '2026-11-11T08:00:00.000Z'
const scope = { projectId: 'probe-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const baseGrant = { grantId: 'probe-grant', projectId: scope.projectId, scope, gateway: 'conversation', purpose: 'conversation_discussion',
  sourceKinds: ['decision'], maxFiles: 1, maxBytes: 32, maxTokens: 32, maxDurationMs: 1000,
  confirmedAt: '2026-11-11T07:00:00.000Z', confirmedBy: 'local-user', expiresAt: '2026-11-11T09:00:00.000Z' }
const results = []
for (const kind of ['valid_control', 'expired_grant', 'budget_above_grant', 'purpose_mismatch']) {
  let reads = 0, returnedBytes = 0, errorCode = null
  const grant = { ...baseGrant, ...(kind === 'valid_control' ? { maxBytes: 4096, maxTokens: 4096 } : {}),
    ...(kind === 'expired_grant' ? { expiresAt: '2026-11-10T09:00:00.000Z' } : {}) }
  const port = { projectBaseline: async () => ({ capturedAt: now }), listSources: async () => [],
    readSource: async () => { throw new Error('No file source is part of this decision-only probe') } }
  const composer = new ContextComposer({ port, decisions: { listEffective: async () => {
    reads++
    return { decisions: [{ decisionId: 'decision-probe', content: 'x'.repeat(1000), scope, sourceMessageId: 'source-probe', recordedAt: now }] }
  } } }, { now: () => new Date(now) })
  try {
    const composition = await composer.compose({ requestId: `probe-${kind}`, projectId: scope.projectId,
      purpose: kind === 'purpose_mismatch' ? 'work_authoring' : 'conversation_discussion', query: '', grant,
      budget: { maxFiles: 10, maxSlices: 10, maxBytes: 4096, maxTokens: 4096, maxDurationMs: 5000 },
      groups: [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }] })
    returnedBytes = composition.totals.bytes
  } catch (error) { errorCode = error?.code ?? error?.name ?? 'unknown' }
  const passed = kind === 'valid_control' ? reads === 1 && returnedBytes > 0 && errorCode === null
    : kind === 'budget_above_grant' ? returnedBytes <= grant.maxBytes &&
      (errorCode === null || ['invalid_input', 'composition_invalid', 'budget_exceeded'].includes(errorCode))
      : reads === 0 && errorCode === (kind === 'expired_grant' ? 'grant_expired' : 'grant_purpose')
  results.push({ kind, status: passed ? 'PASS' : 'FAIL', reads, returnedBytes, grantBytes: grant.maxBytes, errorCode })
}
const passed = results.every(result => result.status === 'PASS')
console.log(JSON.stringify({ status: passed ? 'PASS_CONTEXT_GRANT_BOUNDARY' : 'FAIL_CONTEXT_GRANT_BOUNDARY', results, modelCalls: 0, writes: 0 }, null, 2))
if (!passed) process.exitCode = 1
