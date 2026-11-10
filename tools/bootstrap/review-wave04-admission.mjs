import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { DecisionGovernance, InMemoryDecisionStore, StaticDecisionSourcePort } from '../../packages/knowledge/dist/index.js'
import { ProposalRegistry } from '../../packages/proposals/dist/index.js'

const { values } = parseArgs({ options: { 'acceptance-root': { type: 'string' }, output: { type: 'string', default: 'reports/releases/product-wave-04/admission.json' } } })
const cases = []
const check = async (id, owner, run) => {
  try { const actual = await run(); cases.push({ id, owner, status: actual.ok ? 'PASS' : 'FAIL', ...actual }) }
  catch (error) { cases.push({ id, owner, status: 'ERROR', message: error.message }) }
}
const scope = { projectId: 'admission-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
await check('C-MISSING-SOURCE-EFFECTIVENESS', 'C', async () => {
  const sources = new StaticDecisionSourcePort([{ messageId: 'admission-message', conversationId: 'admission-conversation',
    projectId: scope.projectId, role: 'user', provenance: 'trusted_user', createdAt: '2026-11-10T00:00:00.000Z', textDigest: 'a'.repeat(64) }])
  const governance = new DecisionGovernance(new InMemoryDecisionStore(), sources)
  await governance.record({ decisionId: 'admission-decision', content: 'Explicit fixture decision', scope,
    sourceMessageId: 'admission-message' }, { actorRef: 'admission-user', projectId: scope.projectId })
  sources.markMissing('admission-message')
  const actual = { effective: await governance.isEffective('admission-decision'), listCount: (await governance.listEffective(scope.projectId)).length }
  return { ok: !actual.effective && actual.listCount === 0, actual, expected: { effective: false, listCount: 0 } }
})
await check('C-CONFIRMED-REPLAY-STILL-AUTHENTICATES', 'C', async () => {
  const registry = new ProposalRegistry()
  const record = registry.create({ proposalId: 'admission-proposal', payload: { kind: 'propose_work', goal: 'Fixture goal',
    projectId: scope.projectId, sourceMessageId: 'admission-message' }, trusted: { actorRef: 'admission-user', projectId: scope.projectId,
    grant: { grantId: 'admission-grant', scope }, sourceMessageId: 'admission-message' } })
  const input = { expectedVersion: record.version, expectedDigest: record.payloadDigest, actorRef: 'admission-user', barrier: () => ({ ok: true }) }
  registry.confirm(record.proposalId, input)
  let refused = false
  try { registry.confirm(record.proposalId, { ...input, actorRef: 'foreign-user' }) } catch { refused = true }
  return { ok: refused, actual: { foreignActorRefused: refused }, expected: { foreignActorRefused: true } }
})
await check('C-PROPOSAL-SNAPSHOTS-GRANT', 'C', async () => {
  const mutableScope = structuredClone(scope), registry = new ProposalRegistry()
  const record = registry.create({ proposalId: 'immutable-proposal', payload: { kind: 'propose_work', goal: 'Fixture goal',
    projectId: scope.projectId, sourceMessageId: 'admission-message' }, trusted: { actorRef: 'admission-user', projectId: scope.projectId,
    grant: { grantId: 'admission-grant', scope: mutableScope }, sourceMessageId: 'admission-message' } })
  mutableScope.allowedPaths.push('private/')
  const changed = record.grantScope.allowedPaths.includes('private/')
  return { ok: !changed, actual: { callerChangedStoredGrant: changed }, expected: { callerChangedStoredGrant: false } }
})
if (values['acceptance-root']) {
  const root = resolve(values['acceptance-root'])
  const { evaluateRelease, REPORT_SCHEMA } = await import(pathToFileURL(resolve(root, 'tests/product-acceptance/lib/release.mjs')))
  const { tier } = await import(pathToFileURL(resolve(root, 'tests/product-acceptance/lib/release-requirements.mjs')))
  const { LAYERS } = await import(pathToFileURL(resolve(root, 'tests/product-acceptance/lib/status.mjs')))
  await check('E-FULL-PRODUCT-REQUIRES-EXECUTED-NATIVE', 'E', async () => {
    const requirement = tier('full-product'), commit = 'a'.repeat(40)
    const report = { schema: REPORT_SCHEMA, source: { commit, dirty: true }, checkedAt: new Date().toISOString(),
      cases: requirement.cases.map(item => ({ id: item.id, status: 'PASS', layer: LAYERS.CONTROLLED,
        assertions: [{ id: 'synthetic-control', ok: true }], evidence: Object.fromEntries((item.evidence ?? []).map(key => [key, key === 'native' ? { executed: false } : {}])) })) }
    const verdict = evaluateRelease({ report, requirement, expectedSource: commit })
    return { ok: verdict.status !== 'PASS', actual: { verdict: verdict.status, dirtySource: true, executedNative: false, layer: LAYERS.CONTROLLED, failures: verdict.failures }, expected: { verdict: 'non-PASS' } }
  })
}
const output = resolve(values.output)
mkdirSync(resolve(output, '..'), { recursive: true })
const report = { status: cases.every(value => value.status === 'PASS') ? 'PASS_ADMISSION_PROBES' : 'FAIL_ADMISSION_PROBES',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checkedAt: new Date().toISOString(),
  ...(values['acceptance-root'] ? { acceptanceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(values['acceptance-root']), encoding: 'utf8' }).trim() } : {}),
  modelCalls: 0, scope: 'Read-only domain/gate probes; no service or native task', cases }
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (report.status !== 'PASS_ADMISSION_PROBES') process.exitCode = 1
