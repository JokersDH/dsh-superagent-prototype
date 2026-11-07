import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { values } = parseArgs({ options: { runtime: { type: 'string' }, record: { type: 'boolean' } } })
if (!values.runtime) throw new Error('Provide --runtime <clean runtime checkout>')
const runtime = resolve(values.runtime), fs = createRequire(import.meta.url)('node:fs'), originalWrite = fs.writeSync
const { FileCriticalJournal, encodeRecord, decodeBuffer } = await import(pathToFileURL(join(runtime, 'apps/runner/src/file-journal.ts')).href)
const { replayJournal } = await import(pathToFileURL(join(runtime, 'apps/runner/src/runner.ts')).href)
const { makeFact } = await import(pathToFileURL(join(runtime, 'packages/testing/src/fixtures.ts')).href)
const directory = mkdtempSync(join(tmpdir(), 'journal-followup-')), cases = []
const payload = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: false, evidenceRefs: ['fixture-evidence'] } }
const fact = makeFact('turn.ended', 'payload-1', { factId: 'fact-1' })
try {
  const path = join(directory, 'partial-write.journal'), journal = new FileCriticalJournal({ path })
  await journal.open()
  let writes = 0, failed = false, subsequentRefused = false
  fs.writeSync = (fd, buffer, offset, length, position) => {
    if (++writes === 1) return originalWrite(fd, buffer, offset, Math.min(length, 20), position)
    throw Object.assign(new Error('injected write failure'), { code: 'EIO' })
  }
  syncBuiltinESMExports()
  try { journal.append(fact, payload) } catch { failed = true }
  fs.writeSync = originalWrite; syncBuiltinESMExports()
  try { journal.append({ ...fact, factId: 'fact-after-io-failure' }, payload) } catch { subsequentRefused = true }
  journal.close()
  const reopened = new FileCriticalJournal({ path }), recovery = await reopened.open(); reopened.close()
  cases.push({ id: 'JOURNAL-IO-FAILURE-POISONS-WRITER', passesInvariant: failed && subsequentRefused, observed: { failed, subsequentRefused, recoveredIds: recovery.entries.map(entry => entry.fact.factId), corruptAt: recovery.corruptAt } })

  const replaySource = new FileCriticalJournal({ path: join(directory, 'replay.journal') })
  await replaySource.open(); replaySource.append(fact, payload)
  const replay = await replayJournal(replaySource, { record: async input => ({ factId: input.factId, persisted: false, seq: 1 }) })
  replaySource.close()
  cases.push({ id: 'JOURNAL-REPLAY-VALIDATES-ACK', passesInvariant: replay.replayed === 0 && replay.failures.length > 0, observed: replay })

  const entries = [1, 3].map((seq, i) => ({ fact: { ...fact, factId: `gap-${i}` }, payload, seq, at: new Date().toISOString() }))
  const gap = decodeBuffer(Buffer.concat(entries.map(encodeRecord)))
  cases.push({ id: 'JOURNAL-SEQUENCE-GAP', passesInvariant: gap.corruptAt !== null && gap.readOnly, observed: { corruptAt: gap.corruptAt, readOnly: gap.readOnly, sequences: gap.entries.map(entry => entry.seq) } })
} finally {
  fs.writeSync = originalWrite; syncBuiltinESMExports()
  rmSync(directory, { recursive: true, force: true })
}
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS_JOURNAL_FOLLOWUP_CASES' : 'BLOCKED_JOURNAL_FOLLOWUP', runtimeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cases }
if (values.record) { mkdirSync(join(root, 'reports/releases'), { recursive: true }); writeFileSync(join(root, 'reports/releases/g1-journal-followup.json'), JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify(report, null, 2))
assert.ok(cases.every(item => item.passesInvariant), 'Journal I/O failure, replay receipt and sequence admission must pass')
