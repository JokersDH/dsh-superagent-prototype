import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const p = json('agent-tasks/product-wave-30/dispatch.json'), prior = json('agent-tasks/product-wave-29/dispatch.json')
const spaces = json('agent-tasks/product-wave-30/workspaces.json'), s = json('reports/releases/wave30-integration/status.json')
const inv = json(p.admissionReports.inventory), data = json(p.admissionReports.dataExperience), runtime = json(p.admissionReports.runtime)
const delivery = json(p.admissionReports.delivery), recipes = json(p.admissionReports.recipesInsights)
const browser = json(s.browserReport), window = json(s.windowReport), pilot = json('tools/experiments/review-pilot-01/protocol.json')
assert.ok(process.argv.slice(2).every(x => x === '--workspaces'))
assert.equal(p.wave, 'product-wave-30'); assert.equal(p.date, '2026-11-15'); assert.equal(p.status, 'PLANNED_NOT_EXECUTED')
assert.equal(p.deliveryMode, 'FOUR_COMPLETE_SUBSYSTEM_OUTCOMES_NOT_MORE_MICRO_PHASES')
assert.equal(p.deliverablesPerOwner, 4); assert.equal(p.checkpointsPerOwner, 4); assert.equal(p.minimumWorkDuration, null)
assert.equal(p.calendarDeadline, null); assert.equal(p.deliveryCadence, 'NORMAL_NO_SAME_DAY_DEADLINE')
assert.equal(p.externalAgentCount, 10); assert.equal(p.totalOwnersIncludingMain, 11); assert.equal(p.phasesPerOwner, undefined)
for (const key of ['reviewBaseline', 'observedMain', 'productRuntimeSource']) assert.match(p[key], /^[a-f0-9]{40}$/)
for (const key of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(p[key], 0)
for (const key of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(p[key], false)
for (const key of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage', 'goalCoversWholeSubsystem']) assert.equal(p[key], true)
assert.equal(p.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(p.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const input = p.providedInputs
for (const key of ['aStrictCanonicalClassifierClosed', 'cRealCompletionJFlowsPassed', 'fBlockedExclusionsExpiredClosed', 'fMainServerMappingSameFields', 'jSourceContentReadChecksPassed', 'gPureExportSourceTested', 'bLatestCoreAdapterAdopted', 'bFreshSinkGuardAdmittedAtTestedScope', 'bDirectConsumerStrictPassed', 'hCurrentConsumersExist', 'dSixModeSourceFixed', 'eOldDefaultNoRecordRetainClosed', 'mainWorkbenchJourneyImplemented', 'mainLatestWindowImplemented']) assert.equal(input[key], true, key)
for (const key of ['aHistoricalVsCurrentAdmitted', 'fGenericDisplaySelectionConsistent', 'jGenericFutureFactsReuseAdmitted', 'gDefaultUserExportImplemented', 'bRemoteIntentSingleTransportOwner', 'bSignalFullPlanAdmitted', 'hImmutableHandleAdmitted', 'bSameOriginalRecoveredDeliveryPassed', 'eForcedProofBranchAdmitted', 'ePhysicalStopProofComplete', 'currentCompleteRuntimeInstalledAdmission', 'privatePermissionImplemented', 'targetActivationImplemented', 'unsafeLiveSignalsRerun']) assert.equal(input[key], false, key)
assert.equal(input.dArtifact.source, delivery.newDArtifact.source); assert.equal(input.dArtifact.sha256, delivery.newDArtifact.sha256)
assert.equal(input.dArtifact.verifiedEntries, 6849); assert.equal(input.dArtifact.projectRecipesDistPresent, true)
assert.equal(input.dArtifact.main0076WindowSelectorSourceIsAncestor, false)
assert.deepEqual(input.eMeasured.counts, { PASS: 274, FAIL: 0, NOT_TESTED: 20 })
assert.equal(input.eMeasured.ordinary.required, 186); assert.equal(input.eMeasured.ordinary.independentRecordedGate, 'PASS')
assert.equal(input.eMeasured.functional.required, 187); assert.equal(input.eMeasured.functional.independentRecordedGate, 'PASS')
assert.notEqual(input.eMeasured.actualSubjectSource, input.dArtifact.source)
assert.equal(s.source, p.productRuntimeSource); assert.equal(s.jSource, p.roles.J.candidate)
assert.equal(s.fSource, p.roles.F.candidate); assert.equal(s.dSource, p.roles.D.candidate)
for (const key of ['jSourceByteExact', 'fRecipesSourceByteExact', 'dSourceByteExact', 'currentProjectSuggestionsUseActualServerPreviews', 'suggestionDisplayAndSelectionSameServerFields', 'callbackOnlyOpensOriginalForm', 'originalFormRepreviewsAndExplicitlyCreates', 'crossProjectLatePreviewsRejected', 'mainUsesSharedFactsContentDigest', 'mainPassesServerNow', 'readonlyPreviewSeparatedFromBusinessCommands']) assert.equal(s[key], true, key)
for (const key of ['newSharedSchemas', 'rootLockChanged', 'candidateWorkingTreesEdited', 'unadmittedBIRuntimeImported', 'aNewHistoryClassifierImported', 'eForceProofImported', 'newPersistentPreviewStarted', 'userServicesRestarted', 'frozenTarCreated', 'independentInstalledAdmission', 'nativeRecoveryAdmission', 'valueBenefitAdmission', 'privateTargetActivationAdmission', 'releaseApproved']) assert.equal(s[key], false, key)
for (const key of ['newExternalDependencies', 'migrationsAdded', 'realModelTurns', 'nativeTurnStarts']) assert.equal(s[key], 0)
assert.equal(s.checks.currentMainBackendCases, 13); assert.equal(s.checks.trialAndTransportCases, 23); assert.equal(s.checks.launcherModeAndIdentityHelpCases, 12)
for (const [report, expected, status] of [[browser, 8, 'PASS_ACTUAL_PROJECT_RECIPE_WORKFLOW'], [window, 9, 'PASS_ACTUAL_SCOPED_INSIGHTS_APP']]) {
  assert.equal(report.sourceCommit, s.source); assert.equal(report.sourceWorktreeClean, true)
  assert.equal(report.cases.length, expected); assert.ok(report.cases.every(x => x.status === 'PASS')); assert.deepEqual(report.errors, [])
  assert.equal(report.status, status); assert.equal(report.realModelTurns, 0); assert.equal(report.nativeTurnStarts, 0)
}
assert.equal(browser.acceptedWorks, 2); assert.equal(browser.unknownAfterRecorded, true)
const creates = browser.commands.filter(x => x.kind === 'create_work')
assert.equal(creates.length, 3); assert.equal(creates[0].commandId, creates[1].commandId); assert.equal(new Set(creates.map(x => x.commandId)).size, 2)
assert.equal(window.postRequests, 0); assert.equal(window.eventDelta, 0); assert.equal(window.readonlyRecipePreviewPosts, 18)
const roles = Object.entries(p.roles), fixed = new Map(inv.roles.map(x => [x.id, x]))
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'main'])
const inside = (path, rule) => rule.endsWith('/') ? path.startsWith(rule) : path === rule
const owned = (role, path) => role.ownedPaths.some(rule => inside(path, rule)) && !(role.excludedOwnedPaths ?? []).some(rule => inside(path, rule))
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  assert.deepEqual(role.deliverables, [1, 2, 3, 4].map(n => `${prefix}${n}`)); assert.deepEqual(role.milestones, role.deliverables)
  assert.equal(role.phases, undefined); assert.equal((packet.match(new RegExp(`^## ${prefix}[1-4] `, 'gm')) ?? []).length, 4)
  for (const name of role.deliverables) assert.ok(packet.includes(`## ${name} `), role.packet)
  for (const name of ['## 独立备选队列', '## 整包完成条件']) assert.ok(packet.includes(name), role.packet)
  assert.equal(role.branch, prior.roles[id].branch); assert.equal(role.workdir, prior.roles[id].workdir)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  const normalized = values => values?.map(x => x.replace(/agent-tasks\/product-wave-\d+\//, 'agent-tasks/current/'))
  assert.deepEqual(normalized(role.ownedPaths), normalized(prior.roles[id].ownedPaths)); assert.deepEqual(role.excludedOwnedPaths, prior.roles[id].excludedOwnedPaths)
  if (id !== 'main') assert.equal(role.candidate, fixed.get(id).head)
  assert.equal(spaces.roles[id].packet, role.packet); assert.equal(spaces.roles[id].newlyPrepared, false)
  assert.ok(id === 'main' ? role.evidencePath.startsWith('reports/releases/') : owned(role, role.evidencePath))
}
for (const id of ['A', 'C', 'F']) assert.equal(data.fixedSources[id], p.roles[id].candidate)
for (const id of ['B', 'I', 'H']) assert.equal(runtime.candidates[id].source, p.roles[id].candidate)
for (const id of ['D', 'E']) assert.equal(delivery.candidates[id], p.roles[id].candidate)
for (const id of ['J', 'G']) assert.equal(recipes.candidates[id].head, p.roles[id].candidate)
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const intersection = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], intersection) || !owned(roles[j][1], intersection), `${roles[i][0]}/${roles[j][0]} at ${intersection}`)
}
assert.equal(spaces.createdNewWorktreesThisWave, 0)
for (const key of ['createdUserThreads', 'externalPromptsSent', 'newRootsCopyUntrackedOrUserState']) assert.equal(spaces[key], false)
assert.equal(spaces.nativeModelAllowanceAdded, 0)
const active = new Set(), visited = new Set()
function visit(id) { const n = p.checkpoints[id]; assert.ok(n, id); assert.ok(!active.has(id), `Cycle ${id}`); if (visited.has(id)) return
  assert.ok(p.roles[n.owner]); active.add(id); for (const dep of n.dependsOn) visit(dep); active.delete(id); visited.add(id) }
