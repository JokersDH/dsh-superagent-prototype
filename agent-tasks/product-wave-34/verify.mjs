import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const p = json('agent-tasks/product-wave-34/dispatch.json')
const prior = json('agent-tasks/product-wave-33/dispatch.json')
const spaces = json('agent-tasks/product-wave-34/workspaces.json')
const inv = json(p.admissionReports.inventory), s = json('reports/releases/wave34-integration/status.json')
const delivery = json(p.admissionReports.delivery), pilot = json('tools/experiments/review-pilot-01/protocol.json')
assert.ok(process.argv.slice(2).every(value => value === '--workspaces'))
assert.equal(p.wave, 'product-wave-34'); assert.equal(p.status, 'PLANNED_NOT_EXECUTED_BY_EXTERNAL_AGENTS')
assert.equal(p.externalAgentCount, 10); assert.equal(p.totalOwnersIncludingMain, 11)
assert.equal(p.continuousPackagesPerOwner, 2); assert.equal(p.completeOutcomesPerPackage, 3); assert.equal(p.completeOutcomesPerOwner, 6)
for (const key of ['wholeGoalPerOwner', 'continueAfterSourceHandoff', 'independentQueueRequired', 'normalCadence']) assert.equal(p[key], true)
assert.equal(p.microPhaseExpansion, false); assert.equal(p.calendarDeadline, null); assert.equal(p.tokenBudgetAdded, false)
assert.equal(p.scope.cac, 'DEFERRED_EXCLUDED'); assert.equal(p.scope.temporaryZipSprint, false)
for (const key of ['newModelAllowance', 'nativeModelsStartedByDispatch', 'newUserThreads', 'newWorktrees']) assert.equal(p[key], 0)
for (const key of ['externalPromptsSent', 'releaseApproved', 'completionEstimateChangedByTaskCount']) assert.equal(p[key], false)
assert.deepEqual(p.preservedServicePairs, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
assert.equal(p.mainRuntimeSource, s.source)
assert.equal(s.checks.nativeClassCallbacks + s.checks.attachedRealStore, 15)
assert.equal(s.checks.supportHTTP + s.checks.supportTransport, 5); assert.equal(s.checks.contracts, 241)
assert.equal(json('packages/contracts/generated/manifest.json').schemaHash, s.checks.runnerFrozenHash)
assert.equal(s.callbackPort.autoAttach, false); assert.equal(s.callbackPort.publicHTTPExposure, false)
assert.equal(s.callbackPort.originalFreshGuardPreserved, true); assert.equal(s.callbackPort.rawCandidateFeedCancelImported, false)
assert.equal(s.support.actualAppDownload, true); assert.equal(s.support.strictPublicProjection, true)
assert.equal(s.support.origin, null); assert.equal(s.support.exportCapability, 'unverified'); assert.equal(s.support.arbitraryUploadHandler, false)
const delta = execFileSync('git', ['diff', '--name-only', s.source, s.browserTestSource], { cwd: root, encoding: 'utf8' }).trim().split('\n')
assert.deepEqual(delta, s.browserOnlySourceDelta)
const recipe = json(s.browserReport), observation = json(s.observationReport)
for (const [report, count, source] of [[recipe, 9, s.source], [observation, 16, s.browserTestSource]]) {
  assert.equal(report.sourceCommit, source); assert.equal(report.sourceWorktreeClean, true)
  assert.equal(report.cases.length, count); assert.ok(report.cases.every(value => value.status === 'PASS'))
  assert.deepEqual(report.errors, []); assert.equal(report.realModelTurns, 0); assert.equal(report.nativeTurnStarts, 0)
}
assert.equal(recipe.acceptedWorks, 2); assert.equal(recipe.unknownAfterRecorded, true)
const creates = recipe.commands.filter(value => value.kind === 'create_work')
assert.equal(creates.length, 3); assert.equal(creates[0].commandId, creates[1].commandId)
assert.equal(new Set(creates.map(value => value.commandId)).size, 2)
assert.equal(observation.postRequests, 0); assert.equal(observation.eventDelta, 0)
assert.equal(observation.downloads, 4); assert.equal(observation.supportDownloads, 2)
assert.ok(observation.readonlyRecipePreviewPosts > 0)
for (const key of ['newDependencies', 'newMigrations', 'realModelTurns', 'nativeTurnStarts']) assert.equal(s[key], 0)
for (const key of ['candidateWorktreesEdited', 'newTarCreated', 'newPersistentServiceStarted', 'userTwelveServicesTouched', 'fullOriginalWorkRecovery', 'actualNativeAdmission', 'independentInstalledAdmission', 'valueBenefitAdmission', 'releaseApproved', 'completionEstimateChanged']) assert.equal(s[key], false)
assert.equal(p.knownCohort.source, delivery.newDCurrentCohort.source)
assert.equal(p.knownCohort.zipSha256, delivery.newDCurrentCohort.zipSha256)
assert.equal(p.knownCohort.innerManifestEntries, 6867); assert.equal(p.knownCohort.EIndependent, false)
assert.equal(p.knownCohort.containsFc38, true); assert.equal(p.knownCohort.containsNew23d5a98e, false)
const fixed = new Map(inv.roles.map(value => [value.id, value])), roles = Object.entries(p.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'main'])
const normalize = paths => paths.map(path => path.replace(/product-wave-\d+/, 'product-wave-current'))
const inside = (path, rule) => rule.endsWith('/') ? path.startsWith(rule) : path === rule
const owned = (r, path) => r.ownedPaths.some(rule => inside(path, rule)) && !(r.excludedOwnedPaths ?? []).some(rule => inside(path, rule))
let branches = 0
for (const [id, r] of roles) {
  const old = prior.roles[id], text = read(r.packet)
  assert.equal(r.branch, old.branch); assert.equal(r.workdir, old.workdir)
  assert.deepEqual(normalize(r.ownedPaths), normalize(old.ownedPaths)); assert.deepEqual(r.excludedOwnedPaths, old.excludedOwnedPaths)
  assert.equal(r.outcomes.length, 6); assert.equal(r.packages.length, 2)
  assert.deepEqual(r.packages.flatMap(value => value.outcomeIndexes), [0, 1, 2, 3, 4, 5])
  assert.equal((text.match(/^### /gm) ?? []).length, 6); assert.equal((text.match(/^## 工程包[一二]：/gm) ?? []).length, 2)
  assert.match(text, /独立.*队列/); assert.match(text, /完成条件/)
  assert.equal(r.wholeGoalCoversOutcomes, true); assert.equal(r.budgetMode, 'zero_native_model_tasks_this_wave')
  if (id !== 'main') assert.equal(r.candidate, fixed.get(id).head)
  assert.equal(spaces.roles[id].packet, r.packet); assert.equal(spaces.roles[id].newlyPrepared, false)
  assert.ok(id === 'main' ? r.evidencePath.startsWith('reports/releases/') : owned(r, r.evidencePath))
  if (process.argv.includes('--workspaces')) {
    const git = args => execFileSync('git', ['-C', r.workdir, ...args], { encoding: 'utf8' }).trim()
    assert.equal(git(['branch', '--show-current']), r.branch)
    if (id !== 'main') {
      assert.equal(git(['rev-parse', 'HEAD']), fixed.get(id).head)
      assert.equal(git(['status', '--porcelain']), fixed.get(id).dirty.trim())
    }
    branches++
  }
}
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const path = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], path) || !owned(roles[j][1], path), `${roles[i][0]}/${roles[j][0]} ${path}`)
}
assert.equal(spaces.createdNewWorktrees, 0); assert.equal(spaces.createdUserThreads, false)
assert.equal(spaces.externalPromptsSent, false); assert.equal(spaces.copyUserState, false)
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
for (const id of ['A-history-reader', 'C-current-decision-snapshot', 'F-daily-original-workflow', 'J-two-original-projects', 'G-default-support-refinement', 'D-selected-successor-freeze', 'E-two-project-journey']) assert.ok(!ancestors(id).has('B-original-crash-to-accept'), id)
assert.ok(ancestors('B-original-crash-to-accept').has('B-proven-spawn-authority'))
assert.ok(ancestors('E-selected-cohort-verdict').has('E-strict-resource-and-journey-oracle'))
assert.ok(!ancestors('D-selected-successor-freeze').has('E-selected-cohort-verdict'))
assert.equal(p.roles.B.historicalLimit, 4); assert.equal(p.roles.B.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(p.roles.B.resetLedger, false)
assert.equal(p.roles.E.grantId, pilot.grantId); assert.equal(p.roles.E.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
for (const [key, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(p.roles.E[key], pilot.budget[bound])
assert.equal(p.roles.E.maxInFlight, 1)
for (const key of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(p.roles.E[key], false)
const files = [p.actualMainInput, p.sharedInputBoundary, p.sharedProgram, 'agent-tasks/product-wave-34/README.zh-CN.md', 'agent-tasks/product-wave-34/forward-prompts.zh-CN.md', 'reports/releases/wave34-admission/README.zh-CN.md', 'reports/releases/wave34-integration/README.zh-CN.md', ...roles.map(([, r]) => r.packet)]
let links = 0
for (const file of [...files, ...Object.values(p.admissionReports), ...s.screenshotsInspected]) assert.ok(existsSync(resolve(root, file)), file)
for (const file of files) {
  const text = read(file); assert.equal((text.match(/^\s*```/gm) ?? []).length % 2, 0, file)
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#')[0]
    if (!target || /^(https?:|obsidian:|mailto:)/.test(target)) continue
    assert.ok(existsSync(resolve(root, dirname(file), target)), `${file} -> ${target}`); links++
  }
}
console.log(JSON.stringify({ status: 'PASS_ENGINEERING_DISPATCH_STATIC_ONLY', externalAgents: 10, ownersIncludingMain: 11, continuousPackagesPerOwner: 2, completeOutcomesPerOwner: 6, plannedOutcomes: 66, acyclic: true, checkpoints: visited.size, ownershipDisjoint: true, preservedCandidateBranchesChecked: branches, localLinks: links, runtimeSource: s.source, callbackConsumerPublished: true, defaultSupportConsumer: true, originalWorkRecoveryStillRequired: true, fixedW33NotRefrozen: true, cacExcluded: true, budgetUnchanged: true, runtimeTestsStarted: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
