import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-23/dispatch.json'))
const prior = JSON.parse(read('agent-tasks/product-wave-22/dispatch.json'))
const pilot = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
const integration = JSON.parse(read('reports/releases/wave23-integration/status.json'))
assert.equal(plan.wave, 'product-wave-23'); assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
for (const source of [plan.reviewBaseline, plan.observedMain, plan.productRuntimeSource]) assert.match(source, /^[a-f0-9]{40}$/)
for (const field of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[field], 0)
for (const field of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[field], false)
for (const field of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[field], true)
assert.equal(plan.checkpointsPerOwner, 3); assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const inputs = plan.providedInputs
for (const field of ['sourceConfirmImplemented', 'scopeDiagnosticImplemented', 'ordinaryDistributionIntegrated', 'cleanSourceStage', 'aSameProcessOriginalFactsPassed', 'cActualScopeDiagnosticPassed', 'cDualFormatStandardStartPassed', 'bActualBusinessChannelSourceExists', 'bNewModuleStrictPassed', 'bOldEndpointControlPassed', 'dSourceClosureOneProbeHashStale', 'eMeasured595Preserved']) assert.equal(inputs[field], true, field)
for (const field of ['scopeDiagnosticUiImplemented', 'cleanStageIsIndependentInstalledAdmission', 'aNewProcessReadbackProven', 'cDriverStrictResultsIdentityDeadlinesAdmitted', 'bFirstHandoverAdmitted', 'bFactsIdentityAndBoundedReplayAdmitted', 'bFactSinkBrokerRebindingImplemented', 'bBusinessRecoveryImplemented', 'privatePermissionImplemented', 'targetActivationImplemented', 'dProbeFailureCleanupAdmitted', 'dRealDualSnapshotOriginalBrokerIdentityProven', 'eWholeRequiredGateCompletenessAdmitted', 'eNewA9bInstalledAdmission', 'eNewMainInstalledAdmission']) assert.equal(inputs[field], false, field)
assert.equal(inputs.ordinaryDistributionSource, plan.productRuntimeSource)
assert.equal(inputs.ordinaryImportedFiles, 71)
assert.equal(integration.source, plan.productRuntimeSource)
assert.equal(integration.importedFiles, 71); assert.equal(integration.originalByteMatches, 70)
assert.equal(integration.files.length, 71)
assert.equal(integration.files.filter(file => file.matchesOriginal).length, 70)
for (const file of integration.files) { assert.match(file.sha256, /^[a-f0-9]{64}$/); assert.ok(existsSync(resolve(root, file.path)), file.path) }
assert.equal(integration.checks.portabilityTests + integration.checks.launcherTests, 112)
assert.equal(integration.cleanBuild.source.dirty, false)
assert.equal(integration.cleanBuild.buildId, inputs.cleanStageBuildId)
assert.equal(integration.cleanBuild.productSchema, 18); assert.equal(integration.cleanBuild.installEntries, 6747)
for (const field of ['frozenTarCreated', 'independentInstalledAdmission', 'uiUpdated', 'userServicesRestarted', 'releaseApproved']) assert.equal(integration[field], false)
for (const field of ['realModelTurns', 'nativeTurnStarts', 'migrationsAdded']) assert.equal(integration[field], 0)
assert.equal(inputs.dArtifact.source, 'a9b155c13be197d828544a26f4827cf9d4acab68')
assert.equal(inputs.dArtifact.sha256, '413dee2fb2692334a519899fc9298fd0771b5c865a34a595d1efc3b4b3b1d650')
assert.equal(inputs.dArtifact.independentInstalledEAdmission, false)
assert.equal(inputs.eMeasured595.subjectSource, '595b3f138872f176b7c6b214b4b6b1b87c1ed017')
assert.deepEqual(inputs.eMeasured595.counts, { PASS: 200, FAIL: 0, NOT_TESTED: 15 })
assert.notEqual(inputs.dArtifact.source, inputs.eMeasured595.subjectSource)
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'main'])
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  assert.deepEqual(role.phases, Array.from({ length: 10 }, (_, i) => `${prefix}${i + 1}`))
  for (const phase of role.phases) assert.ok(packet.includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.ok(packet.includes('## 独立备选队列'), role.packet)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  assert.equal(role.branch, prior.roles[id].branch); assert.equal(role.workdir, prior.roles[id].workdir)
  if (role.candidate) assert.match(role.candidate, /^[a-f0-9]{40}$/)
  assert.ok(role.evidencePath.startsWith(id === 'main' ? 'reports/releases/' : role.ownedPaths.find(path => role.evidencePath.startsWith(path)) ?? '__outside_owner__'))
}
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++)
  for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) assert.ok(!a.startsWith(b) && !b.startsWith(a), `${roles[i][0]} / ${roles[j][0]} overlapping owners`)
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
for (const id of ['D-current-bytes', 'D-same-data-dual', 'E-current-package', 'E-ordinary-verdict'])
  for (const dep of ['B-resumed-business', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by unrelated ${dep}`)
for (const dep of ['D-current-bytes', 'E-complete-reuse-gate']) assert.ok(ancestors('E-current-package').has(dep))
assert.ok(!ancestors('D-current-bytes').has('E-current-package'))
for (const dep of ['B-safe-attach', 'M-attach-consumer']) assert.ok(ancestors('B-resumed-business').has(dep))
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[field], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[field], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary,
  'docs/rfcs/WP-16/0060-main-ordinary-distribution-source-integration.md', 'docs/guides/main-distribution.zh-CN.md',
  'reports/releases/wave23-admission/README.zh-CN.md', 'reports/releases/wave23-integration/README.zh-CN.md',
  'agent-tasks/product-wave-23/README.zh-CN.md', 'agent-tasks/product-wave-23/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
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
for (const path of ['reports/releases/wave23-admission/context.json', 'reports/releases/wave23-admission/runtime.json', 'reports/releases/wave23-admission/delivery.json']) assert.ok(existsSync(resolve(root, path)), path)
console.log(JSON.stringify({ status: 'PASS_LONG_DISPATCH_STATIC_ONLY', roles: roles.length, phases: 60,
  checkpoints: visited.size, localLinks: links, acyclic: true, nonoverlappingOwners: true,
  ordinaryDistributionSourceIntegrated: true, bActualNewChannelSourceRecognized: true, bHandoverStillRequired: true,
  measured595Preserved: true, newArtifactVerdictStillRequired: true, eCompletenessGateStillRequired: true,
  ordinaryInstallIndependentOfActivation: true, budgetUnchanged: true, preservedServicePairs: 12,
  runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
