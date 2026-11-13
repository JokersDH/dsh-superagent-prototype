import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-20/dispatch.json'))
const pilot = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
for (const source of [plan.reviewBaseline, plan.observedMain, plan.productRuntimeSource, plan.providedInputs.sourceConfirmSource]) assert.match(source, /^[a-f0-9]{40}$/)
for (const field of ['newModelAllowance', 'nativeModelsStartedByThisDispatch']) assert.equal(plan[field], 0)
for (const field of ['newDriverImplementation', 'pilotGatesProductAcceptance', 'normalInstallRequiresRecoveryActivation', 'releaseApproved', 'unboundedPollingAllowed', 'goalsChangeExecutionBudgets']) assert.equal(plan[field], false)
for (const field of ['continueAfterCheckpoint', 'independentQueueRequired', 'goalCoversWholePackage']) assert.equal(plan[field], true)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE'); assert.equal(plan.checkpointsPerOwner, 3)
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 12 }, (_, i) => [5180 + i, 8796 + i]))
for (const field of ['sourceConfirmImplemented', 'explicitWorkflowV2Supported', 'bControlledNormalAnswerApplied', 'bControlledNormalPhysicalStop', 'personalRestoredReadBindingImplemented', 'bOldRegisteredControlAvailable', 'eLatestB911InstalledAdmission']) assert.equal(plan.providedInputs[field], true)
for (const field of ['privatePermissionImplemented', 'targetActivationImplemented', 'bBusinessRecoveryImplemented', 'readBindingGrantsExecution', 'bExactWrapperAdmitted', 'bSubmittedBusinessFeedAvailable', 'aNewFixtureStrictPassed', 'eLatestEeInstalledAdmission']) assert.equal(plan.providedInputs[field], false)
assert.equal(plan.providedInputs.personalRestoredReadBindingSource, plan.productRuntimeSource)
assert.equal(plan.providedInputs.workflowDefaultFormatVersion, 1)
assert.equal(plan.providedInputs.historicalDArtifact.includesPersonalReadStartup, false)
assert.equal(plan.providedInputs.eAdmittedArtifact.source, 'b9117aad12797a3ee3c454172d1f918516a18f33')
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'main'])
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, packet = read(role.packet)
  assert.deepEqual(role.phases, Array.from({ length: 10 }, (_, i) => `${prefix}${i + 1}`))
  for (const phase of role.phases) assert.ok(packet.includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.ok(packet.includes('## 独立备选队列'), role.packet)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave'); assert.ok(role.branch.startsWith('codex/'))
  if (role.candidate) assert.match(role.candidate, /^[a-f0-9]{40}$/)
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
for (const id of ['D-current-bytes', 'E-new-personal-package', 'E-ee-format', 'C-personal-read-consumer', 'A-personal-read-consumer'])
  for (const dep of ['M-private-permission', 'M-target-activation', 'B-recovered-business']) assert.ok(!ancestors(id).has(dep), `${id} gated by unrelated ${dep}`)
assert.ok(ancestors('E-new-personal-package').has('D-current-bytes')); assert.ok(!ancestors('D-current-bytes').has('E-new-personal-package'))
for (const id of ['M-current-product', 'M-source-confirm', 'M-snapshot-versions', 'M-personal-read-binding', 'M-registered-physical-control', 'B-normal-control', 'E-b911-personal-scope']) assert.equal(plan.checkpoints[id].providedByReviewedSource, true)
const b = plan.roles.B, e = plan.roles.E
assert.equal(b.historicalLimit, 4); assert.equal(b.remaining, 'UNKNOWN_NOT_SPENDABLE'); assert.equal(b.resetLedger, false); assert.equal(b.newFeasibilityInvestigations, 0)
assert.equal(e.grantId, pilot.grantId)
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'], ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']]) assert.equal(e[field], pilot.budget[bound])
assert.equal(e.maxInFlight, 1)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(e[field], false)
assert.equal(e.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
const files = ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary, 'docs/rfcs/WP-16/0054-explicit-restored-personal-review.md',
  'reports/releases/wave20-admission/README.zh-CN.md', 'reports/releases/wave20-integration/README.zh-CN.md',
  'agent-tasks/product-wave-20/README.zh-CN.md', 'agent-tasks/product-wave-20/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]
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
for (const path of ['tools/bootstrap/probe-wave20-runtime.mjs', 'tools/bootstrap/probe-wave20-release-gate.mjs', 'tools/dev/review-restored.mjs', 'tests/integration/restored-personal-review.case.mjs']) assert.ok(existsSync(resolve(root, path)), path)
console.log(JSON.stringify({ status: 'PASS_LONG_DISPATCH_STATIC_ONLY', roles: roles.length, phases: 60, checkpoints: visited.size, localLinks: links,
  acyclic: true, nonoverlappingOwners: true, explicitPersonalReadonlyStartupReady: true, gatedNewWrapperNotAdmitted: true,
  normalControlAndB911ScopesPreserved: true, ordinaryInstallIndependentOfActivation: true, budgetUnchanged: true, preservedServicePairs: 12,
  runtimeTests: 0, nativeTurnStarts: 0 }, null, 2))
