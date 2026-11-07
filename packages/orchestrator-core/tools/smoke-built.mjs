import assert from 'node:assert/strict';
import { createPersonalEngine, MemoryRepositories } from '@personal-agent/orchestrator-core';

const repo = new MemoryRepositories();
const unexpected = () => { throw new Error('The compiled-package smoke must not execute work'); };
const engine = createPersonalEngine({
  repo,
  policy: () => ({ version: 'smoke', paused: false, evalTimeoutMs: 1000, gate: () => ({ admissible: false, reason: 'smoke-no-authority' }), revalidate: () => false, admitsInferred: () => false }),
  scope: { scope: () => ({ listened: true, observed: false }) },
  assessor: { request: unexpected }, executor: { start: unexpected, deliver: unexpected, stop: unexpected },
  outbox: { send: unexpected, withdraw: unexpected, status: () => undefined },
  completionPolicy: unexpected, isCurrentContract: () => false,
});
engine.receive({ id: 'smoke-1', source: 'local', threads: [{ source: 'local', id: 'smoke' }], actor: { source: 'local', id: 'peer' }, human: false, text: 'No authorized work.', at: '2026-11-07T00:00:00Z', meta: {} });
engine.evaluateDue();
assert.equal(repo.tickets.list().length, 0);
assert.equal(repo.decisions.byThread('local:smoke')[0]?.kind, 'ignore');
assert.equal(Object.isFrozen(engine.personalExecutor()), true);
console.log('PASS: built ESM public package loads and rejects unauthorized intake without any external work.');
