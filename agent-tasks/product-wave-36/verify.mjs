import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8'), json = path => JSON.parse(read(path))
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const p = json('agent-tasks/product-wave-36/dispatch.json'), old = json('agent-tasks/product-wave-35/dispatch.json')
const spaces = json('agent-tasks/product-wave-36/workspaces.json'), inv = json(p.admissionReports.inventory)
const s = json('reports/releases/wave36-integration/status.json'), delivery = json(p.admissionReports.delivery)
const pilot = json('tools/experiments/review-pilot-01/protocol.json')
assert.ok(process.argv.slice(2).every(value => value === '--workspaces'))
assert.equal(p.wave, 'product-wave-36'); assert.equal(p.date, '2026-11-17')
assert.equal(p.status, 'PLANNED_NOT_EXECUTED_BY_EXTERNAL_AGENTS')
assert.equal(p.externalAgentCount, 10); assert.equal(p.totalOwnersIncludingMain, 11)
assert.equal(p.wholeSubsystemGoalPerOwner, true); assert.equal(p.productClosuresPerOwner, 4)
assert.equal(p.retainedPriorAcceptancePointsPerOwner, 9); assert.equal(p.microPhaseExpansion, false)
assert.equal(p.calendarDeadline, null); assert.equal(p.tokenBudgetAdded, false)
assert.equal(p.scope.cac, 'DEFERRED_EXCLUDED'); assert.equal(p.scope.temporaryZipSprint, false)
for (const key of ['continueAfterSourceHandoff', 'independentQueueRequired', 'normalCadence']) assert.equal(p[key], true)
for (const key of ['newModelAllowance', 'nativeModelsStartedByDispatch', 'newUserThreads', 'newWorktrees']) assert.equal(p[key], 0)
for (const key of ['externalPromptsSent', 'releaseApproved', 'completionEstimateChangedByTaskCount']) assert.equal(p[key], false)
assert.deepEqual(p.preservedServicePairs, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
assert.equal(p.mainRuntimeSource, s.source); assert.equal(p.mainHistoryBrowserSource, s.historyBrowserSource)
assert.equal(p.mainOtherBrowserSource, s.otherBrowserSource)
assert.equal(s.checks.historyBackend + s.checks.existingEvidenceHistory + s.checks.historyTransport + s.checks.wrapperPolicy, 10)
assert.equal(s.checks.staticSelfTest, 10); assert.equal(s.checks.contracts, 241)
assert.equal(json('packages/contracts/generated/manifest.json').schemaHash, s.checks.runnerFrozenHash)
assert.equal(git(['hash-object', 'packages/storage/src/workflows.ts']), s.history.AWorkflowBlob)
assert.equal(git(['diff', '--name-only', p.baseline, s.source, '--', 'apps/runner', 'packages/execution', 'packages/knowledge', 'packages/context', 'packages/proposals']), '')
assert.deepEqual(git(['diff', '--name-only', s.historyBrowserSource, s.source]).split('\n'), s.sourceDeltaAfterHistoryBrowser)
assert.deepEqual(git(['diff', '--name-only', s.otherBrowserSource, s.source, '--', 'apps', 'packages']).split('\n'), s.otherBrowserAppDelta)
assert.deepEqual(s.history.kinds, ['contracts', 'verifications', 'acceptances'])
assert.equal(s.history.actualDefaultApp, true); assert.equal(s.history.metadataOnly, true)
assert.equal(s.history.oldTimelinePreserved, true); assert.equal(s.history.principalScopeContractKindLimitExpirySigned, true)
assert.equal(s.history.streamResponseMaxBytes, 131072); assert.equal(s.history.sourceHardDeadlineProven, false)
assert.equal(s.wrapper.actualMustEqualManifest, true); assert.equal(s.wrapper.arbitraryThirdRefused, true)
assert.equal(s.wrapper.W35IndependentStatic, 'VERIFIED_STATIC'); assert.equal(s.wrapper.archivesChanged, false)
const history = json(s.historyReport), recipe = json(s.recipeReport), model = json(s.modelReport)
for (const [report, count, source] of [[history, 8, s.historyBrowserSource], [recipe, 9, s.otherBrowserSource], [model, 6, s.otherBrowserSource]]) {
  assert.equal(report.sourceCommit, source); assert.equal(report.sourceWorktreeClean, true)
  assert.equal(report.cases.length, count); assert.ok(report.cases.every(value => value.status === 'PASS'))
  assert.deepEqual(report.errors, []); assert.equal(report.realModelTurns, 0); assert.equal(report.nativeTurnStarts, 0)
}
assert.equal(history.businessPosts, 0); assert.equal(history.eventDelta, 0); assert.equal(history.historyReads, 11)
assert.equal(history.acceptedWorks, 2); assert.equal(history.additionalMetadataFixtures, 14)
for (const file of [s.initialHistoryReport, s.diagnosticHistoryReport]) assert.equal(json(file).status, 'FAIL')
assert.equal(recipe.acceptedWorks, 2); assert.equal(recipe.unknownAfterRecorded, true)
const creates = recipe.commands.filter(value => value.kind === 'create_work')
assert.equal(creates.length, 3); assert.equal(creates[0].commandId, creates[1].commandId)
assert.equal(model.modelRequests, 0); assert.equal(model.commands, 0); assert.equal(model.eventDelta, 0)
for (const key of ['newDependencies', 'newMigrations', 'realModelTurns', 'nativeTurnStarts']) assert.equal(s[key], 0)
for (const key of ['candidateWorktreesEdited', 'newTarCreated', 'newPersistentServiceStarted', 'userTwelveServicesTouched', 'fullOriginalWorkRecovery', 'actualNativeAdmission', 'currentRuntimeInstalled', 'valueBenefitAdmission', 'releaseApproved', 'completionEstimateChanged']) assert.equal(s[key], false)
assert.equal(p.knownCohort.source, delivery.DCurrentSuccessor.source)
assert.equal(p.knownCohort.zipSha256, delivery.DCurrentSuccessor.zipSha256)
assert.equal(p.knownCohort.staticVerified, true); assert.equal(p.knownCohort.EIndependent, false)
assert.equal(p.knownCohort.selectedSourceAuditIsComplete, false); assert.equal(p.knownCohort.containsNewCompletionHistory, false)
const fixed = new Map(inv.roles.map(value => [value.id, value])), roles = Object.entries(p.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'main'])
const normalize = paths => paths.map(path => path.replace(/product-wave-\d+/, 'product-wave-current'))
const inside = (path, rule) => rule.endsWith('/') ? path.startsWith(rule) : path === rule
const owned = (r, path) => r.ownedPaths.some(rule => inside(path, rule)) && !(r.excludedOwnedPaths ?? []).some(rule => inside(path, rule))
let branches = 0
for (const [id, r] of roles) {
  const prior = old.roles[id], text = read(r.packet)
  assert.equal(r.branch, prior.branch); assert.equal(r.workdir, prior.workdir)
  assert.deepEqual(normalize(r.ownedPaths), normalize(prior.ownedPaths)); assert.deepEqual(r.excludedOwnedPaths, prior.excludedOwnedPaths)
  assert.equal(r.outcomes.length, 4); assert.equal(r.closures.length, 4); assert.equal(r.wholeSubsystemGoal, true)
  assert.equal(r.priorNineAcceptancePointsRetained, true); assert.deepEqual(r.priorAcceptancePoints, prior.outcomes)
  assert.equal(r.priorPacket, prior.packet)
  assert.deepEqual(r.closures.flatMap(value => value.coversPriorAcceptanceIndexes).sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  for (const value of r.closures) assert.deepEqual(value.requires, ['production', 'defaultActualConsumer', 'necessaryPositiveNegative', 'sameVersionMaintenanceHandoff'])
  assert.equal((text.match(/^## 产品闭环[一二三四]：/gm) ?? []).length, 4)
  assert.ok(/独立.*队列/.test(text), r.packet)
  assert.equal(r.budgetMode, 'zero_native_model_tasks_this_wave')
  if (id !== 'main') assert.equal(r.candidate, fixed.get(id).head)
  assert.equal(spaces.roles[id].packet, r.packet); assert.equal(spaces.roles[id].newlyPrepared, false)
  assert.ok(id === 'main' ? r.evidencePath.startsWith('reports/releases/') : owned(r, r.evidencePath))
  if (process.argv.includes('--workspaces')) {
    const run = args => execFileSync('git', ['-C', r.workdir, ...args], { encoding: 'utf8' }).trim()
    assert.equal(run(['branch', '--show-current']), r.branch)
    if (id !== 'main') { assert.equal(run(['rev-parse', 'HEAD']), fixed.get(id).head); assert.equal(run(['status', '--porcelain']), fixed.get(id).dirty.trim()) }
    branches++
  }
}
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const path = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], path) || !owned(roles[j][1], path), `${roles[i][0]}/${roles[j][0]} ${path}`)
}
for (const key of ['createdUserThreads', 'externalPromptsSent', 'copyUserState']) assert.equal(spaces[key], false)
assert.equal(spaces.createdNewWorktrees, 0)
const visiting = new Set(), visited = new Set()
function visit(id) {
  const n = p.checkpoints[id]; assert.ok(n, id); assert.ok(!visiting.has(id), `Cycle ${id}`)
  if (visited.has(id)) return
  assert.ok(p.roles[n.owner]); visiting.add(id)
  for (const dep of n.dependsOn) visit(dep)
  visiting.delete(id); visited.add(id)
}
for (const id of Object.keys(p.checkpoints)) visit(id)
function ancestors(id, result = new Set()) {
  for (const dep of p.checkpoints[id].dependsOn) if (!result.has(dep)) { result.add(dep); ancestors(dep, result) }
  return result
}
for (const id of ['M-default-completion-history', 'F-daily-original-workflow', 'J-two-original-projects', 'G-default-support-refinement', 'D-selected-successor-freeze', 'E-W35-independent']) assert.ok(!ancestors(id).has('B-original-crash-to-accept'), id)
assert.ok(ancestors('B-original-runtime-adoption').has('B-terminal-physical-finalize'))
assert.ok(!ancestors('D-selected-successor-freeze').has('E-selected-cohort-verdict'))
assert.equal(p.providedInputs.BControlDefaultAdmitted, false); assert.equal(p.providedInputs.CNewSyncGuardDefaultAdmitted, false)
assert.equal(p.roles.B.historicalLimit, 4); assert.equal(p.roles.B.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(p.roles.B.resetLedger, false)
assert.equal(p.roles.E.grantId, pilot.grantId); assert.equal(p.roles.E.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
for (const [key, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(p.roles.E[key], pilot.budget[bound])
assert.equal(p.roles.E.maxInFlight, 1)
for (const key of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(p.roles.E[key], false)
const files = [p.actualMainInput, p.sharedInputBoundary, p.sharedProgram, 'agent-tasks/product-wave-36/README.zh-CN.md', 'agent-tasks/product-wave-36/forward-prompts.zh-CN.md', 'reports/releases/wave36-admission/README.zh-CN.md', 'reports/releases/wave36-integration/README.zh-CN.md', ...roles.map(([, r]) => r.packet)]
let links = 0
for (const file of [...files, ...Object.values(p.admissionReports)]) assert.ok(existsSync(resolve(root, file)), file)
for (const file of files) {
  const text = read(file); assert.equal((text.match(/^\s*```/gm) ?? []).length % 2, 0, file)
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#')[0]
    if (!target || /^(https?:|obsidian:|mailto:)/.test(target)) continue
    assert.ok(existsSync(resolve(root, dirname(file), target)), `${file} -> ${target}`); links++
  }
}
console.log(JSON.stringify({ status: 'PASS_WHOLE_SUBSYSTEM_DISPATCH_STATIC_ONLY', externalAgents: 10, ownersIncludingMain: 11, productClosuresPerOwner: 4, retainedPriorAcceptancePointsPerOwner: 9, noMicrophaseExpansion: true, acyclic: true, checkpoints: visited.size, ownershipDisjoint: true, originalBranchesAndDirtyChecked: branches, localLinks: links, runtimeSource: s.source, defaultCompletionHistory: true, originalWorkRecoveryStillRequired: true, W35StaticNotInstalled: true, cacExcluded: true, budgetUnchanged: true, runtimeTestsStarted: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
