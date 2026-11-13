import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-22/dispatch.json'))
const prior = JSON.parse(read('agent-tasks/product-wave-21/dispatch.json'))
const pilot = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
const integration = JSON.parse(read('reports/releases/wave22-integration/status.json'))
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.equal(plan.wave, 'product-wave-22')
for (const source of [plan.reviewBaseline, plan.observedMain, plan.productRuntimeSource, plan.providedInputs.sourceConfirmSource]) assert.match(source, /^[a-f0-9]{40}$/)
for (const field of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[field], 0)
for (const field of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[field], false)
for (const field of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[field], true)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.equal(plan.checkpointsPerOwner, 3)
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const inputs = plan.providedInputs
for (const field of ['sourceConfirmImplemented', 'explicitWorkflowV2Supported', 'bControlledNormalAnswerApplied', 'bControlledNormalPhysicalStop', 'personalRestoredReadBindingImplemented', 'standardStartReviewImplemented', 'actualHealthReviewIdentityImplemented', 'aNewFixtureStrictPassed', 'cPersonalV1ActualProcessAdmitted', 'actualPersonalV2ProcessAdmitted', 'bOldThreeBoundaryFixesAdmitted', 'bExactWrapperAdmitted', 'bWrapperStrictPassed', 'bWrapperPostCancelProofCorrect', 'bExactControlContractAdmitted', 'bReconcileFourStatesPassed', 'dLauncherReviewReuseCorrect', 'dPackageContainedPrepareAndStartupImplemented', 'ePackageConsumerProvenanceFixAdmitted', 'scopeDiagnosticImplemented', 'scopeDiagnosticOptInOnly', 'eOrdinaryEe24ScopePreserved']) assert.equal(inputs[field], true, field)
for (const field of ['privatePermissionImplemented', 'targetActivationImplemented', 'bBusinessRecoveryImplemented', 'bSubmittedBusinessFeedAvailable', 'reviewReuseRefreshesAuthorization', 'scopeDiagnosticUiImplemented', 'scopeDiagnosticGrantsAuthority', 'sourceConfirmationGrantsStartup', 'readBindingGrantsExecution', 'eWhole26InstalledReviewAdmission', 'eLatest595InstalledAdmission']) assert.equal(inputs[field], false, field)
assert.equal(inputs.scopeDiagnosticSource, plan.productRuntimeSource)
assert.equal(inputs.workflowDefaultFormatVersion, 1)
const artifact = inputs.historicalDArtifact
assert.equal(artifact.source, '595b3f138872f176b7c6b214b4b6b1b87c1ed017')
assert.equal(artifact.buildId, 'cc16eca05e4da244')
assert.equal(artifact.sha256, 'e875b9b90445db5826bf01d72d710fd55b208309598347ca45be618773ae026d')
assert.equal(artifact.schema, 18)
assert.equal(artifact.bytes, 20242124)
for (const field of ['includesPersonalReadStartup', 'includesStrictSelectionReuse', 'includesPackagePrepareCli']) assert.equal(artifact[field], true)
assert.equal(artifact.includesOptionalScopeDiagnostic, false)
assert.equal(inputs.eWholeInstalledFinalTargetSource, 'e4e0623dcb6d90318939f9613f9251ff73fcc602')
assert.equal(inputs.eWholeInstalledFinalVerdict, 'FAIL_AT_OLD_ARTIFACT_REUSE')
assert.equal(integration.source, plan.productRuntimeSource)
assert.equal(integration.checks.cleanCombinationTests, 48)
assert.equal(integration.authorization, 'none')
for (const field of ['uiUpdated', 'releaseApproved', 'userServicesRestarted', 'newPreviewStarted']) assert.equal(integration[field], false)
for (const field of ['realModelTurns', 'nativeTurnStarts', 'migrationsAdded']) assert.equal(integration[field], 0)
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'main'])
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  assert.deepEqual(role.phases, Array.from({ length: 10 }, (_, i) => `${prefix}${i + 1}`))
  for (const phase of role.phases) assert.ok(packet.includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.ok(packet.includes('## 独立备选队列'), role.packet)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  assert.equal(role.branch, prior.roles[id].branch)
  assert.equal(role.workdir, prior.roles[id].workdir)
  assert.equal(role.evidencePath.startsWith(id === 'main' ? 'reports/releases/' : role.ownedPaths.find(path => role.evidencePath.startsWith(path)) ?? '__outside_owner__'), true)
  if (role.candidate) assert.match(role.candidate, /^[a-f0-9]{40}$/)
}
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++)
  for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) assert.ok(!a.startsWith(b) && !b.startsWith(a), `${roles[i][0]} / ${roles[j][0]} overlapping owners`)
