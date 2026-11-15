import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const p = json('agent-tasks/product-wave-31/dispatch.json'), prior = json('agent-tasks/product-wave-30/dispatch.json')
const spaces = json('agent-tasks/product-wave-31/workspaces.json'), s = json('reports/releases/wave31-integration/status.json')
const inv = json(p.admissionReports.inventory), delivery = json(p.admissionReports.delivery), recipes = json(p.admissionReports.recipesInsights)
const browser = json(s.browserReport), recipeBrowser = json(s.recipesBrowserReport)
const review = json(s.independentExportReview), pilot = json('tools/experiments/review-pilot-01/protocol.json')
assert.ok(process.argv.slice(2).every(value => value === '--workspaces'))
assert.equal(p.wave, 'product-wave-31'); assert.equal(p.status, 'PLANNED_NOT_EXECUTED')
assert.equal(p.deliveryMode, 'THREE_CONTINUOUS_PACKAGES_OF_FOUR_COMPLETE_OUTCOMES')
assert.equal(p.previousDeliverablesPerOwner, prior.deliverablesPerOwner)
assert.equal(p.deliverablesPerOwner, p.previousDeliverablesPerOwner * 3); assert.equal(p.scopeMultiplier, 3)
assert.equal(p.packagesPerOwner, 3); assert.equal(p.deliverablesPerPackage, 4); assert.equal(p.checkpointsPerOwner, 12)
assert.equal(p.mechanicalMicroPhaseExpansion, false); assert.equal(p.phasesPerOwner, undefined)
assert.equal(p.externalAgentCount, 10); assert.equal(p.totalOwnersIncludingMain, 11)
assert.equal(p.calendarDeadline, null); assert.equal(p.minimumWorkDuration, null)
assert.equal(p.deliveryCadence, 'NORMAL_NO_SAME_DAY_DEADLINE')
for (const key of ['reviewBaseline', 'observedMain', 'productRuntimeSource']) assert.match(p[key], /^[a-f0-9]{40}$/)
for (const key of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage', 'goalCoversWholeSubsystem']) assert.equal(p[key], true)
for (const key of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(p[key], 0)
for (const key of ['releaseApproved', 'newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(p[key], false)
assert.deepEqual(p.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
assert.equal(s.source, p.productRuntimeSource)
assert.equal(s.checks.downloadBackendTransport, 5); assert.equal(s.checks.runnerEndpointAdmissionAdapter, 28)
assert.equal(s.checks.runnerCancelled, 0); assert.equal(s.checks.contracts, 241)
for (const key of ['authenticatedDisplayDownloadImplemented', 'downloadUsesFreshRead', 'formattedValuesNotReverseParsed', 'strictEmbeddedExportAndExactBytes']) assert.equal(s[key], true)
for (const key of ['sourceWorktreesEdited', 'rootLockChanged', 'userServicesRestarted', 'newTarCreated', 'independentR1InstalledAdmission', 'independentR2InstalledAdmission', 'sameOriginalRecoveredDeliveryAdmission', 'valueBenefitAdmission', 'privateTargetActivationAdmission', 'releaseApproved', 'completionRaisedByTestOrTaskCount']) assert.equal(s[key], false)
for (const key of ['newExternalDependencies', 'migrationsAdded', 'realModelTurns', 'nativeTurnStarts']) assert.equal(s[key], 0)
for (const [report, count, expected] of [[browser, 13, 'PASS_ACTUAL_SCOPED_INSIGHTS_APP'], [recipeBrowser, 8, 'PASS_ACTUAL_PROJECT_RECIPE_WORKFLOW']]) {
  assert.equal(report.sourceCommit, s.source); assert.equal(report.sourceWorktreeClean, true)
  assert.equal(report.status, expected); assert.equal(report.cases.length, count)
  assert.ok(report.cases.every(value => value.status === 'PASS')); assert.deepEqual(report.errors, [])
  assert.equal(report.realModelTurns, 0); assert.equal(report.nativeTurnStarts, 0)
}
assert.equal(browser.postRequests, 0); assert.equal(browser.eventDelta, 0); assert.equal(browser.downloads, 2)
assert.equal(browser.exportReads, 6); assert.ok(browser.readonlyRecipePreviewPosts > 0)
assert.equal(recipeBrowser.acceptedWorks, 2); assert.equal(recipeBrowser.unknownAfterRecorded, true)
const creates = recipeBrowser.commands.filter(value => value.kind === 'create_work')
assert.equal(creates.length, 3); assert.equal(creates[0].commandId, creates[1].commandId)
assert.equal(new Set(creates.map(value => value.commandId)).size, 2)
assert.deepEqual(review.remainingFindings, [])
assert.equal(recipes.checks.mainCurrentJSourceByteExact, 5); assert.equal(recipes.checks.mainCurrentGSourceByteExact, 6)
const r1 = p.releaseLanes.R1.artifact
assert.equal(r1.source, delivery.newDArtifact.source); assert.equal(r1.sha256, delivery.newDArtifact.sha256)
assert.equal(r1.buildId, '8296720d8a25f38c'); assert.equal(r1.verifiedEntries, 6849)
assert.equal(r1.sourceClosure.matches, 197); assert.equal(r1.sourceClosure.mismatches.length, 0)
assert.equal(r1.actualPackagedSourcemapInspection.App.usageDays, true)
assert.equal(r1.actualPackagedSourcemapInspection.App.sameServerFields, true)
assert.equal(p.releaseLanes.R1.refreezeForDocsOrTests, false)
assert.equal(p.releaseLanes.R2.state, 'SOURCE_READY_NOT_FROZEN'); assert.equal(p.releaseLanes.R2.source, s.source)
assert.equal(p.releaseLanes.R3.requiresNewTar, false)
assert.notEqual(delivery.eActualTargetAndResourceEvidence.actualSubjectSource, r1.source)
assert.deepEqual(delivery.eActualTargetAndResourceEvidence.counts, { PASS: 278, FAIL: 0, NOT_TESTED: 19 })
assert.equal(delivery.eActualTargetAndResourceEvidence.ordinary.independentRecordedGate, 'PASS')
assert.equal(delivery.eActualTargetAndResourceEvidence.functional.independentRecordedGate, 'PASS')
const roles = Object.entries(p.roles), fixed = new Map(inv.roles.map(value => [value.id, value]))
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'main'])
const inside = (path, rule) => rule.endsWith('/') ? path.startsWith(rule) : path === rule
const owned = (role, path) => role.ownedPaths.some(rule => inside(path, rule)) && !(role.excludedOwnedPaths ?? []).some(rule => inside(path, rule))
const normalized = values => values?.map(value => value.replace(/agent-tasks\/product-wave-\d+\//, 'agent-tasks/current/').replaceAll('wave31', 'wave30'))
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  const names = Array.from({ length: 12 }, (_, i) => `${prefix}${i + 1}`)
  assert.deepEqual(role.deliverables, names); assert.deepEqual(role.milestones, names)
  assert.deepEqual([...packet.matchAll(new RegExp(`^### (${prefix}\\d+) `, 'gm'))].map(value => value[1]), names, role.packet)
  assert.equal((packet.match(/^## 交付包[一二三]/gm) ?? []).length, 3)
  for (const heading of ['## 独立备选队列', '## 整包完成条件']) assert.ok(packet.includes(heading), role.packet)
  for (const [i, entry] of role.packages.entries()) assert.deepEqual(entry.outcomes, names.slice(i * 4, i * 4 + 4))
  assert.equal(role.workdir, prior.roles[id].workdir); assert.equal(role.branch, prior.roles[id].branch)
  assert.deepEqual(normalized(role.ownedPaths), normalized(prior.roles[id].ownedPaths))
  assert.deepEqual(role.excludedOwnedPaths, prior.roles[id].excludedOwnedPaths)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  if (id !== 'main') assert.equal(role.candidate, fixed.get(id).head)
  assert.equal(spaces.roles[id].packet, role.packet); assert.equal(spaces.roles[id].newlyPrepared, false)
  assert.ok(id === 'main' ? role.evidencePath.startsWith('reports/releases/') : owned(role, role.evidencePath))
}
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths) {
  if (!a.startsWith(b) && !b.startsWith(a)) continue
  const intersection = a.length >= b.length ? a : b
  assert.ok(!owned(roles[i][1], intersection) || !owned(roles[j][1], intersection), `${roles[i][0]}/${roles[j][0]} at ${intersection}`)
}
assert.equal(spaces.createdNewWorktreesThisWave, 0)
for (const key of ['createdUserThreads', 'externalPromptsSent', 'newRootsCopyUntrackedOrUserState']) assert.equal(spaces[key], false)
assert.equal(spaces.nativeModelAllowanceAdded, 0)
const active = new Set(), visited = new Set()
function visit(id) { const value = p.checkpoints[id]; assert.ok(value, id); assert.ok(!active.has(id), `Cycle ${id}`)
  if (visited.has(id)) return; assert.ok(p.roles[value.owner]); active.add(id)
  for (const dep of value.dependsOn) visit(dep); active.delete(id); visited.add(id) }
for (const id of Object.keys(p.checkpoints)) visit(id)
function ancestors(id, result = new Set()) { for (const dep of p.checkpoints[id].dependsOn) if (!result.has(dep)) { result.add(dep); ancestors(dep, result) } return result }
for (const id of ['F-daily-workbench', 'G-export-consumer', 'J-project-journey', 'D-R2-freeze', 'E-colleague-workflow'])
  for (const dep of ['B-same-work-crash-to-delivery', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by ${dep}`)
assert.ok(ancestors('B-same-work-crash-to-delivery').has('B-independent-spawn-birth'))
assert.ok(ancestors('B-same-work-crash-to-delivery').has('H-safe-unknown-retain'))
assert.ok(ancestors('E-R1-independent').has('E-safe-complete-resource-observation'))
assert.ok(!ancestors('D-R2-freeze').has('E-R2-independent'))
assert.equal(p.roles.B.historicalLimit, 4); assert.equal(p.roles.B.remaining, 'UNKNOWN_NOT_SPENDABLE')
assert.equal(p.roles.B.resetLedger, false); assert.equal(p.roles.B.newFeasibilityInvestigations, 0)
const e = p.roles.E; assert.equal(e.grantId, pilot.grantId)
for (const [key, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[key], pilot.budget[bound])
assert.equal(e.maxInFlight, 1); assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
for (const key of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[key], false)
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', p.sharedBoundary, p.sharedInputBoundary, p.actualMainInput,
  'reports/releases/wave31-admission/README.zh-CN.md', 'reports/releases/wave31-integration/README.zh-CN.md',
  'agent-tasks/product-wave-31/README.zh-CN.md', 'agent-tasks/product-wave-31/forward-prompts.zh-CN.md', ...roles.map(([, value]) => value.packet)]
let links = 0
for (const path of [...p.contracts, ...Object.values(p.admissionReports), p.completionEstimateRef, ...files]) assert.ok(existsSync(resolve(root, path)), path)
for (const path of files) { const text = read(path); assert.equal((text.match(/^\s*```/gm) ?? []).length % 2, 0, path)
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) { let target = match[1].trim().replace(/^<|>$/g, '')
    if (/^(https?:|obsidian:|mailto:|#)/.test(target)) continue
    target = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '')
    if (!target || target.includes(' ')) continue
    assert.ok(existsSync(resolve(root, dirname(path), target)), `${path} -> ${target}`); links++ }
}
let workspaces = 0
if (process.argv.includes('--workspaces')) for (const [id, role] of roles) {
  assert.equal(execFileSync('git', ['-C', role.workdir, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), role.branch, id); workspaces++ }
console.log(JSON.stringify({ status: 'PASS_THREE_TIMES_OUTCOME_PROGRAM_STATIC_ONLY', externalAgents: 10,
  ownersIncludingMain: 11, packagesPerOwner: 3, completeOutcomesPerOwner: 12, scopeMultiplier: 3,
  totalPlannedOutcomesIncludingMain: 132, mechanicalMicroPhaseExpansion: false, checkpoints: visited.size,
  localLinks: links, localWorkspacesChecked: workspaces, ownershipDisjoint: true, acyclic: true, lockedR1: true,
  R2Separate: true, sourceAndInstalledSeparate: true, budgetUnchanged: true, preservedServicePairs: 12,
  runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
