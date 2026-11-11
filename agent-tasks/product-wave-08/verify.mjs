import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only plan checks. Never starts product/native processes, writes evidence or changes a ledger.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-08/dispatch.json'))
const protocol = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.match(plan.baseline, /^[a-f0-9]{40}$/)
assert.equal(plan.newModelAllowance, 0)
assert.equal(plan.nativeModelsStartedByThisDispatch, 0)
assert.equal(plan.newDriverImplementation, false)
assert.equal(plan.pilotGatesProductAcceptance, false)
assert.equal(plan.studyState, 'BLOCKED_CURRENT_RECIPE')
assert.deepEqual(plan.preservedUserServices, [[5180, 8796], [5181, 8797], [5182, 8798], [5183, 8799], [5184, 8800], [5185, 8801]])
const roles = Object.entries(plan.roles)
assert.deepEqual(roles.map(([id]) => id).sort(), ['A', 'B', 'C', 'D', 'E', 'main'])
for (const [id, role] of roles) {
  assert.ok(existsSync(resolve(root, role.packet)), role.packet)
  const prefix = id === 'main' ? 'M' : id
  assert.deepEqual(role.phases, Array.from({ length: 6 }, (_, i) => `${prefix}${i + 1}`))
  for (const phase of role.phases) assert.ok(read(role.packet).includes(`## ${phase} `), `${id}: missing ${phase}`)
  assert.equal(role.budgetMode, 'zero_native_model_tasks_this_wave')
  if (role.candidate) {
    assert.match(role.candidate, /^[a-f0-9]{40}$/)
    assert.equal(role.candidateStatus, 'REVIEWED_NOT_ADMITTED_BY_THIS_PLAN')
  }
}
const nodes = new Map(plan.milestones.map(node => [node.id, node]))
assert.equal(nodes.size, plan.milestones.length)
const active = new Set(), visited = new Set()
function visit(id) {
  assert.ok(nodes.has(id), `Missing dependency ${id}`)
  assert.ok(!active.has(id), `Dependency cycle at ${id}`)
  if (visited.has(id)) return
  active.add(id)
  for (const dep of nodes.get(id).dependsOn) visit(dep)
  active.delete(id)
  visited.add(id)
}
for (const [id, node] of nodes) {
  assert.ok(plan.roles[node.owner]?.phases.includes(node.phase), `Unknown owner/phase ${id}`)
  assert.equal(node.status, 'NOT_STARTED', id)
  visit(id)
}
for (const [owner, role] of roles) for (const phase of role.phases)
  assert.ok(plan.milestones.some(node => node.owner === owner && node.phase === phase), `${owner}: missing ${phase}`)
function ancestors(id, result = new Set()) {
  for (const dep of nodes.get(id).dependsOn) if (!result.has(dep)) {
    result.add(dep)
    ancestors(dep, result)
  }
  return result
}
for (const id of ['M2', 'M3', 'M4', 'M5-freeze', 'M5-admission', 'D4', 'D6', 'E3', 'E4', 'E5'])
  for (const study of ['E2', 'B4']) assert.ok(!ancestors(id).has(study), `Study gates product: ${id} <- ${study}`)
assert.equal(nodes.get('M1-interfaces').dependsOn.length, 0, 'Main must publish without waiting for whole owned packages')
assert.ok(!ancestors('M2').has('M1-source'), 'Existing proposal UI must not wait for new A/C/D source')
assert.ok(ancestors('M3').has('C2'), 'Context must wait for authorized composer')
assert.ok(ancestors('M4').has('A2') && ancestors('M4').has('B2'), 'Activation needs production facts and current resources')
for (const id of ['E4', 'E5', 'M5-admission']) assert.ok(!ancestors('M5-freeze').has(id), 'Artifact freeze must precede final acceptance')
const grant = plan.roles.E
for (const [field, protocolField] of [['maxNativeTurnStarts', 'maxTotalTurnStarts'], ['maxAuthorTurnStarts', 'maxAuthorTurnStarts'],
  ['maxReviewTurnStarts', 'maxReviewTurnStarts'], ['maxBillableTokens', 'maxTotalBillableTokens'], ['maxCostUSD', 'maxTotalCostUSD']])
  assert.equal(grant[field], protocol.budget[protocolField])
assert.equal(grant.grantId, protocol.grantId)
assert.equal(grant.maxInFlight, 1)
assert.equal(grant.resetLedger, false)
assert.equal(grant.executionPolicy, 'BLOCKED_CURRENT_RECIPE_NO_SEND_THIS_WAVE')
assert.equal(grant.cliFallbackAllowed, false)
assert.equal(grant.unknownCostIsZero, false)
assert.equal(grant.unverifiedLegacyMigrationAllowed, false)
assert.equal(grant.reconcileActualLedgerBeforeSend, true)
assert.equal(protocol.budget.stopAtFirstLimit, true)
assert.equal(plan.roles.B.historicalLimit, 4)
assert.equal(plan.roles.B.grantId, 'wave03-b-native')
assert.equal(plan.roles.B.remaining, 'UNKNOWN_NOT_SPENDABLE')
assert.equal(plan.roles.B.resetLedger, false)
assert.equal(plan.roles.B.newFeasibilityInvestigations, 0)
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++)
  for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths)
    assert.ok(!a.startsWith(b) && !b.startsWith(a), `Owner overlap: ${roles[i][0]}:${a} / ${roles[j][0]}:${b}`)
const docs = ['AGENTS.md', 'START-HERE.zh-CN.md', 'agent-tasks/product-wave-07/README.zh-CN.md',
  'agent-tasks/product-wave-08/README.zh-CN.md', plan.sharedBoundary, ...roles.map(([, role]) => role.packet)]
let links = 0
for (const path of docs) {
  const text = read(path)
  assert.equal((text.match(/^\s*```/gm) ?? []).length % 2, 0, path)
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '')
    if (/^(https?:|obsidian:|mailto:|#)/.test(target)) continue
    target = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '')
    if (!target || target.includes(' ')) continue
    assert.ok(existsSync(resolve(root, dirname(path), target)), `${path} -> ${target}`)
    links++
  }
}
console.log(JSON.stringify({ status: 'PASS_DISPATCH_STATIC_ONLY', roles: roles.length,
  phases: roles.reduce((n, [, role]) => n + role.phases.length, 0), milestones: nodes.size, localLinks: links,
  acyclic: true, nonoverlappingOwners: true, productIndependentFromBlockedStudy: true,
  budgetUnchanged: true, runtimeTests: 0, nativeTurnStarts: 0 }, null, 2))
