import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const plan = json('agent-tasks/product-wave-29/dispatch.json'), prior = json('agent-tasks/product-wave-28/dispatch.json')
const spaces = json('agent-tasks/product-wave-29/workspaces.json'), integration = json('reports/releases/wave29-integration/status.json')
const inventory = json(plan.admissionReports.inventory), data = json(plan.admissionReports.data), runtime = json(plan.admissionReports.runtime)
const delivery = json(plan.admissionReports.deliveryInsights), experience = json(plan.admissionReports.experienceRecipes)
const browser = json(integration.browserReport), pilot = json('tools/experiments/review-pilot-01/protocol.json')
assert.ok(process.argv.slice(2).every(value => value === '--workspaces'))
assert.equal(plan.wave, 'product-wave-29'); assert.equal(plan.date, '2026-11-15'); assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.equal(plan.deliveryCadence, 'NORMAL_NO_SAME_DAY_DEADLINE'); assert.equal(plan.calendarDeadline, null)
assert.equal(plan.externalAgentCount, 10); assert.equal(plan.totalOwnersIncludingMain, 11)
assert.equal(plan.phasesPerOwner, 24); assert.equal(plan.checkpointsPerOwner, 6)
for (const key of ['reviewBaseline', 'observedMain', 'productRuntimeSource']) assert.match(plan[key], /^[a-f0-9]{40}$/)
for (const key of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[key], 0)
for (const key of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[key], false)
for (const key of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[key], true)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const input = plan.providedInputs
for (const key of ['aPreviousProofsRetained', 'cAccurate1cdDualPassed', 'bActual2KiBBudgetClosed', 'bExplicitCASClosed', 'bNormalDeliveryPassed', 'iFinalNonceNamespacePruneClosed', 'eFullSetPrecheckClosed', 'eDetectionFunctionalSplitClosed', 'jOriginalScopeActualConsumerClosed', 'jNodeRuntimeObserverImplemented', 'jMainHttpFormImplemented', 'fPriorProjectSourceCasesClosed', 'gMainObservationImplemented', 'dPersonalModeAndHealthFixClosed']) assert.equal(input[key], true, key)
for (const key of ['aNewCompletionClassifierAdmitted', 'bFinalIVersionAdopted', 'bSinkFreshGuardAdmitted', 'bDirectConsumerStrictPassed', 'bOriginalRecoveredDeliveryPassed', 'bHSignalHelpersAdmitted', 'eKnownBirthNoRecordAdmitted', 'fBlockedExclusionsAdmitted', 'fRecipeReconstructionUsedByMain', 'gNewProjectionImportedThisWave', 'dRequestedFixtureCompatibilityAdmitted', 'dCurrentIndependentInstalledAdmission', 'currentRecipeInstalledAdmission', 'privatePermissionImplemented', 'targetActivationImplemented', 'unsafeLiveSignalReruns']) assert.equal(input[key], false, key)
assert.equal(input.iCurrentModuleCases, 65)
assert.equal(input.dArtifact.source, delivery.newDArtifact.source); assert.equal(input.dArtifact.sha256, delivery.newDArtifact.sha256)
assert.equal(input.dArtifact.verifiedEntries, 6778); assert.equal(input.dArtifact.usageInsightsPackagePresent, true); assert.equal(input.dArtifact.projectRecipesPresent, false)
assert.equal(input.eMeasured.subjectSource, delivery.eDetectionFunctionalSplit.subjectSource)
assert.deepEqual(input.eMeasured.counts, { PASS: 265, FAIL: 1, NOT_TESTED: 19 })
assert.notEqual(input.eMeasured.subjectSource, input.dArtifact.source)
assert.equal(input.eMeasured.ordinaryTier.required, 180); assert.equal(input.eMeasured.ordinaryTier.independentGateOk, true)
assert.equal(input.eMeasured.functionalTier.required, 181); assert.equal(input.eMeasured.functionalTier.independentGateOk, false)
assert.equal(integration.source, plan.productRuntimeSource); assert.equal(integration.jSource, plan.roles.J.candidate)
assert.equal(integration.jImportedFiles, 12); assert.equal(integration.jSourceByteExact, true)
for (const key of ['originalFormUsed', 'fullScopeCriteriaProfilePreserved', 'explicitCreateRevalidatesInputs', 'stableFactsDigestExcludesObservedAt', 'unknownCreationRetainsCommandId', 'unknownAfterServerRecordedVerified', 'newSharedContracts', 'rootLockChanged']) assert.equal(integration[key], true, key)
for (const key of ['privateRootsAcceptedFromHttp', 'fRecipeReconstructionImported', 'unadmittedBIRuntimeImported', 'aUnadmittedClassifierImported', 'newPersistentPreviewStarted', 'userServicesRestarted', 'frozenTarCreated', 'independentInstalledAdmission', 'nativeRecoveryAdmission', 'valueBenefitAdmission', 'privatePermissionOrTargetAdmission', 'releaseApproved']) assert.equal(integration[key], false, key)
assert.equal(integration.checks.contractsCases, 241); assert.equal(integration.checks.newPreviewModuleHttpAndProductCases, 5)
assert.equal(integration.checks.existingObservationReadinessCases, 14)
for (const key of ['newExternalDependencies', 'migrationsAdded', 'realModelTurns', 'nativeTurnStarts']) assert.equal(integration[key], 0)
assert.equal(browser.sourceCommit, integration.source); assert.equal(browser.sourceWorktreeClean, true)
assert.equal(browser.status, 'PASS_ACTUAL_PROJECT_RECIPE_WORKFLOW'); assert.equal(browser.cases.length, 6)
assert.ok(browser.cases.every(value => value.status === 'PASS')); assert.deepEqual(browser.errors, [])
assert.equal(browser.acceptedWorks, 2); assert.equal(browser.unknownAfterRecorded, true)
const creates = browser.commands.filter(value => value.kind === 'create_work')
assert.equal(creates.length, 3); assert.equal(creates[0].commandId, creates[1].commandId)
assert.equal(new Set(creates.map(value => value.commandId)).size, 2)
assert.equal(browser.commands.filter(value => value.kind === 'accept_candidate').length, 2)
for (const key of ['realModelTurns', 'nativeTurnStarts']) assert.equal(browser[key], 0)
assert.equal(json('packages/contracts/generated/project-recipe-preview.manifest.json').runtimeContractSchemaHash,
  '74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d')
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
  for (const key of ['branch', 'workdir']) assert.equal(role[key], prior.roles[id][key])
  for (const key of ['ownedPaths', 'excludedOwnedPaths']) assert.deepEqual(role[key], prior.roles[id][key])
  if (id !== 'main') { assert.equal(role.candidate, recorded.get(id).head); assert.equal(role.workdir, recorded.get(id).root) }
  assert.equal(spaces.roles[id].packet, role.packet); assert.equal(spaces.roles[id].newlyPrepared, false)
  assert.ok(id === 'main' ? role.evidencePath.startsWith('reports/releases/') : owned(role, role.evidencePath))
}
const sourceOf = value => typeof value === 'string' ? value : value.source ?? value.head
for (const id of ['A', 'C']) assert.equal(sourceOf(data.fixedSources[id]), plan.roles[id].candidate)
for (const id of ['B', 'I', 'H']) assert.equal(sourceOf(runtime.candidates[id]), plan.roles[id].candidate)
for (const id of ['D', 'E']) assert.equal(sourceOf(delivery.candidates[id]), plan.roles[id].candidate)
for (const id of ['F', 'G', 'J']) assert.equal(sourceOf(experience.candidates[id]), plan.roles[id].candidate)
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const intersection = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], intersection) || !owned(roles[j][1], intersection), `${roles[i][0]}/${roles[j][0]} at ${intersection}`)
}
assert.equal(owned(plan.roles.B, 'apps/runner/src/attach-channel/index.ts'), false)
assert.equal(owned(plan.roles.I, 'apps/runner/src/attach-channel/index.ts'), true)
assert.equal(owned(plan.roles.F, 'apps/console/src/App.tsx'), false)
assert.equal(owned(plan.roles.main, 'apps/console/src/trial/recipes.ts'), false)
assert.equal(owned(plan.roles.J, 'packages/questions/src/validation.ts'), false)
assert.equal(spaces.createdNewWorktreesThisWave, 0)
for (const key of ['createdUserThreads', 'externalPromptsSent', 'newRootsCopyUntrackedOrUserState']) assert.equal(spaces[key], false)
assert.equal(spaces.nativeModelAllowanceAdded, 0)
const active = new Set(), visited = new Set()
function visit(id) {
  const node = plan.checkpoints[id]; assert.ok(node, id); assert.ok(!active.has(id), `Cycle ${id}`)
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
for (const id of ['J-current-runtime-consumer', 'F-actual-recipe-entry', 'M-trial-to-original-form', 'G-window-source-row-semantics', 'D-template-runtime-successor', 'E-template-installed-verdict'])
  for (const dep of ['B-original-product-recovery', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by ${dep}`)
assert.ok(ancestors('B-original-product-recovery').has('B-mandatory-native-guard'))
assert.ok(ancestors('B-current-I-adoption').has('I-final-nonce-queue-closed'))
assert.ok(ancestors('E-current-functional-verdict').has('E-known-birth-no-record'))
assert.ok(!ancestors('D-template-runtime-successor').has('E-template-installed-verdict'))
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [key, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[key], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const key of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[key], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary, plan.sharedInputBoundary, plan.actualMainInput,
  'reports/releases/wave29-admission/README.zh-CN.md', 'reports/releases/wave29-integration/README.zh-CN.md',
  'agent-tasks/product-wave-29/README.zh-CN.md', 'agent-tasks/product-wave-29/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
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
  actualRecipeHttpFormImplemented: true, unknownRetrySameCommandIdVerified: true,
  currentVersionNotInferredFromImportName: true, sourceAndInstalledScopesSeparated: true,
  budgetUnchanged: true, preservedServicePairs: 12, runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
