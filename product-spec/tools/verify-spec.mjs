import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasks as sourceTasks } from './task-source.mjs';
import { cases as sourceCases } from './acceptance-source.mjs';
import { chapters } from './spec-structure.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert.ok(args.every(arg => arg === '--check'), 'Only --check is supported');
const checkOnly = args.includes('--check');
const read = path => readFileSync(resolve(root, path), 'utf8');
const tasks = JSON.parse(read('work-packages.json')).packages;
const cases = JSON.parse(read('acceptance-catalog.json')).cases;
assert.equal(tasks.length, 17);
assert.equal(cases.length, sourceCases.length);
assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length);
assert.equal(new Set(cases.map(t => t.id)).size, cases.length);
assert.deepEqual(tasks.map(t => t.id), sourceTasks.map(t => t.id));
for (const source of sourceTasks) {
  const generated = tasks.find(t => t.id === source.id);
  for (const [key, value] of Object.entries(source)) {
    if (!['ownedPaths', 'readOnlyPaths', 'forbiddenPaths'].includes(key)) assert.deepEqual(generated[key], value, `${source.id}: stale ${key}`);
  }
  assert.deepEqual(generated.ownedPaths, [...source.ownedPaths, `docs/rfcs/${source.id}/`]);
}
assert.deepEqual(cases, sourceCases);
const taskMap = new Map(tasks.map(t => [t.id, t]));
const caseMap = new Map(cases.map(t => [t.id, t]));
const coverage = new Map(cases.map(t => [t.id, []]));
assert.ok(taskMap.get('WP-06').acceptanceIds.every(id => !id.startsWith('NATIVE-')), 'Catalog module acceptance must not wait for native Drivers');
for (const [taskId, caseId] of [['WP-07', 'NATIVE-01'], ['WP-08', 'NATIVE-02'], ['WP-09', 'NATIVE-03']]) {
  assert.ok(taskMap.get(taskId).acceptanceIds.includes(caseId));
  assert.ok(taskMap.get('WP-16').acceptanceIds.includes(caseId));
}

for (const task of tasks) {
  for (const key of ['ownedPaths', 'readOnlyPaths', 'forbiddenPaths', 'steps', 'mocks', 'deliverables', 'acceptanceIds']) {
    assert.ok(Array.isArray(task[key]) && task[key].length, `${task.id}: missing ${key}`);
  }
  assert.equal(task.status, 'PLANNED');
  assert.equal(new Set(task.acceptanceIds).size, task.acceptanceIds.length, `${task.id}: duplicate acceptance IDs`);
  for (const edge of ['startAfter', 'acceptAfter']) {
    assert.equal(new Set(task[edge]).size, task[edge].length, `${task.id}: duplicate ${edge}`);
    for (const dep of task[edge]) assert.ok(taskMap.has(dep) && dep !== task.id, `${task.id}: bad ${edge} ${dep}`);
  }
  for (const id of task.acceptanceIds) {
    assert.ok(caseMap.has(id), `${task.id}: unknown case ${id}`);
    coverage.get(id).push(task.id);
  }
  const packet = read(`tasks/${task.id}.md`);
  assert.ok(packet.includes('## 可复制派工指令'));
  assert.ok(packet.includes(task.interface));
  for (const id of task.acceptanceIds) assert.ok(packet.includes(id), `${task.id}: packet missing ${id}`);
}
for (const key of ['startAfter', 'acceptAfter']) {
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    assert.ok(!visiting.has(id), `${key}: cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of taskMap.get(id)[key]) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach(task => visit(task.id));
}
// Check mixed dependency graph as well: a start edge must not hide an acceptance cycle.
{
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    assert.ok(!visiting.has(id), `combined dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const item = taskMap.get(id);
    for (const dep of new Set([...item.startAfter, ...item.acceptAfter])) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach(task => visit(task.id));
}
const overlap = (a, b) => a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
for (let i = 0; i < tasks.length; i++) {
  for (let j = i + 1; j < tasks.length; j++) {
    for (const a of tasks[i].ownedPaths) for (const b of tasks[j].ownedPaths) {
      assert.ok(!overlap(a, b), `ownership overlap ${tasks[i].id}:${a} / ${tasks[j].id}:${b}`);
    }
  }
}
for (const item of cases) {
  assert.equal(item.status, 'NOT_TESTED', `${item.id}: spec cannot report runtime pass`);
  for (const key of ['given', 'when', 'expected', 'evidence', 'layer']) assert.ok(typeof item[key] === 'string' && item[key].length > 0, `${item.id}: ${key}`);
  assert.ok(item.gates.length > 0 && item.gates.every(g => /^G[0-6]$/.test(g)));
  assert.ok(coverage.get(item.id).length, `${item.id}: no responsible package`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const entryDocs = ['../README.md', '../AGENTS.md', '../START-HERE.zh-CN.md', '../agent-tasks/main.md', '../agent-tasks/agent-a.md', '../agent-tasks/agent-b.md'].map(path => resolve(root, path));
for (const path of entryDocs) assert.ok(existsSync(path), `missing collaboration entry ${path}`);
const files = [...walk(root).filter(file => !file.includes('/research/sources/') && !file.endsWith('/verification-report.json')), ...entryDocs];
let links = 0;
for (const path of files.filter(file => file.endsWith('.md'))) {
  const text = readFileSync(path, 'utf8');
  assert.equal((text.match(/^\s*```/gm) || []).length % 2, 0, `unbalanced fence ${path}`);
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|obsidian:|mailto:|#)/.test(target)) continue;
    target = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '');
    if (!target || target.includes(' ')) continue;
    assert.ok(existsSync(resolve(dirname(path), target)), `broken link ${relative(root, path)} -> ${target}`);
    links++;
  }
}
for (const name of ['README.md', ...chapters]) assert.ok(existsSync(resolve(root, name)));
for (const [prefix, count, doc] of [['AC-UX-', 12, chapters[0]], ['AC-LRN-', 12, chapters[5]], ['RT-', 10, chapters[3]]]) {
  const text = read(doc);
  for (let n = 1; n <= count; n++) assert.ok(text.includes(`${prefix}${String(n).padStart(2, '0')}`), `${doc}: missing ${prefix}${n}`);
}

const report = {
  result: 'PASS_SPEC_STATIC_ONLY',
  checkedAt: new Date().toISOString(),
  taskCount: tasks.length,
  acceptanceRequirementCount: cases.length,
  runtimeTestsExecutedByThisVerifier: 0,
  localLinksChecked: links,
  checks: ['unique IDs', 'start/accept/combined dependency DAGs', 'non-overlapping owned paths', 'case coverage', 'generated catalog consistency', 'task prompts', 'markdown fences', 'local links', 'UX/learning/runtime requirement mapping'],
  limitations: 'Does not prove implementation, native compatibility, durability, performance, security or learning benefit. TypeScript compilation is a separate command.',
  artifacts: files.filter(path => statSync(path).isFile()).map(path => ({
    path: relative(root, path),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex')
  }))
};
if (!checkOnly) writeFileSync(resolve(root, 'verification-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: ${tasks.length} task packages, ${cases.length} NOT_TESTED requirements, both/combined DAGs, ownership, coverage, prompts, fences, ${links} local links. Runtime tests: 0.`);
