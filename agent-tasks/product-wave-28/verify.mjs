import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const plan = json('agent-tasks/product-wave-28/dispatch.json')
const prior = json('agent-tasks/product-wave-27/dispatch.json')
const workspaces = json('agent-tasks/product-wave-28/workspaces.json')
const inventory = json(plan.admissionReports.inventory)
const data = json(plan.admissionReports.data)
const runtime = json(plan.admissionReports.runtime)
const delivery = json(plan.admissionReports.deliveryInsights)
const experience = json(plan.admissionReports.experienceRecipes)
const integration = json('reports/releases/wave28-integration/status.json')
const browser = json(integration.browserReport)
const pilot = json('tools/experiments/review-pilot-01/protocol.json')
assert.ok(process.argv.slice(2).every(value => value === '--workspaces'))
assert.equal(plan.wave, 'product-wave-28'); assert.equal(plan.date, '2026-11-15')
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED'); assert.equal(plan.calendarDeadline, null)
assert.equal(plan.deliveryCadence, 'NORMAL_NO_SAME_DAY_DEADLINE')
assert.equal(plan.externalAgentCount, 10); assert.equal(plan.totalOwnersIncludingMain, 11)
assert.equal(plan.phasesPerOwner, 24); assert.equal(plan.checkpointsPerOwner, 6)
for (const field of ['reviewBaseline', 'observedMain', 'productRuntimeSource']) assert.match(plan[field], /^[a-f0-9]{40}$/)
for (const field of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[field], 0)
for (const field of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[field], false)
for (const field of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[field], true)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const input = plan.providedInputs
for (const field of ['aCPreviousThreeFindingsClosed', 'aCExactCe64SingleManifestDualPassed', 'bOldThreeMapsDeleted', 'bActualFull161AndFiveChunkPassed', 'bOriginalCompletionNormalConsumerPassed', 'iConcreteModuleExists', 'jConcreteLibraryAndCliPassed', 'fPureRecipeStatePassed', 'gOldNestedAndTombstoneClosed', 'gMainScopeConsumerIntegrated', 'oldCe64NormalOrdinaryScopePreserved']) assert.equal(input[field], true, field)
for (const field of ['bEffective2KiBPageBoundPassed', 'bExplicitSourceBoundLeasePassed', 'bIUnifiedImplementation', 'bActualProductRecoveryDelivered', 'iFreshIntentReplayAdmitted', 'hCurrentBISameImplementationAdmitted', 'jActualSameConfigurationScopeConsumerAdmitted', 'fUnqualifiedRecipeApplicabilityAdmitted', 'dRestoredDiscussionModeStopPassed', 'eFullResourcePrecheckPassed', 'currentDIndependentInstalledAdmission', 'currentMetricsInstalledAdmission', 'privatePermissionImplemented', 'targetActivationImplemented', 'unsafeLiveRecoveryHarnessesRerun']) assert.equal(input[field], false, field)
assert.equal(input.dArtifact.source, delivery.dSuccessorArtifact.source)
assert.equal(input.dArtifact.sha256, delivery.dSuccessorArtifact.sha256)
assert.equal(input.dArtifact.verifiedEntries, 6759)
assert.equal(input.dArtifact.containsMain18fStatistics, false)
assert.equal(input.eMeasured.subject, delivery.eActualReport.subject)
assert.deepEqual(input.eMeasured.counts, { PASS: 260, FAIL: 0, NOT_TESTED: 19 })
assert.equal(input.eMeasured.requiredCases, 178)
assert.notEqual(input.eMeasured.subject, input.dArtifact.source)
assert.equal(input.eMeasured.packagedStopCase.actualHealthMode, 'fixture')
assert.equal(input.eMeasured.packagedStopCase.recordMode, 'personal')
assert.equal(input.eMeasured.packagedStopCase.stopStatus, 'BLOCKED')
assert.equal(integration.source, plan.productRuntimeSource)
assert.equal(integration.gSource, plan.roles.G.candidate)
assert.equal(integration.gImportedFileCount, 14)
assert.equal(integration.mainPublicReaderAuthorizationPreserved, true)
assert.equal(integration.mainCollectionBoundsPreserved, true)
assert.equal(integration.checks.newCurrentMainScopedProductCases, 8)
assert.equal(integration.checks.normalCompletionProofCases, 1)
for (const field of ['privatePermissionImplemented', 'targetActivationImplemented', 'unadmittedBIRuntimeImported', 'unadmittedJRecipesDefaultEnabled', 'fRecipeSuggestionsDefaultPassed', 'newSharedContracts', 'rootLockChanged', 'newPersistentPreviewStarted', 'userServicesRestarted', 'frozenTarCreated', 'independentInstalledAdmission', 'releaseApproved']) assert.equal(integration[field], false, field)
for (const field of ['migrationsAdded', 'realModelTurns', 'nativeTurnStarts']) assert.equal(integration[field], 0)
assert.equal(browser.sourceCommit, integration.source); assert.equal(browser.sourceWorktreeClean, true)
assert.equal(browser.status, 'PASS_ACTUAL_SCOPED_INSIGHTS_APP'); assert.equal(browser.cases.length, 6)
assert.ok(browser.cases.every(value => value.status === 'PASS')); assert.deepEqual(browser.errors, [])
for (const field of ['postRequests', 'eventDelta', 'realModelTurns', 'nativeTurnStarts']) assert.equal(browser[field], 0)
const frozen = json('packages/contracts/generated/usage-observation.manifest.json')
assert.equal(frozen.runtimeContractSchemaHash, '74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d')
const roles = Object.entries(plan.roles), recorded = new Map(inventory.roles.map(value => [value.id, value]))
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'main'])
const inside = (path, rule) => rule.endsWith('/') ? path.startsWith(rule) : path === rule
const owned = (role, path) => role.ownedPaths.some(rule => inside(path, rule)) && !(role.excludedOwnedPaths ?? []).some(rule => inside(path, rule))
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  assert.deepEqual(role.phases, Array.from({ length: 24 }, (_, i) => `${prefix}${i + 1}`))
  assert.deepEqual(role.milestones, [4, 8, 12, 16, 20, 24].map(value => `${prefix}${value}`))
  assert.equal((packet.match(new RegExp(`^## ${prefix}\\d+ `, 'gm')) ?? []).length, 24)
  for (const phase of role.phases) assert.ok(packet.includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.ok(packet.includes('## 独立备选队列')); assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  assert.equal(role.branch, prior.roles[id].branch); assert.equal(role.workdir, prior.roles[id].workdir)
  assert.deepEqual(role.ownedPaths, prior.roles[id].ownedPaths)
  assert.deepEqual(role.excludedOwnedPaths, prior.roles[id].excludedOwnedPaths)
  if (id !== 'main') { assert.equal(role.candidate, recorded.get(id).head); assert.equal(role.workdir, recorded.get(id).root) }
  assert.equal(workspaces.roles[id].workdir, role.workdir); assert.equal(workspaces.roles[id].branch, role.branch)
  assert.equal(workspaces.roles[id].newlyPrepared, false)
  assert.ok(id === 'main' ? role.evidencePath.startsWith('reports/releases/') : owned(role, role.evidencePath))
}
assert.equal(data.fixedSources.A, plan.roles.A.candidate); assert.equal(data.fixedSources.C, plan.roles.C.candidate)
for (const id of ['B', 'I', 'H']) assert.equal(runtime.candidates[id].source, plan.roles[id].candidate)
for (const id of ['D', 'E', 'G']) assert.equal(delivery.candidates[id], plan.roles[id].candidate)
for (const id of ['F', 'J']) assert.equal(experience.candidates[id].head, plan.roles[id].candidate)
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const intersection = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], intersection) || !owned(roles[j][1], intersection), `${roles[i][0]}/${roles[j][0]} at ${intersection}`)
}
assert.equal(owned(plan.roles.B, 'apps/runner/src/attach-channel/index.ts'), false)
assert.equal(owned(plan.roles.I, 'apps/runner/src/attach-channel/index.ts'), true)
assert.equal(owned(plan.roles.I, 'apps/runner/src/runner-service.ts'), false)
assert.equal(owned(plan.roles.main, 'apps/console/src/trial/recipes.ts'), false)
assert.equal(owned(plan.roles.F, 'apps/console/src/App.tsx'), false)
assert.equal(owned(plan.roles.J, 'packages/questions/src/validation.ts'), false)
assert.equal(workspaces.createdNewWorktreesThisWave, 0)
for (const field of ['createdUserThreads', 'externalPromptsSent', 'newRootsCopyUntrackedOrUserState']) assert.equal(workspaces[field], false)
assert.equal(workspaces.nativeModelAllowanceAdded, 0)
const active = new Set(), visited = new Set()
function visit(id) {
  const node = plan.checkpoints[id]; assert.ok(node, id); assert.ok(!active.has(id), `Dependency cycle ${id}`)
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
for (const id of ['M-recipe-form-flow', 'F-actual-recipe-journey', 'G-window-layer-tools', 'D-observation-successor', 'E-ordinary-observation-verdict', 'H-readonly-support'])
  for (const dep of ['B-original-product-recovery', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by ${dep}`)
assert.ok(ancestors('B-I-single-implementation').has('I-fresh-intent-correlation'))
assert.ok(ancestors('B-recovered-delivery-slots').has('M-original-completion-proof'))
assert.ok(ancestors('M-recipe-form-flow').has('J-original-scope-compatibility'))
assert.ok(ancestors('E-ordinary-observation-verdict').has('D-mode-start-health-stop'))
assert.ok(ancestors('E-ordinary-observation-verdict').has('E-detection-functional-gates'))
assert.ok(!ancestors('D-observation-successor').has('E-ordinary-observation-verdict'))
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[field], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[field], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary, plan.sharedInputBoundary,
  'reports/releases/wave28-admission/README.zh-CN.md', 'reports/releases/wave28-integration/README.zh-CN.md',
  'agent-tasks/product-wave-28/README.zh-CN.md', 'agent-tasks/product-wave-28/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
let links = 0
for (const path of [...plan.contracts, ...Object.values(plan.admissionReports), plan.completionEstimateRef, ...files]) assert.ok(existsSync(resolve(root, path)), path)
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
  assert.equal(execFileSync('git', ['-C', role.workdir, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), role.branch, `${id} branch`)
  localWorkspaces++
}
console.log(JSON.stringify({ status: 'PASS_TEN_AGENT_DISPATCH_STATIC_ONLY', externalAgents: 10, ownersIncludingMain: 11,
  phases: 264, milestonesPerOwner: 6, checkpoints: visited.size, localLinks: links, localWorkspacesChecked: localWorkspaces,
  normalCadenceNoSameDayDeadline: true, acyclic: true, ownershipNonoverlap: true, originalDirectoriesAndBranches: true,
  originalCompletionNoNewCandidatesTable: true, uniqueIImplementationRequired: true, sourceAndArtifactScopesSeparated: true,
  bugDetectionNotFunctionalPass: true, budgetUnchanged: true, preservedServicePairs: 12,
  runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
