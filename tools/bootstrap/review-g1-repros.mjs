import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, openSync, closeSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: { storage: { type: 'string' }, runtime: { type: 'string' }, record: { type: 'boolean' } } });
if (!values.storage || !values.runtime) throw new Error('Use --storage <built-review-checkout> --runtime <review-checkout>');
const a = resolve(values.storage), b = resolve(values.runtime);
const storage = await import(pathToFileURL(resolve(a, 'packages/storage/dist/index.js')).href);
const { bindCoreRepositories } = await import('../../apps/coordinator/main.ts');
const { AttemptSupervisor } = await import(pathToFileURL(resolve(b, 'packages/execution/src/supervisor.ts')).href);
const { ProcessHost } = await import(pathToFileURL(resolve(b, 'apps/runner/src/process-host.ts')).href);
const { makeAttemptSpec } = await import(pathToFileURL(resolve(b, 'packages/testing/src/fixtures.ts')).href);
const { AttemptSpecSchema, RunnerCommandSchema } = await import(pathToFileURL(resolve(b, 'packages/contracts/src/schemas.ts')).href);
const cases = [];

const directory = mkdtempSync(join(tmpdir(), 'g1-review-repros-'));
try {
  const fd = openSync(join(directory, 'coordinator.lock'), 'wx');
  const lock = new storage.WriterLock(directory);
  let acquired = false;
  try { lock.acquire(); acquired = true; } catch { /* refusal is the desired safe result */ }
  finally { lock.release(); closeSync(fd); }
  cases.push({ id: 'A-LOCK-INITIALIZATION', passesInvariant: !acquired, observed: acquired ? 'A second owner stole an empty in-flight lock file' : 'Refused unknown ownership' });
  const store = new storage.ProductStore({ path: join(directory, 'async.sqlite'), artifactsRoot: join(directory, 'artifacts') });
  try {
    store.db.exec('CREATE TABLE review_async (id INTEGER PRIMARY KEY)');
    let rejectedSynchronously = false;
    let pending;
    try { pending = store.uow.atomic(async () => { store.db.prepare('INSERT INTO review_async VALUES (1)').run(); await Promise.resolve(); throw new Error('after-await failure'); }); }
    catch { rejectedSynchronously = true; }
    if (pending) await pending.catch(() => undefined);
    const count = store.db.prepare('SELECT count(*) AS n FROM review_async').get().n;
    cases.push({ id: 'A-ASYNC-TRANSACTION', passesInvariant: rejectedSynchronously && count === 0, observed: { rejectedSynchronously, persistedRowsAfterFailure: count } });
    let bodyStarted = false, bridgeRefused = false;
    try { bindCoreRepositories(store).atomic(async () => { bodyStarted = true; }); } catch { bridgeRefused = true; }
    cases.push({ id: 'MAIN-SYNC-BRIDGE', passesInvariant: bridgeRefused && !bodyStarted, observed: { bridgeRefused, bodyStarted } });
  } finally { store.close(); }
} finally { rmSync(directory, { recursive: true, force: true }); }

const spec = AttemptSpecSchema.parse(makeAttemptSpec());
const bindings = new Map(), commands = [];
const attempt = { attemptId: spec.attemptId, feed: async command => { commands.push(command); }, waitExit: async () => ({ reason: 'terminal', evidenceRefs: [] }), stop: async () => ({ quiescence: 'confirmed', evidenceRefs: ['fixture'] }) };
const options = { bindings: { current: id => bindings.get(id), save: value => { bindings.set(value.ticketId, value); } }, runner: { launch: async () => attempt }, sink: { record: async fact => ({ factId: fact.factId, persisted: true, seq: 1 }) }, preparedPolicyRef: 'prepared-1' };
const supervisor = new AttemptSupervisor(options);
await supervisor.start({ ...spec, spec, initialInputRef: 'input-initial-1' });
cases.push({ id: 'B-FROZEN-COMMAND', passesInvariant: RunnerCommandSchema.safeParse(commands[0]).success, observed: { hasContract: !!commands[0].contract, inputRef: commands[0].inputRef, policySnapshotRef: spec.policySnapshotRef } });
const wrongAssignment = supervisor.fence({ ...spec, assignmentId: 'wrong-assignment' });
cases.push({ id: 'B-ASSIGNMENT-FENCE', passesInvariant: !wrongAssignment.accepted, observed: wrongAssignment });
await supervisor.deliver(spec.ticketId, 'input-1'); await supervisor.deliver(spec.ticketId, 'input-2');
const deliveryIds = commands.filter(command => command.kind === 'deliver').map(command => command.id);
cases.push({ id: 'B-COMMAND-IDENTITY', passesInvariant: new Set(deliveryIds).size === 2, observed: { deliveryIds } });
const recovered = new AttemptSupervisor(options);
const first = await recovered.stop(spec.ticketId, 'recover');
const second = await recovered.stop(spec.ticketId, 'recover');
cases.push({ id: 'B-UNKNOWN-STOP', passesInvariant: first.state === 'stopping' && second.state === 'stopping' && ['indeterminate', 'unknown'].includes(second.quiescence), observed: { first, second } });

const host = new ProcessHost();
let resource;
// Keep the reviewer alive even if an implementation under review unrefs its own stop deadline.
const reviewLifetime = setInterval(() => {}, 1000);
try {
  const grandchildProgram = 'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000);';
  const parentProgram = `import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildProgram)}],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>process.stdout.write(JSON.stringify({pid:child.pid})+'\\n'));setInterval(()=>{},1000);`;
  resource = await host.spawn({ executable: process.execPath, argv: ['--input-type=module', '-e', parentProgram], cwdRef: 'fixture', environmentRef: 'fixture' });
  const ready = (async () => { let text = ''; for await (const chunk of resource.stdout) { text += new TextDecoder().decode(chunk); if (text.includes('\n')) return JSON.parse(text.split('\n')[0]); } throw new Error('No descendant readiness'); })();
  let timer;
  const descendant = await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Descendant readiness timeout')), 2000); })]).finally(() => clearTimeout(timer));
  const stopped = await host.stopOwned(resource.resourceRef, 100);
  let state = 'missing';
  try { state = execFileSync('ps', ['-o', 'stat=', '-p', String(descendant.pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* exited */ }
  const active = state !== 'missing' && !state.startsWith('Z');
  cases.push({ id: 'B-PROCESS-GROUP', passesInvariant: !(stopped.quiescence === 'confirmed' && active), observed: { stop: stopped.quiescence, descendantState: state, descendantStillActive: active } });
} finally {
  if (resource) { try { process.kill(-resource.identity.groupId, 'SIGKILL'); } catch { /* own test group already gone */ } }
  await host.stopAll(100);
  clearInterval(reviewLifetime);
}
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS' : 'BLOCKED_REPRODUCED_INVARIANTS', storageCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: a, encoding: 'utf8' }).trim(), runtimeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: b, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cases };
if (values.record) { mkdirSync(resolve(root, 'reports/releases'), { recursive: true }); writeFileSync(resolve(root, 'reports/releases/g1-review-repros.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(report, null, 2));
assert.ok(cases.every(item => item.passesInvariant), 'Owner fixes required; these negative cases block the affected guarantees');
