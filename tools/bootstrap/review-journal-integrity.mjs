import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { values } = parseArgs({ options: { runtime: { type: 'string' }, record: { type: 'boolean' } } })
if (!values.runtime) throw new Error('Provide --runtime <clean runtime checkout>')
const runtime = resolve(values.runtime), load = path => import(pathToFileURL(join(runtime, path)).href)
const { FileCriticalJournal, encodeRecord, decodeBuffer } = await load('apps/runner/src/file-journal.ts')
const { replayJournal } = await load('apps/runner/src/runner.ts')
const { makeFact } = await load('packages/testing/src/fixtures.ts')
const directory = mkdtempSync(join(tmpdir(), 'journal-integrity-')), cases = []
const payload = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: false, evidenceRefs: ['fixture-evidence'] } }
const fact = makeFact('turn.ended', 'payload-1', { factId: 'fact-1' })
const entry = { fact, payload, seq: 1, at: new Date().toISOString() }
try {
  const wrongTerminator = encodeRecord(entry); wrongTerminator[wrongTerminator.length - 1] = 0x78
  const terminator = decodeBuffer(wrongTerminator)
  cases.push({ id: 'JOURNAL-RECORD-TERMINATOR', passesInvariant: terminator.readOnly && terminator.corruptAt !== null, observed: { entries: terminator.entries.length, corruptAt: terminator.corruptAt, readOnly: terminator.readOnly } })
  let invalid, invalidThrew = false
  try { invalid = decodeBuffer(encodeRecord({ ...entry, fact: {} })) } catch { invalidThrew = true }
  cases.push({ id: 'JOURNAL-STRICT-RECORD-ENVELOPE', passesInvariant: !invalidThrew && invalid?.readOnly === true && invalid?.corruptAt !== null, observed: { invalidThrew, entries: invalid?.entries.length, corruptAt: invalid?.corruptAt, readOnly: invalid?.readOnly } })
  const path = join(directory, 'corrupt-prefix.journal')
  const second = encodeRecord({ ...entry, fact: { ...fact, factId: 'fact-2' }, seq: 2 })
  second[second.length - 3] ^= 0xff
  writeFileSync(path, Buffer.concat([encodeRecord(entry), second]))
  const journal = new FileCriticalJournal({ path }), recovery = await journal.open(), applied = []
  let replayFailed = false, replay
  try { replay = await replayJournal(journal, { record: async input => { applied.push(input.factId); return { factId: input.factId, persisted: true, seq: applied.length } } }); replayFailed = replay.failures.length > 0 }
  catch { replayFailed = true }
  finally { journal.close() }
  cases.push({ id: 'JOURNAL-CORRUPT-PREFIX-REPLAY', passesInvariant: recovery.readOnly && replayFailed && applied.length === 0, observed: { corruptAt: recovery.corruptAt, readOnly: recovery.readOnly, applied, replayFailed, replay } })
} finally { rmSync(directory, { recursive: true, force: true }) }
const report = { status: cases.every(item => item.passesInvariant) ? 'PASS_JOURNAL_INTEGRITY_BOUNDARY' : 'BLOCKED_JOURNAL_INTEGRITY_BOUNDARY', runtimeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtime, encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cases }
if (values.record) writeFileSync(join(root, 'reports/releases/g1-journal-integrity.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
assert.ok(cases.every(item => item.passesInvariant), 'Strict framing/envelopes and whole-file integrity must gate every replay')
