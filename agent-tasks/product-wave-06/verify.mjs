import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only dispatch checks. This never starts a runtime, installs dependencies or spends a grant.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const plan = JSON.parse(read('agent-tasks/product-wave-06/dispatch.json'))
const protocol = JSON.parse(read('tools/experiments/review-pilot-01/protocol.json'))
assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
assert.equal(plan.newModelAllowance, 0)
assert.equal(plan.nativeModelsStartedByThisDispatch, 0)
const roles = Object.entries(plan.roles)
assert.equal(roles.length, 6)
for (const [name, role] of roles) {
  assert.ok(existsSync(resolve(root, role.packet)), role.packet)
  assert.equal(role.phases.length, 6, name)
  const text = read(role.packet)
  for (const phase of role.phases) assert.ok(text.includes(`## ${phase} `), `${name}: missing phase ${phase}`)
  if (role.candidate) assert.match(role.candidate, /^[a-f0-9]{40}$/)
}
const nodes = new Map(plan.milestones.map(node => [node.id, node]))
assert.equal(nodes.size, plan.milestones.length)
const visiting = new Set(), visited = new Set()
function visit(id) {
  assert.ok(nodes.has(id), `Missing dependency ${id}`)
  assert.ok(!visiting.has(id), `Dependency cycle at ${id}`)
  if (visited.has(id)) return
  visiting.add(id)
  for (const dep of nodes.get(id).dependsOn) visit(dep)
  visiting.delete(id); visited.add(id)
}
for (const [id, node] of nodes) { assert.ok(plan.roles[node.owner], `Unknown owner ${node.owner}`); visit(id) }
function ancestors(id, result = new Set()) {
  for (const dep of nodes.get(id).dependsOn) if (!result.has(dep)) { result.add(dep); ancestors(dep, result) }
  return result
}
for (const id of ['M2', 'M3', 'M4', 'M5', 'D2', 'D6', 'E3', 'E4', 'E5'])
  assert.ok(!ancestors(id).has('E2'), `Pilot must not gate independent product work: ${id}`)
for (const id of ['B2', 'B3', 'B4', 'E1', 'M1-pilot-admission']) assert.ok(ancestors('E2').has(id), `Missing pilot prerequisite ${id}`)
const grant = plan.roles.E
assert.equal(grant.grantId, protocol.grantId)
assert.equal(grant.maxNativeTurnStarts, protocol.budget.maxTotalTurnStarts)
assert.equal(grant.maxBillableTokens, protocol.budget.maxTotalBillableTokens)
assert.equal(grant.maxCostUSD, protocol.budget.maxTotalCostUSD)
assert.equal(grant.maxInFlight, 1); assert.equal(grant.resetLedger, false)
assert.equal(plan.roles.B.historicalLimit, 4)
for (const role of ['A', 'C', 'D', 'main']) assert.equal(plan.roles[role].budgetMode, 'zero_native_model_tasks')
for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++)
  for (const a of roles[i][1].ownedPaths) for (const b of roles[j][1].ownedPaths)
    assert.ok(!a.startsWith(b) && !b.startsWith(a), `Owner overlap: ${roles[i][0]}:${a} / ${roles[j][0]}:${b}`)
const docs = new Set(['AGENTS.md', 'START-HERE.zh-CN.md', 'agent-tasks/product-wave-05/README.zh-CN.md',
  'agent-tasks/product-wave-06/README.zh-CN.md', plan.sharedBoundary, ...roles.map(([, role]) => role.packet)])
let links = 0
for (const path of docs) {
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
console.log(JSON.stringify({ status: 'PASS_DISPATCH_STATIC_ONLY', roles: roles.length, phases: roles.reduce((n, [, r]) => n + r.phases.length, 0),
  milestones: nodes.size, localLinks: links, acyclic: true, nonoverlappingOwners: true, pilotIndependentFromProduct: true,
  budgetUnchanged: true, runtimeTests: 0 }, null, 2))
