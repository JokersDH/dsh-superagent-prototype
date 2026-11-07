import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { openRecoveryFixture, recoveryRecord } from '../../tests/integration/recovery-fixture.mjs';
import { turnPayload, exitPayload, binding } from '../../tests/integration/runtime-ingress-fixture.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: { runtime: { type: 'string' }, record: { type: 'boolean' } } });
if (!values.runtime) throw new Error('Provide the independently installed runtime review checkout');
const runtime = resolve(values.runtime);
const { FileCriticalJournal } = await import(pathToFileURL(resolve(runtime, 'apps/runner/src/file-journal.ts')).href);
const directory = mkdtempSync(join(tmpdir(), 'g1-journal-interop-'));
const h = openRecoveryFixture(directory);
const cases = [];
async function snapshot(path, records) {
  const writer = new FileCriticalJournal({ path });
  await writer.open(); for (const record of records) writer.append(record.fact, record.payload); writer.close();
  const reader = new FileCriticalJournal({ path });
  try {
    const recovered = await reader.open();
    assert.equal(recovered.corruptAt, null); assert.equal(recovered.partialTailBytes, 0);
    return recovered.entries.map(entry => ({ fact: entry.fact, payload: entry.payload }));
  } finally { reader.close(); }
}
try {
  const records = await snapshot(join(directory, 'valid.journal'), [recoveryRecord(turnPayload)]);
  assert.equal((await h.run(records)).accepted, 1);
  const receipt = h.store.facts.get(records[0].fact.factId);
  assert.equal((await h.run(records)).replayed, 1);
  assert.equal(h.store.facts.get(records[0].fact.factId).seq, receipt.seq);
  cases.push({ case: 'actual candidate journal format restores missing payload then reuses the committed receipt', status: 'PASS' });

  h.core.stopTicket(binding.ticketId); h.store.bindings.end(binding.attemptId);
  const late = await snapshot(join(directory, 'late.journal'), [recoveryRecord(turnPayload, 'late-business'), recoveryRecord(exitPayload, 'late-exit')]);
  const result = await h.run(late);
  assert.equal(result.refused.length, 1); assert.equal(result.accepted, 1);
  assert.equal(h.store.observations.summarize(binding.attemptId).resources[0].quiescence, 'unknown');
  cases.push({ case: 'historical physical evidence survives while late business is refused', status: 'PASS' });

  const conflicting = await snapshot(join(directory, 'conflict.journal'), [recoveryRecord(turnPayload, 'conflict'), recoveryRecord({ ...turnPayload, value: { ...turnPayload.value, nativeTurnRef: 'other' } }, 'conflict')]);
  await assert.rejects(h.run(conflicting), error => error.code === 'fact_conflict');
  assert.equal(h.store.facts.get('conflict'), undefined);
  cases.push({ case: 'main preflight refuses the candidate writer same-ID conflict before admission', status: 'PASS' });
} finally { h.close(); rmSync(directory, { recursive: true, force: true }); }
const report = { status: 'PASS_VALID_SNAPSHOT_INTEROP_ONLY', runtimeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cases, limitations: ['Does not approve FileCriticalJournal durability/corrupt append/ACK semantics', 'Uses candidate writer only in a disposable review environment', 'No native command, process reconnect or complete G1 admission'] };
if (values.record) { mkdirSync(resolve(root, 'reports/releases'), { recursive: true }); writeFileSync(resolve(root, 'reports/releases/g1-journal-interop.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(report, null, 2));