for (const id of Object.keys(p.checkpoints)) visit(id)
function ancestors(id, result = new Set()) { for (const dep of p.checkpoints[id].dependsOn) if (!result.has(dep)) { result.add(dep); ancestors(dep, result) } return result }
for (const id of ['F-complete-project-journey', 'J-complete-current-inputs', 'G-authorized-export-consumer', 'D-current-complete-freeze', 'E-current-two-project-journey'])
  for (const dep of ['B-original-crash-to-accept', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by ${dep}`)
assert.ok(ancestors('B-original-crash-to-accept').has('B-safe-single-owner-baseline')); assert.ok(ancestors('E-current-same-tar-matrix').has('E-safe-no-record-policy'))
assert.ok(!ancestors('D-current-complete-freeze').has('E-current-same-tar-matrix'))
const b = p.roles.B, e = p.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [k, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[k], pilot.budget[bound])
assert.equal(e.maxInFlight, 1); for (const k of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[k], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', p.sharedBoundary, p.sharedInputBoundary, p.actualMainInput,
  'reports/releases/wave30-admission/README.zh-CN.md', 'reports/releases/wave30-integration/README.zh-CN.md',
  'agent-tasks/product-wave-30/README.zh-CN.md', 'agent-tasks/product-wave-30/forward-prompts.zh-CN.md', ...roles.map(([, r]) => r.packet)]
let links = 0
for (const path of [...p.contracts, ...Object.values(p.admissionReports), p.completionEstimateRef, ...files]) assert.ok(existsSync(resolve(root, path)), path)
for (const path of files) { const content = read(path); assert.equal((content.match(/^\s*```/gm) ?? []).length % 2, 0, path)
  for (const match of content.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) { let target = match[1].trim().replace(/^<|>$/g, '')
    if (/^(https?:|obsidian:|mailto:|#)/.test(target)) continue
    target = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '')
    if (!target || target.includes(' ')) continue
    assert.ok(existsSync(resolve(root, dirname(path), target)), `${path} -> ${target}`); links++ }
}
let workspaces = 0
if (process.argv.includes('--workspaces')) for (const [id, r] of roles) {
  assert.equal(execFileSync('git', ['-C', r.workdir, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), r.branch, id); workspaces++ }
console.log(JSON.stringify({ status: 'PASS_TEN_AGENT_OUTCOME_DISPATCH_STATIC_ONLY', externalAgents: 10, ownersIncludingMain: 11,
  completeDeliverablesPerOwner: 4, totalDeliverablesIncludingMain: 44, mechanicalMicroPhaseExpansion: false,
  checkpoints: visited.size, localLinks: links, localWorkspacesChecked: workspaces, acyclic: true, nonoverlappingOwnership: true,
  actualWorkbenchOriginalFlow: true, sameTarInstalledProductRequired: true, recoveredSameWorkNotNormalDemo: true,
  budgetUnchanged: true, preservedServicePairs: 12, runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