const active = new Set(), visited = new Set()
function visit(id) {
  const node = plan.checkpoints[id]
  assert.ok(node, `Missing checkpoint ${id}`)
  assert.ok(!active.has(id), `Dependency cycle ${id}`)
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
for (const id of ['E-exact595-verdict', 'D-same-data-package-driver', 'D-necessary-successor-bytes', 'M-ordinary-distribution-closure', 'E-dual-personal-read'])
  for (const dep of ['M-private-permission', 'M-target-activation', 'B-recovered-business']) assert.ok(!ancestors(id).has(dep), `${id} gated by unrelated ${dep}`)
assert.ok(ancestors('E-exact595-verdict').has('D-595-frozen-input'))
assert.ok(ancestors('E-exact595-verdict').has('E-package-consumer-gate'))
assert.ok(ancestors('E-necessary-successor-verdict').has('D-necessary-successor-bytes'))
assert.ok(!ancestors('D-necessary-successor-bytes').has('E-necessary-successor-verdict'))
assert.ok(ancestors('B-recovered-business').has('B-actual-attach'))
assert.ok(ancestors('B-recovered-business').has('M-business-consumer'))
for (const id of ['M-current-product', 'M-source-confirm', 'M-snapshot-versions', 'M-standard-review-identity', 'M-scope-diagnostics', 'M-registered-physical-control', 'A-dual-personal-data', 'C-dual-personal-data', 'B-normal-control', 'B-exact-control-contract', 'D-595-frozen-input', 'E-package-consumer-gate']) assert.equal(plan.checkpoints[id].providedByReviewedSource, true, id)
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE')
assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[field], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[field], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary,
  'docs/rfcs/WP-16/0058-optional-frozen-source-scope-diagnostics.md',
  'reports/releases/wave22-admission/README.zh-CN.md', 'reports/releases/wave22-integration/README.zh-CN.md',
  'agent-tasks/product-wave-22/README.zh-CN.md', 'agent-tasks/product-wave-22/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
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
for (const path of ['tools/bootstrap/probe-wave22-runtime.mjs', 'tools/bootstrap/probe-wave22-release-gate.mjs', 'tools/bootstrap/probe-wave22-delivery.mjs', 'reports/releases/wave22-admission/context.json', 'reports/releases/wave22-admission/runtime.json', 'reports/releases/wave22-admission/delivery.json', 'tests/integration/restored-personal-review.case.mjs']) assert.ok(existsSync(resolve(root, path)), path)
console.log(JSON.stringify({ status: 'PASS_LONG_DISPATCH_STATIC_ONLY', roles: roles.length, phases: 60,
  checkpoints: visited.size, localLinks: links, acyclic: true, nonoverlappingOwners: true,
  repairedControlAdmitted: true, businessAttachStillRequired: true, scopeDiagnosticOptInOnly: true,
  scopeDiagnosticUiImplemented: false, exact595VerdictRequired: true, oldE4eFailurePreserved: true,
  ordinaryInstallIndependentOfActivation: true, budgetUnchanged: true, preservedServicePairs: 12,
  runtimeTests: 0, nativeTurnStarts: 0 }, null, 2))
