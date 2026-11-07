import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: { storage: { type: 'string' }, runtime: { type: 'string' }, record: { type: 'boolean' } } });
if (!values.storage || !values.runtime) throw new Error('Provide --storage and --runtime review roots');
const a = resolve(values.storage), b = resolve(values.runtime);
const { ProductStore } = await import(pathToFileURL(resolve(a, 'packages/storage/dist/index.js')).href);
const { AttemptSupervisor } = await import(pathToFileURL(resolve(b, 'packages/execution/src/supervisor.ts')).href);
const { makeAttemptSpec } = await import(pathToFileURL(resolve(b, 'packages/testing/src/fixtures.ts')).href);
const cases = [];
const directory = mkdtempSync(join(tmpdir(), 'g1-followup-'));
try {
  const store = new ProductStore({ path: join(directory, 'fixture.sqlite') });
  try {
    store.db.exec('CREATE TABLE review_after_await (id INTEGER PRIMARY KEY)');
    let began = false, rejected = false;
    try { store.uow.atomic(async () => { began = true; await Promise.resolve(); store.db.prepare('INSERT INTO review_after_await VALUES (1)').run(); }); } catch { rejected = true; }
    await Promise.resolve(); await Promise.resolve();
    const rows = store.db.prepare('SELECT count(*) AS n FROM review_after_await').get().n;
    cases.push({ id: 'A-ASYNC-AFTER-AWAIT', passesInvariant: rejected && !began && rows === 0, observed: { rejectedSynchronously: rejected, callbackBegan: began, rowsWrittenAfterRollback: rows } });
  } finally { store.close(); }
} finally { rmSync(directory, { recursive: true, force: true }); }

const spec = makeAttemptSpec();
function fixture(launch) {
  const rows = new Map(), commands = [];
  const attempt = { attemptId: spec.attemptId, feed: async c => { commands.push(c); }, waitExit: async () => ({ reason: 'terminal', evidenceRefs: [] }), stop: async () => ({ quiescence: 'confirmed', evidenceRefs: ['fixture-only'] }) };
  const supervisor = new AttemptSupervisor({ runner: { launch: launch || (async () => attempt) }, bindings: { current: id => rows.get(id), save: value => rows.set(value.ticketId, value) }, sink: { record: async fact => ({ factId: fact.factId, persisted: true, seq: 1 }) }, preparedPolicyRef: 'prepared-1' });
  return { supervisor, attempt, commands, rows };
}
const input = { ...spec, spec, initialInputRef: 'input-initial-1' };
{
  const h = fixture(); await h.supervisor.start(input);
  await h.supervisor.answer(spec.ticketId, 'a:b', 'c'); await h.supervisor.answer(spec.ticketId, 'a', 'b:c');
  const answers = h.commands.filter(command => command.kind === 'answer');
  cases.push({ id: 'B-COMMAND-DELIMITER', passesInvariant: answers[0].id !== answers[1].id, observed: { ids: answers.map(command => command.id) } });
  await h.supervisor.deliver(spec.ticketId, 'same-input', 'turn-1'); await h.supervisor.deliver(spec.ticketId, 'same-input', 'turn-2');
  const deliveries = h.commands.filter(command => command.kind === 'deliver');
  cases.push({ id: 'B-COMMAND-EXPECTED-TURN', passesInvariant: deliveries[0].id !== deliveries[1].id, observed: { ids: deliveries.map(command => command.id), turns: deliveries.map(command => command.expectedTurnRef) } });
  await h.supervisor.stop(spec.ticketId, 'done');
  let refused = false;
  try { await h.supervisor.start(input); } catch { refused = true; }
  cases.push({ id: 'B-ENDED-EPOCH-REUSE', passesInvariant: refused, observed: { refusedSameAttemptEpochAfterEnd: refused } });
}
{
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = fixture(async () => { await waiting; return h.attempt; });
  const starting = h.supervisor.start(input);
  await Promise.resolve();
  const stop = await h.supervisor.stop(spec.ticketId, 'cancel-during-launch');
  release();
  let startRejected = false;
  try { await starting; } catch { startRejected = true; }
  const began = h.commands.some(command => command.kind === 'begin');
  cases.push({ id: 'B-CANCEL-DURING-LAUNCH', passesInvariant: !began, observed: { startRejected, stop, beginSentAfterStop: began } });
}
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS_FOLLOWUP_INVARIANTS' : 'BLOCKED_FOLLOWUP_INVARIANTS', storageSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: a, encoding: 'utf8' }).trim(), runtimeSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: b, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cases };
if (values.record) { mkdirSync(resolve(root, 'reports/releases'), { recursive: true }); writeFileSync(resolve(root, 'reports/releases/g1-review-followup.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(report, null, 2));
assert.ok(cases.every(item => item.passesInvariant), 'The new edge cases must be fixed before the affected runtime/transaction guarantees are accepted');
