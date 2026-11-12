import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-14/dispatch.json'))
const protocol = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.match(plan.productBaseline, /^[a-f0-9]{40}$/)
for (const path of [plan.sharedBoundary, ...plan.contracts]) assert.ok(existsSync(resolve(root, path)), path)
assert.equal(plan.newModelAllowance, 0)
assert.equal(plan.nativeModelsStartedByThisDispatch, 0)
assert.equal(plan.newDriverImplementation, false)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.equal(plan.pilotGatesProductAcceptance, false)
assert.equal(plan.normalInstallRequiresRecoveryActivation, false)
assert.equal(plan.providedInputs.ordinaryInstallBaselineAvailableNow, true)
assert.equal(plan.providedInputs.noExecutorPersonalStartup, true)
assert.equal(plan.providedInputs.sourceBaselineConsumerImplemented, false)
assert.equal(plan.providedInputs.targetActivationImplemented, false)
assert.equal(plan.checkpointsPerOwner, 3)
assert.equal(plan.continueAfterCheckpoint, true)
assert.equal(plan.independentQueueRequired, true)
assert.equal(plan.unboundedPollingAllowed, false)
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 11 }, (_, i) => [5180 + i, 8796 + i]))
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'main'])
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id, text = read(role.packet)
  assert.deepEqual(role.phases, Array.from({ length: 10 }, (_, i) => `${prefix}${i + 1}`))
  for (const phase of role.phases) assert.ok(text.includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.ok(text.includes('## 独立备选队列'), role.packet)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  if (role.candidate) assert.match(role.candidate, /^[a-f0-9]{40}$/)
}
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++)
  for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths)
    assert.ok(!a.startsWith(b) && !b.startsWith(a), `${roles[i][0]} / ${roles[j][0]} owner overlap`)
const active = new Set(), visited = new Set()
function visit(id) {
  const node = plan.checkpoints[id]
  assert.ok(node, `Missing checkpoint ${id}`); assert.ok(!active.has(id), `Cycle at ${id}`)
  if (visited.has(id)) return
  assert.ok(plan.roles[node.owner], `Missing owner ${id}`)
  active.add(id); for (const dep of node.dependsOn) visit(dep); active.delete(id); visited.add(id)
}
for (const id of Object.keys(plan.checkpoints)) visit(id)
function ancestors(id, result = new Set()) {
  for (const dep of plan.checkpoints[id].dependsOn) if (!result.has(dep)) { result.add(dep); ancestors(dep, result) }
  return result
}
for (const id of ['M-personal-baseline', 'D-bytes', 'E-installed', 'M-source-consumer', 'M-context', 'M-candidate-product', 'M-activation'])
  for (const study of ['B-refusal', 'E-refusal']) assert.ok(!ancestors(id).has(study), `${id} gated by study`)
for (const id of ['M-personal-baseline', 'D-bytes', 'E-installed'])
  for (const restoration of ['M-activation', 'E-activation']) assert.ok(!ancestors(id).has(restoration), `${id} gated by restoration`)
assert.ok(!ancestors('D-bytes').has('E-installed'))
assert.ok(ancestors('E-installed').has('D-bytes'))
assert.equal(plan.checkpoints['M-personal-baseline'].providedByReviewedSource, true)
assert.equal(plan.checkpoints['A-reviewed-source'].providedByReviewedSource, true)
const grant = plan.roles.E
for (const [field, bound] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'],
  ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']])
  assert.equal(grant[field], protocol.budget[bound])
assert.equal(grant.grantId, protocol.grantId)
for (const field of ['resetLedger', 'unknownCostIsZero', 'cliFallbackAllowed']) assert.equal(grant[field], false)
assert.equal(grant.maxInFlight, 1)
assert.equal(grant.reconcileActualLedgerBeforeSend, true)
assert.equal(grant.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
assert.equal(plan.roles.B.historicalLimit, 4)
assert.equal(plan.roles.B.remaining, 'UNKNOWN_NOT_SPENDABLE')
assert.equal(plan.roles.B.resetLedger, false)
assert.equal(plan.roles.B.newFeasibilityInvestigations, 0)
const estimate = JSON.parse(read(plan.completionEstimateRef))
assert.equal(estimate.stableAlpha.deliverables.reduce((n, item) => n + item.weight, 0), 100)
assert.equal(estimate.releaseApproved, false)
let links = 0
for (const path of ['AGENTS.md', 'START-HERE.zh-CN.md', plan.sharedBoundary, 'agent-tasks/product-wave-14/README.zh-CN.md',
  'agent-tasks/product-wave-14/forward-prompts.zh-CN.md', ...roles.map(([, role]) => role.packet)]) {
  const text = read(path)
  assert.equal((text.match(/^\s*```/gm) ?? []).length % 2, 0, path)
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '')
    if (/^(https?:|obsidian:|mailto:|#)/.test(target)) continue
    target = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '')
    if (!target || target.includes(' ')) continue
    assert.ok(existsSync(resolve(root, dirname(path), target)), `${path} -> ${target}`); links++
  }
}
console.log(JSON.stringify({ status: 'PASS_LONG_DISPATCH_STATIC_ONLY', roles: roles.length, phases: 60,
  checkpoints: visited.size, localLinks: links, acyclic: true, nonoverlappingOwners: true, continueAfterCheckpoint: true,
  normalInstallIndependentOfRestoration: true, productIndependentOfBlockedStudy: true, budgetUnchanged: true,
  runtimeTests: 0, nativeTurnStarts: 0 }, null, 2))
