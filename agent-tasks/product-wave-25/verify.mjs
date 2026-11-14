import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-25/dispatch.json'))
const prior = JSON.parse(read('agent-tasks/product-wave-24/dispatch.json'))
const workspaces = JSON.parse(read('agent-tasks/product-wave-25/workspaces.json'))
const integration = JSON.parse(read('reports/releases/wave25-integration/status.json'))
const pilot = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
assert.ok(process.argv.slice(2).every(value => value === '--workspaces'))
assert.equal(plan.wave, 'product-wave-25'); assert.equal(plan.date, '2026-11-14'); assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.equal(plan.externalAgentCount, 8); assert.equal(plan.totalOwnersIncludingMain, 9); assert.equal(plan.checkpointsPerOwner, 4)
for (const value of [plan.reviewBaseline, plan.observedMain, plan.productRuntimeSource]) assert.match(value, /^[a-f0-9]{40}$/)
for (const field of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[field], 0)
for (const field of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[field], false)
for (const field of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[field], true)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const inputs = plan.providedInputs
for (const field of ['sourceScopeUiImplemented', 'trialReadinessImplemented', 'newWorktreesPrepared', 'aSubjectCoverageUowBoundsMeasured', 'cReal0edePersonalFlowMeasured', 'bCompleteCommandTupleMeasured', 'bKnownRefLargePayloadMeasured', 'dOldRegistrationIdentityFixesMeasured', 'dClosure87Matches', 'eOldCapabilityAndCountFixesMeasured']) assert.equal(inputs[field], true, field)
for (const field of ['trialReadinessUiImplemented', 'fghFeaturesImplemented', 'aManifestSingleDriverSamePackageProven', 'cRequiredPackageIdentityOmissionsClosed', 'bDiscoverableLargeFactsAdmitted', 'bPayloadProducerIdentityAdmitted', 'bActualRebindAndDualClientAdmitted', 'bBusinessRecoveryImplemented', 'dEverySignalFreshAndCompleteAdmitted', 'eActualOptInHttpObservationGateAdmitted', 'eFinal3bUiInstalledAdmission', 'eReadinessArtifactAdmission', 'privatePermissionImplemented', 'targetActivationImplemented']) assert.equal(inputs[field], false, field)
assert.equal(inputs.trialReadinessSource, plan.productRuntimeSource); assert.equal(inputs.trialReadinessAuthorization, 'none')
assert.equal(integration.source, plan.productRuntimeSource); assert.equal(integration.readinessAuthorization, 'none')
assert.equal(integration.configurationOnly, true); assert.equal(integration.checks.cleanCombinedCases, 28)
assert.equal(integration.checks.newContractCases + integration.checks.newTransportCases + integration.checks.newReadinessHttpCases, 10)
assert.equal(integration.checks.contractsPackageCases, 232)
for (const field of ['newUiImplemented', 'userServicesRestarted', 'newPersonalPreviewStarted', 'frozenTarCreated', 'independentInstalledAdmission', 'releaseApproved']) assert.equal(integration[field], false)
for (const field of ['migrationsAdded', 'realModelTurns', 'nativeTurnStarts']) assert.equal(integration[field], 0)
assert.equal(inputs.dArtifact.source, '3b2ff68b4785e79757fc1dcd14b17f5dd84d0c62')
assert.equal(inputs.dArtifact.sha256, 'f04abb1b4c4ae47a52f6bc1aa172d70c4a113219f443f354aee0ebffc8a00494')
assert.equal(inputs.dArtifact.verifiedEntries, 6748); assert.equal(inputs.dArtifact.eFinalVerdictForThisArtifact, 'NOT_REACHED')
assert.equal(inputs.eMeasured0ede.subjectSource, '0ede11d0a46f377e90657c78b001357c98d4f5e7')
assert.deepEqual(inputs.eMeasured0ede.counts, { PASS: 223, FAIL: 0, NOT_TESTED: 16 })
assert.notEqual(inputs.dArtifact.source, inputs.eMeasured0ede.subjectSource)
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'main'])
const inside = (path, rule) => rule.endsWith('/') ? path.startsWith(rule) : path === rule
const owned = (role, path) => role.ownedPaths.some(rule => inside(path, rule)) && !(role.excludedOwnedPaths ?? []).some(rule => inside(path, rule))
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  assert.deepEqual(role.phases, Array.from({ length: 16 }, (_, i) => `${prefix}${i + 1}`))
  assert.deepEqual(role.milestones, [4, 8, 12, 16].map(value => `${prefix}${value}`))
  for (const phase of role.phases) assert.ok(packet.includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.equal((packet.match(new RegExp(`^## ${prefix}\\d+ `, 'gm')) ?? []).length, 16)
  assert.ok(packet.includes('## 独立备选队列'), role.packet); assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  if (prior.roles[id]) { assert.equal(role.branch, prior.roles[id].branch); assert.equal(role.workdir, prior.roles[id].workdir) }
  if (['A', 'B', 'C', 'D', 'E'].includes(id)) assert.match(role.candidate, /^[a-f0-9]{40}$/)
  if (['F', 'G', 'H'].includes(id)) {
    assert.equal(role.preparedFrom, plan.productRuntimeSource); assert.equal(role.implementationStatus, 'NOT_STARTED_WORKSPACE_PREPARED')
    assert.equal(workspaces.roles[id].newlyPrepared, true); assert.ok(role.branch.startsWith('codex/g4-'))
  }
  assert.equal(workspaces.roles[id].workdir, role.workdir); assert.equal(workspaces.roles[id].branch, role.branch)
  assert.ok(id === 'main' ? role.evidencePath.startsWith('reports/releases/') : owned(role, role.evidencePath))
}
assert.deepEqual(plan.roles.main.excludedOwnedPaths, ['apps/console/src/trial/', 'apps/console/test/trial/', 'apps/console/e2e/trial/'])
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const intersection = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], intersection) || !owned(roles[j][1], intersection), `${roles[i][0]} / ${roles[j][0]} overlapping owners at ${intersection}`)
}
assert.equal(owned(plan.roles.main, 'apps/console/src/App.tsx'), true)
assert.equal(owned(plan.roles.main, 'apps/console/src/transport.ts'), true)
assert.equal(owned(plan.roles.main, 'apps/console/src/trial/TrialWorkspace.tsx'), false)
assert.equal(owned(plan.roles.F, 'apps/console/src/trial/TrialWorkspace.tsx'), true)
assert.equal(owned(plan.roles.F, 'apps/console/src/App.tsx'), false)
assert.equal(workspaces.externalAgentCount, 8)
for (const field of ['createdUserThreads', 'externalPromptsSent', 'newRootsCopyUntrackedOrUserState']) assert.equal(workspaces[field], false)
assert.equal(workspaces.nativeModelAllowanceAdded, 0)
const active = new Set(), visited = new Set()
function visit(id) {
  const node = plan.checkpoints[id]
  assert.ok(node, `Missing checkpoint ${id}`); assert.ok(!active.has(id), `Dependency cycle ${id}`)
  if (visited.has(id)) return
  assert.ok(plan.roles[node.owner]); active.add(id)
  for (const dep of node.dependsOn) visit(dep)
  active.delete(id); visited.add(id)
}
for (const id of Object.keys(plan.checkpoints)) visit(id)
function ancestors(id, result = new Set()) {
  for (const dep of plan.checkpoints[id].dependsOn) if (!result.has(dep)) { result.add(dep); ancestors(dep, result) }
  return result
}
for (const id of ['F-component', 'G-pure-api-cli', 'H-preflight-cli', 'D-current-readiness-bytes', 'E-current-package', 'E-ordinary-verdict'])
  for (const dep of ['B-resumed-business', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by unrelated ${dep}`)
for (const dep of ['D-current-readiness-bytes', 'E-http-observation-gate']) assert.ok(ancestors('E-current-package').has(dep))
assert.ok(!ancestors('D-current-readiness-bytes').has('E-current-package'))
assert.ok(!ancestors('D-current-readiness-bytes').has('D-fresh-signal-completeness'))
assert.ok(ancestors('D-composed-data-restores').has('D-fresh-signal-completeness'))
assert.ok(ancestors('F-actual-journey').has('M-trial-composition'))
assert.ok(ancestors('B-resumed-business').has('B-rebound-dual-client'))
for (const id of ['M-readiness-http', 'A-subject-helper', 'C-real0ede-personal', 'B-tuple-known-payload', 'D-3b-frozen', 'E-0ede-measured']) assert.equal(plan.checkpoints[id].providedByReviewedSource, true, id)
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[field], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[field], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary, plan.sharedInputBoundary,
  'reports/releases/wave25-admission/README.zh-CN.md', 'reports/releases/wave25-integration/README.zh-CN.md',
  'agent-tasks/product-wave-25/README.zh-CN.md', 'agent-tasks/product-wave-25/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
let links = 0
for (const path of [...plan.contracts, plan.completionEstimateRef, ...files]) assert.ok(existsSync(resolve(root, path)), path)
for (const path of files) {
  const content = read(path); assert.equal((content.match(/^\s*```/gm) ?? []).length % 2, 0, path)
  for (const match of content.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '')
    if (/^(https?:|obsidian:|mailto:|#)/.test(target)) continue
    target = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '')
    if (!target || target.includes(' ')) continue
    assert.ok(existsSync(resolve(root, dirname(path), target)), `${path} -> ${target}`); links++
  }
}
let localWorkspaces = 0
if (process.argv.includes('--workspaces')) for (const [id, role] of roles) {
  const actual = execFileSync('git', ['-C', role.workdir, 'branch', '--show-current'], { encoding: 'utf8' }).trim()
  assert.equal(actual, role.branch, `${id} branch`)
  if (['F', 'G', 'H'].includes(id)) {
    execFileSync('git', ['-C', role.workdir, 'merge-base', '--is-ancestor', role.preparedFrom, 'HEAD'])
    assert.ok(existsSync(resolve(role.workdir, role.packet)), `${id} needs latest origin/main packet`)
  }
  localWorkspaces++
}
console.log(JSON.stringify({ status: 'PASS_EIGHT_AGENT_DISPATCH_STATIC_ONLY', externalAgents: 8, ownersIncludingMain: roles.length,
  phases: 144, milestonesPerOwner: 4, checkpoints: visited.size, localLinks: links, localWorkspacesChecked: localWorkspaces,
  acyclic: true, nonoverlappingOwnersWithExplicitTrialExclusions: true, actualReadinessInputPublished: true,
  fghFeaturesStillPlanned: true, ordinaryWorkIndependentOfRecovery: true, budgetUnchanged: true,
  preservedServicePairs: 12, runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
