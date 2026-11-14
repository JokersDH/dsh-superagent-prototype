import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-24/dispatch.json'))
const prior = JSON.parse(read('agent-tasks/product-wave-23/dispatch.json'))
const pilot = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
const integration = JSON.parse(read('reports/releases/wave24-integration/status.json'))
const browser = JSON.parse(read(integration.browserReport))
assert.equal(plan.wave, 'product-wave-24'); assert.equal(plan.date, '2026-11-14')
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
for (const source of [plan.reviewBaseline, plan.observedMain, plan.productRuntimeSource]) assert.match(source, /^[a-f0-9]{40}$/)
for (const field of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[field], 0)
for (const field of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[field], false)
for (const field of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[field], true)
assert.equal(plan.checkpointsPerOwner, 3); assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
const inputs = plan.providedInputs
for (const field of ['sourceConfirmImplemented', 'ordinaryDistributionIntegrated', 'scopeDiagnosticImplemented', 'scopeDiagnosticUiImplemented', 'scopeUiExplicitOptInOnly', 'cliHelpImplemented', 'aIndependentProcessReadPassed', 'cSourceStrictIdentityHttpBoundsPassed', 'bNewModuleStrictPassed', 'bOldControlPreserved', 'bSourceIdentityPrewriteAndSmallPagesPassed', 'dNewClosureAll78Match', 'dHelpSliceAdmitted', 'dOriginalBrokerIdsThroughSingleBundleProven', 'eMeasuredA9bPreserved', 'eHistorical595Preserved', 'eOldFourOmissionContradictionGatesClosed']) assert.equal(inputs[field], true, field)
for (const field of ['scopeUiGrantsAuthority', 'aManifestTrustedSubjectAndCoverageAdmitted', 'cPackageActualStartAdmitted', 'cPackageEntryIdentityCleanupDeadlineAdmitted', 'bCompleteCommandIdentityAdmitted', 'bLargeFrameAndPageBoundsAdmitted', 'bFirstHandoverAdmitted', 'bFactSinkBrokerRebindingImplemented', 'bBusinessRecoveryImplemented', 'privatePermissionImplemented', 'targetActivationImplemented', 'dPreRecordAndFreshCleanupAdmitted', 'dTwoIndependentSnapshotRestoreConsumersProven', 'eImmutableCapabilityAndDiagnosticBoundsAdmitted', 'eFinal0edeInstalledAdmission', 'eNewMainUiInstalledAdmission']) assert.equal(inputs[field], false, field)
assert.equal(inputs.scopeUiSource, plan.productRuntimeSource); assert.equal(inputs.scopeUiCleanBrowserCases, 13)
assert.equal(integration.source, plan.productRuntimeSource); assert.equal(browser.sourceCommit, integration.source)
assert.equal(browser.sourceWorktreeClean, true); assert.equal(browser.status, 'PASS_CONTEXT_HISTORY_WORKBENCH')
assert.equal(browser.cases.length, 13); assert.ok(browser.cases.every(value => value.status === 'PASS'))
assert.deepEqual(browser.errors, []); assert.equal(browser.readTriggeredMockReplies, 0)
assert.equal(integration.checks.transportTests, 4); assert.equal(integration.checks.cliHelpTests, 1)
assert.equal(integration.checks.visualRounds, 2); assert.equal(integration.uiUpdated, true)
assert.equal(integration.scopeDiagnosticOptInOnly, true); assert.equal(integration.scopeDiagnosticGrantsAuthority, false)
for (const field of ['userServicesRestarted', 'newPersistentPreviewStarted', 'frozenTarCreated', 'independentInstalledAdmission', 'releaseApproved']) assert.equal(integration[field], false)
for (const field of ['realModelTurns', 'nativeTurnStarts', 'migrationsAdded']) assert.equal(integration[field], 0)
assert.equal(inputs.dArtifact.source, '0ede11d0a46f377e90657c78b001357c98d4f5e7')
assert.equal(inputs.dArtifact.sha256, 'd039889767cb63902ed5e00d02547c441aa2313ce79555d90747e9a0b1fabf21')
assert.equal(inputs.dArtifact.verifiedEntries, 6747)
assert.equal(inputs.dArtifact.eFinalInstalledVerdictForThisArtifact, 'NOT_REACHED')
assert.equal(inputs.eMeasuredA9b.subjectSource, 'a9b155c13be197d828544a26f4827cf9d4acab68')
assert.deepEqual(inputs.eMeasuredA9b.counts, { PASS: 208, FAIL: 0, NOT_TESTED: 15 })
assert.notEqual(inputs.dArtifact.source, inputs.eMeasuredA9b.subjectSource)
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
for (const id of ['D-current-ui-bytes', 'D-same-data-dual-restore', 'E-current-package', 'E-ordinary-verdict'])
  for (const dep of ['B-resumed-business', 'M-private-permission', 'M-target-activation']) assert.ok(!ancestors(id).has(dep), `${id} gated by unrelated ${dep}`)
for (const dep of ['D-current-ui-bytes', 'E-capability-and-schema-gate']) assert.ok(ancestors('E-current-package').has(dep))
assert.ok(!ancestors('D-current-ui-bytes').has('E-current-package'))
assert.ok(!ancestors('D-current-ui-bytes').has('D-safe-pre-record-cleanup'))
assert.ok(ancestors('D-same-data-dual-restore').has('D-safe-pre-record-cleanup'))
for (const id of ['M-scope-ui', 'M-cli-help', 'A-new-process-read', 'C-source-driver', 'B-source-pages', 'D-0ede-frozen', 'D-current-closure', 'E-a9b-measured', 'E-old-four-gates']) assert.equal(plan.checkpoints[id].providedByReviewedSource, true, id)
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[field], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[field], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary,
  'docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md', 'docs/guides/main-distribution.zh-CN.md',
  'reports/releases/wave24-admission/README.zh-CN.md', 'reports/releases/wave24-integration/README.zh-CN.md',
  'agent-tasks/product-wave-24/README.zh-CN.md', 'agent-tasks/product-wave-24/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
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
for (const path of ['reports/releases/wave24-admission/context.json', 'reports/releases/wave24-admission/runtime.json', 'reports/releases/wave24-admission/delivery.json', 'reports/releases/wave24-integration/browser-final/scope-desktop.png', 'reports/releases/wave24-integration/browser-final/scope-mobile.png']) assert.ok(existsSync(resolve(root, path)), path)
console.log(JSON.stringify({ status: 'PASS_LONG_DISPATCH_STATIC_ONLY', roles: roles.length, phases: 60,
  checkpoints: visited.size, localLinks: links, acyclic: true, nonoverlappingOwners: true,
  actualScopeUiAdmitted: true, oldClosedFindingsPreserved: true, originalSubjectAndBusinessClosureRequired: true,
  measuredA9bPreserved: true, newUiArtifactVerdictStillRequired: true, ordinaryInstallIndependentOfActivation: true,
  budgetUnchanged: true, preservedServicePairs: 12, runtimeTests: 0, nativeTurnStarts: 0, releaseApproved: false }, null, 2))
