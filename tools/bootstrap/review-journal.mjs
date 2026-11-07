import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: { runtime: { type: 'string' }, record: { type: 'boolean' } } });
if (!values.runtime) throw new Error('Provide --runtime <clean runtime checkout>');
const runtime = resolve(values.runtime);
const fs = createRequire(import.meta.url)('node:fs');
const originalFsync = fs.fsyncSync;
let synchronizations = 0;
fs.fsyncSync = (...args) => { synchronizations++; return originalFsync(...args); };
syncBuiltinESMExports();
const { FileCriticalJournal } = await import(pathToFileURL(resolve(runtime, 'apps/runner/src/file-journal.ts')).href);
const { AttemptRunner, replayJournal } = await import(pathToFileURL(resolve(runtime, 'apps/runner/src/runner.ts')).href);
const { makeAttemptSpec, makeFact } = await import(pathToFileURL(resolve(runtime, 'packages/testing/src/fixtures.ts')).href);
const directory = mkdtempSync(join(tmpdir(), 'g1-journal-admission-'));
const payload = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: false, evidenceRefs: ['fixture-evidence'] } };
const fact = makeFact('turn.ended', 'payload-1', { factId: 'fact-1' });
const cases = [];
try {
  const normal = new FileCriticalJournal({ path: join(directory, 'normal.journal') });
  await normal.open(); const before = synchronizations; normal.append(fact, payload);
  cases.push({ id: 'JOURNAL-DURABLE-APPEND', passesInvariant: synchronizations > before, observed: { fsyncCallsBeforeAppendReturned: synchronizations - before } });
  normal.close();

  const corruptPath = join(directory, 'corrupt.journal');
  const first = new FileCriticalJournal({ path: corruptPath });
  await first.open(); first.append(fact, payload); first.close();
  const bytes = readFileSync(corruptPath); bytes[bytes.length - 3] ^= 0xff; writeFileSync(corruptPath, bytes);
  const corrupted = new FileCriticalJournal({ path: corruptPath });
  const recovery = await corrupted.open();
  let appendRefused = false;
  try { corrupted.append({ ...fact, factId: 'fact-2' }, payload); } catch { appendRefused = true; }
  corrupted.close();
  const after = new FileCriticalJournal({ path: corruptPath }); const reopened = await after.open(); after.close();
  cases.push({ id: 'JOURNAL-CORRUPT-APPEND', passesInvariant: appendRefused, observed: { corruptAt: recovery.corruptAt, appendRefused, recoveredFactIdsAfterAppend: reopened.entries.map(entry => entry.fact.factId) } });

  const duplicate = new FileCriticalJournal({ path: join(directory, 'conflict.journal') });
  await duplicate.open(); duplicate.append(fact, payload);
  let conflictRefused = false;
  try { duplicate.append(fact, { ...payload, value: { ...payload.value, nativeTurnRef: 'different-turn' } }); } catch { conflictRefused = true; }
  const applied = [];
  const replay = await replayJournal(duplicate, { record: async input => { applied.push(input.factId); return { factId: input.factId, persisted: true, seq: applied.length }; } });
  duplicate.close();
  cases.push({ id: 'JOURNAL-SAME-ID-CONFLICT', passesInvariant: conflictRefused || replay.failures.length > 0, observed: { conflictRefused, replay } });

  const runner = new AttemptRunner({ payloads: { read: async () => payload, store: async () => 'payload-1' }, factSink: { record: async input => ({ factId: input.factId, persisted: false, seq: 1 }) } });
  let returnedReceipt, receiptRefused = false;
  try { await runner.launch(makeAttemptSpec(), { inspect: async () => { throw new Error('unused'); }, reconcile: async () => { throw new Error('unused'); }, serve: async (_spec, io) => { returnedReceipt = await io.record(fact); return { reason: 'terminal', evidenceRefs: [] }; } }); }
  catch { receiptRefused = true; }
  cases.push({ id: 'JOURNAL-AUTHORITATIVE-ACK', passesInvariant: receiptRefused, observed: { receiptRefused, returnedReceipt } });
} finally {
  fs.fsyncSync = originalFsync; syncBuiltinESMExports();
  rmSync(directory, { recursive: true, force: true });
}
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS_JOURNAL_ADMISSION_CASES' : 'BLOCKED_JOURNAL_ADMISSION', runtimeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cases };
if (values.record) { mkdirSync(resolve(root, 'reports/releases'), { recursive: true }); writeFileSync(resolve(root, 'reports/releases/g1-journal-review.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(report, null, 2));
assert.ok(cases.every(item => item.passesInvariant), 'Journal persistence/integrity/receipt cases must pass before durable admission');
