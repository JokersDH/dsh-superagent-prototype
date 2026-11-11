import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-10/dispatch.json'))
const protocol = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.match(plan.reviewBaseline, /^[a-f0-9]{40}$/)
assert.match(plan.interfaceCheckpoint, /^[a-f0-9]{7,40}$/)
for (const path of [plan.sharedBoundary, plan.contextBindingContract, plan.targetContract]) assert.ok(existsSync(resolve(root, path)))
assert.equal(plan.newModelAllowance, 0)
assert.equal(plan.nativeModelsStartedByThisDispatch, 0)
assert.equal(plan.newDriverImplementation, false)
assert.equal(plan.pilotGatesProductAcceptance, false)
assert.equal(plan.normalInstallRequiresRecoveryActivation, false)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, Array.from({ length: 8 }, (_, i) => [5180 + i, 8796 + i]))
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A','B','C','D','E','main'])
for (const [id, role] of roles) {
  const prefix = id === 'main' ? 'M' : id
  assert.deepEqual(role.phases, Array.from({ length: 6 }, (_, i) => `${prefix}${i + 1}`))
  for (const phase of role.phases) assert.ok(read(role.packet).includes(`## ${phase} `), `${role.packet}: ${phase}`)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  if (role.candidate) assert.match(role.candidate, /^[a-f0-9]{40}$/)
}
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++)
  for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths)
    assert.ok(!a.startsWith(b) && !b.startsWith(a), `${roles[i][0]} / ${roles[j][0]} owner overlap`)
const active = new Set(), visited = new Set()
function visit(id) {
  assert.ok(plan.checkpoints[id], `Missing dependency ${id}`)
  assert.ok(!active.has(id), `Cycle at ${id}`)
  if (visited.has(id)) return
  active.add(id)
  assert.ok(plan.roles[plan.checkpoints[id].owner], `Missing owner ${id}`)
  for (const dependency of plan.checkpoints[id].dependsOn) visit(dependency)
  active.delete(id); visited.add(id)
}
for (const id of Object.keys(plan.checkpoints)) visit(id)
function ancestors(id, result = new Set()) {
  for (const dep of plan.checkpoints[id].dependsOn) if (!result.has(dep)) { result.add(dep); ancestors(dep, result) }
  return result
}
for (const id of ['E-current-ui','M-context-use','M-target-prepare','M-activation','M-install-freeze','D-install-bytes','E-new-install'])
  for (const research of ['B-sender','E-sender-refusal']) assert.ok(!ancestors(id).has(research), `${id} gated by blocked study`)
for (const id of ['M-install-freeze','D-install-bytes','E-new-install'])
  for (const restoration of ['M-activation','E-activation']) assert.ok(!ancestors(id).has(restoration), `${id} gated by restoration`)
assert.ok(!ancestors('M-install-freeze').has('E-new-install'))
assert.ok(ancestors('E-new-install').has('D-install-bytes'))
const grant = plan.roles.E
for (const [field, protocolField] of [['maxNativeTurnStarts','maxTotalTurnStarts'],['maxAuthorTurnStarts','maxAuthorTurnStarts'],
  ['maxReviewTurnStarts','maxReviewTurnStarts'],['maxBillableTokens','maxTotalBillableTokens'],['maxCostUSD','maxTotalCostUSD']])
  assert.equal(grant[field], protocol.budget[protocolField])
assert.equal(grant.grantId, protocol.grantId)
assert.equal(grant.maxInFlight, 1)
assert.equal(grant.resetLedger, false)
assert.equal(grant.unknownCostIsZero, false)
assert.equal(grant.cliFallbackAllowed, false)
assert.equal(grant.reconcileActualLedgerBeforeSend, true)
assert.equal(grant.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
assert.equal(plan.roles.B.historicalLimit, 4)
assert.equal(plan.roles.B.remaining, 'UNKNOWN_NOT_SPENDABLE')
assert.equal(plan.roles.B.resetLedger, false)
assert.equal(plan.roles.B.newFeasibilityInvestigations, 0)
let links = 0
for (const path of ['AGENTS.md','START-HERE.zh-CN.md',plan.sharedBoundary,'agent-tasks/product-wave-10/README.zh-CN.md',...roles.map(([,r])=>r.packet)]) {
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
console.log(JSON.stringify({ status: 'PASS_DISPATCH_STATIC_ONLY', roles: roles.length, phases: 36,
  checkpoints: visited.size, localLinks: links, acyclic: true, nonoverlappingOwners: true,
  normalInstallIndependentOfRestoration: true, productIndependentOfBlockedStudy: true,
  budgetUnchanged: true, runtimeTests: 0, nativeTurnStarts: 0 }, null, 2))
