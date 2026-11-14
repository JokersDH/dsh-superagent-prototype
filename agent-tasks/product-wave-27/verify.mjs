import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const plan = json('agent-tasks/product-wave-27/dispatch.json')
const prior = json('agent-tasks/product-wave-26/dispatch.json')
const workspaces = json('agent-tasks/product-wave-27/workspaces.json')
const integration = json('reports/releases/wave27-integration/status.json')
const core = json('reports/releases/wave27-admission/core.json')
const operations = json('reports/releases/wave27-admission/operations.json')
const experience = json('reports/releases/wave27-admission/experience-insights.json')
const pilot = json('tools/experiments/review-pilot-01/protocol.json')
assert.ok(process.argv.slice(2).every(value => value === '--workspaces'))
assert.equal(plan.wave, 'product-wave-27'); assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.equal(plan.date, '2026-11-14'); assert.equal(plan.deliveryCadence, 'NORMAL_NO_SAME_DAY_DEADLINE')
assert.equal(plan.calendarDeadline, null)
assert.equal(plan.externalAgentCount, 10); assert.equal(plan.totalOwnersIncludingMain, 11)
assert.equal(plan.phasesPerOwner, 20); assert.equal(plan.checkpointsPerOwner, 5)
for (const value of [plan.reviewBaseline, plan.observedMain, plan.productRuntimeSource]) assert.match(value, /^[a-f0-9]{40}$/)
for (const field of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[field], 0)
for (const field of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[field], false)
for (const field of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[field], true)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const input = plan.providedInputs
for (const field of ['channelInterfacePublished', 'aStrictAndMessageDriftPassed', 'bLargeChunkReplayPassed', 'cActualManifestDualFormatPassed', 'gOldSevenFindingsClosed', 'gActualControlledTwoProjectPassed', 'hFourPriorFindingsClosed']) assert.equal(input[field], true, field)
for (const field of ['trialGInsightsDefaultEnabled', 'trialHToolkitImported', 'channelImplementationAdmitted', 'projectRecipeImplementationAdmitted', 'aCompleteInventoryAndPersistentTableProofAdmitted', 'bSmallCumulativePagerPassed', 'bActualRebindDualClientAdmitted', 'bBusinessRecoveryImplemented', 'cWholeEventDeltaAdmitted', 'eFutureLiveToolSafetyAdmitted', 'gNestedTotalAndConflictAdmitted', 'hBusinessResumeReached', 'privatePermissionImplemented', 'targetActivationImplemented']) assert.equal(input[field], false, field)
const artifact = input.dArtifact, measured = input.eMeasuredSamePackage
assert.equal(artifact.source, operations.currentMinimumCandidate.source)
assert.equal(artifact.sha256, operations.currentMinimumCandidate.sha256)
assert.equal(artifact.bytes, operations.currentMinimumCandidate.tarBytes)
assert.equal(artifact.buildId, operations.currentMinimumCandidate.buildId)
assert.equal(artifact.verifiedEntries, 6754); assert.equal(input.dClosureEntries, 96)
assert.equal(artifact.source, measured.subjectSource); assert.equal(artifact.sha256, measured.sha256)
assert.deepEqual(measured.counts, operations.eCurrentSamePackageAcceptance.counts)
assert.equal(measured.requiredCases, 164); assert.equal(measured.ordinaryInstalledPassed, true)
assert.equal(measured.actualTrialUiPassed, true); assert.equal(measured.readinessSchemaModes, 3)
assert.equal(input.hTargetedCasesPassed, operations.hFocusedVerification.passed)
assert.equal(input.hTargetedCasesPassed, 7)
const browser = json(integration.browserReport)
assert.equal(integration.source, plan.productRuntimeSource)
assert.equal(input.trialIdentitySource, integration.source)
assert.equal(browser.sourceCommit, integration.source); assert.equal(browser.sourceWorktreeClean, true)
assert.equal(browser.status, 'PASS_ACTUAL_TRIAL_WORKBENCH'); assert.equal(browser.cases.length, 8)
assert.ok(browser.cases.every(value => value.status === 'PASS')); assert.deepEqual(browser.errors, [])
for (const field of ['postRequests', 'modelCalls', 'eventDelta', 'realModelTurns', 'nativeTurnStarts']) assert.equal(browser[field], 0, field)
assert.equal(integration.checks.contractsCases, 237); assert.equal(integration.checks.channelCases, 5)
assert.equal(integration.checks.trialPureCases + integration.checks.readinessTransportCases, 13)
assert.equal(integration.uiUpdated, true); assert.equal(integration.contractsChanged, true)
assert.equal(integration.channelInterfacePublished, true)
for (const field of ['channelImplementationImplemented', 'projectRecipesImplemented', 'defaultConversationChanged', 'gMetricsEnabled', 'hToolkitImported', 'newPersistentPreviewStarted', 'userServicesRestarted', 'frozenTarCreated', 'independentInstalledAdmission', 'releaseApproved']) assert.equal(integration[field], false, field)
for (const field of ['migrationsAdded', 'realModelTurns', 'nativeTurnStarts']) assert.equal(integration[field], 0)
assert.equal(integration.fSourceImport.length, 5)
assert.equal(integration.frozenRunnerHash, '74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d')
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'main'])
const inside = (path, rule) => rule.endsWith('/') ? path.startsWith(rule) : path === rule
const owned = (role, path) => role.ownedPaths.some(rule => inside(path, rule)) && !(role.excludedOwnedPaths ?? []).some(rule => inside(path, rule))
const observedCandidates = { ...core.fixedSources, ...Object.fromEntries(['D', 'E', 'H'].map(id => [id, operations.candidates[id]])), F: experience.candidates.F.head, G: experience.candidates.G.head }
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  assert.deepEqual(role.phases, Array.from({ length: 20 }, (_, i) => `${prefix}${i + 1}`))
  assert.deepEqual(role.milestones, [4, 8, 12, 16, 20].map(value => `${prefix}${value}`))
  for (const phase of role.phases) assert.ok(packet.includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.equal((packet.match(new RegExp(`^## ${prefix}\\d+ `, 'gm')) ?? []).length, 20)
  assert.ok(packet.includes('## 独立备选队列'), role.packet)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  if (prior.roles[id]) { assert.equal(role.branch, prior.roles[id].branch); assert.equal(role.workdir, prior.roles[id].workdir) }
  if (observedCandidates[id]) assert.equal(role.candidate, observedCandidates[id])
  if (['I', 'J'].includes(id)) {
    assert.equal(role.preparedFrom, integration.source); assert.equal(role.implementationStatus, 'PLANNED_WORKTREE_PREPARED_NOT_IMPLEMENTED')
    assert.equal(workspaces.roles[id].newlyPrepared, true); assert.ok(role.branch.startsWith('codex/g5-'))
  } else assert.equal(workspaces.roles[id].newlyPrepared, false)
  assert.equal(workspaces.roles[id].workdir, role.workdir); assert.equal(workspaces.roles[id].branch, role.branch)
  assert.ok(id === 'main' ? role.evidencePath.startsWith('reports/releases/') : owned(role, role.evidencePath))
}
assert.deepEqual(plan.roles.main.excludedOwnedPaths, ['apps/console/src/trial/', 'apps/console/test/trial/', 'apps/console/e2e/trial/'])
assert.deepEqual(plan.roles.B.excludedOwnedPaths, ['apps/runner/src/attach-channel/', 'apps/runner/test/attach-channel/'])
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const intersection = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], intersection) || !owned(roles[j][1], intersection), `${roles[i][0]} / ${roles[j][0]} overlapping owners at ${intersection}`)
}
for (const [id, path, expected] of [
  ['main', 'apps/console/src/App.tsx', true], ['main', 'apps/console/src/trial/TrialWorkspace.tsx', false],
  ['F', 'apps/console/src/trial/TrialWorkspace.tsx', true], ['F', 'apps/console/src/App.tsx', false],
  ['B', 'apps/runner/src/runner-service.ts', true], ['B', 'apps/runner/src/attach-channel/index.ts', false],
  ['I', 'apps/runner/src/attach-channel/index.ts', true], ['I', 'apps/runner/src/runner-service.ts', false],
  ['J', 'packages/project-recipes/src/index.ts', true], ['J', 'packages/verification/src/checks.ts', false],
]) assert.equal(owned(plan.roles[id], path), expected, `${id} ${path}`)
assert.equal(workspaces.externalAgentCount, 10); assert.equal(workspaces.createdNewWorktreesThisWave, 2)
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
for (const id of ['F-two-project-journey', 'M-insights-composition', 'M-recipe-composition', 'D-successor-bytes', 'E-ordinary-verdict', 'H-readonly-observations'])
  for (const dep of ['B-resumed-business', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by unrelated ${dep}`)
assert.ok(ancestors('B-resumed-business').has('B-rebound-dual-client'))
assert.ok(ancestors('B-channel-adapter').has('I-concrete-channel'))
assert.ok(ancestors('E-successor-ordinary').has('D-successor-bytes'))
assert.ok(!ancestors('D-successor-bytes').has('E-successor-ordinary'))
assert.ok(ancestors('E-restored-data').has('E-tool-safety'))
assert.ok(ancestors('M-insights-composition').has('G-nested-and-conflict'))
assert.ok(ancestors('M-recipe-composition').has('J-authorized-facts'))
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE')
assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[field], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[field], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary, plan.sharedInputBoundary,
  'reports/releases/wave27-admission/README.zh-CN.md', 'reports/releases/wave27-integration/README.zh-CN.md',
  'agent-tasks/product-wave-27/README.zh-CN.md', 'agent-tasks/product-wave-27/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
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
  if (role.preparedFrom) execFileSync('git', ['-C', role.workdir, 'merge-base', '--is-ancestor', role.preparedFrom, 'HEAD'])
  localWorkspaces++
}
console.log(JSON.stringify({ status: 'PASS_TEN_AGENT_DISPATCH_STATIC_ONLY', externalAgents: 10, ownersIncludingMain: roles.length,
  phases: 220, milestonesPerOwner: 5, checkpoints: visited.size, localLinks: links, localWorkspacesChecked: localWorkspaces,
  normalCadenceNoSameDayDeadline: true, acyclic: true, nonoverlappingOwnersWithExplicitExclusions: true,
  channelInterfaceOnly: true, recipesNotImplemented: true, sameCe64OrdinaryInstalledScopePreserved: true,
  ordinaryProductIndependentOfRecovery: true, budgetUnchanged: true, preservedServicePairs: 12,
  runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
