import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 3) throw new Error('Usage: PA_ADMISSION_REPORT=<new absolute output> node tools/bootstrap/probe-wave16-runtime.mjs <B-root>')
const requestedOutput = process.env.PA_ADMISSION_REPORT
if (!requestedOutput || !isAbsolute(requestedOutput)) throw new Error('PA_ADMISSION_REPORT must name an explicit new absolute output path')
if (existsSync(requestedOutput)) throw new Error('Refusing to overwrite an existing admission report')
const candidate = realpathSync(process.argv[2])
const outputRelativeToCandidate = relative(candidate, requestedOutput)
if (!outputRelativeToCandidate.startsWith('..') && !isAbsolute(outputRelativeToCandidate)) throw new Error('The output must be outside the candidate worktree')
const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const sourceCommit = git(['rev-parse', 'HEAD'])
const files = [
  'tests/native-acceptance/b14-independent-runner.mjs',
  'tests/native-acceptance/fixtures/b14-coordinator.mjs',
  'tests/native-acceptance/fixtures/b14-runner-service.mjs',
  'tests/native-acceptance/harness.mjs',
  'packages/execution/src/recovery-transport.ts',
  'packages/contracts/src/schemas.ts',
]
const hash = file => createHash('sha256').update(readFileSync(join(candidate, file))).digest('hex')
const hashes = Object.fromEntries(files.map(file => [file, hash(file)]))
const url = file => pathToFileURL(join(candidate, file)).href
const reportMarker = 'WAVE16_CANDIDATE_REPORT '
const observationMarker = 'WAVE16_PRIVATE_DB_OBSERVATION '
let source = readFileSync(join(candidate, files[0]), 'utf8')

// Keep all candidate assertions and its exit behavior. Only expose its report, make relative imports
// executable from memory, and read its own temporary database before the original cleanup.
const replacements = [
  ["import { CaseLog, writeReport } from './harness.mjs'", `import { CaseLog, writeReport as candidateWriteReport } from ${JSON.stringify(url('tests/native-acceptance/harness.mjs'))}
function writeReport(input) {
  const report = candidateWriteReport(input)
  console.log(${JSON.stringify(reportMarker)} + JSON.stringify(report))
  return report
}`],
  ["from '../../apps/coordinator/runner-link.ts'", `from ${JSON.stringify(url('apps/coordinator/runner-link.ts'))}`],
  ["const repo = new URL('../../', import.meta.url).pathname", `const repo = ${JSON.stringify(candidate + '/')}`],
  ["fileURLToPath(new URL('./fixtures/b14-runner-service.mjs', import.meta.url))", JSON.stringify(join(candidate, 'tests/native-acceptance/fixtures/b14-runner-service.mjs'))],
  ["fileURLToPath(new URL('./fixtures/b14-coordinator.mjs', import.meta.url))", JSON.stringify(join(candidate, 'tests/native-acceptance/fixtures/b14-coordinator.mjs'))],
  ["await import('../integration/runtime-ingress-fixture.ts')", `await import(${JSON.stringify(url('tests/integration/runtime-ingress-fixture.ts'))})`],
  ['  rmSync(root, { recursive: true, force: true })', `
  let observationDb
  try {
    const { createRequire } = await import('node:module')
    const SQLite = createRequire(${JSON.stringify(url('packages/storage/package.json'))})('better-sqlite3')
    observationDb = new SQLite(join(stateRoot, 'state.sqlite'), { readonly: true, fileMustExist: true })
    const names = ['command_receipts', 'works', 'ticket', 'effect', 'fact_receipts', 'dispatch_receipts', 'user_questions', 'answers', 'answer_deliveries', 'runtime_bindings', 'runtime_current']
    const tables = Object.fromEntries(names.map(name => [name, Number(observationDb.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n)]))
    const { RunnerCommandSchema } = await import(${JSON.stringify(url('packages/contracts/src/index.ts'))})
    const { producer } = await import(${JSON.stringify(url('tests/integration/runtime-ingress-fixture.ts'))})
    console.log(${JSON.stringify(observationMarker)} + JSON.stringify({ tables,
      counters: JSON.parse(readFileSync(join(sceneDir, 'receivers.json'), 'utf8')),
      currentEpoch: producer.attempt.fenceEpoch,
      olderCommandSchemaValid: RunnerCommandSchema.safeParse({ ...producer.attempt, id: 'wave16-observe-older', kind: 'cancel', fenceEpoch: producer.attempt.fenceEpoch - 1 }).success }))
  } catch (error) {
    console.log(${JSON.stringify(observationMarker)} + JSON.stringify({ error: String(error?.message ?? error) }))
  } finally {
    observationDb?.close()
    rmSync(root, { recursive: true, force: true })
  }`],
]
for (const [anchor, replacement] of replacements) {
  if (source.split(anchor).length !== 2) throw new Error(`Candidate harness anchor changed; inspect before running: ${anchor}`)
  source = source.replace(anchor, replacement)
}

// The child owns a fresh process group, so a total deadline can clean up only this probe's children.
const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
  cwd: candidate, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  detached: true, killSignal: 'SIGKILL',
})
if (child.error?.code === 'ETIMEDOUT' && child.pid) {
  try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
}
const parseMarked = marker => {
  const lines = (child.stdout ?? '').split('\n').filter(line => line.startsWith(marker))
  return lines.length === 1 ? JSON.parse(lines[0].slice(marker.length)) : null
}
const candidateReport = parseMarked(reportMarker)
const observation = parseMarked(observationMarker)
const cases = []
const check = (id, condition, detail) => cases.push({ id, status: condition ? 'PASS' : 'FAIL', observation: detail })
const originalCase = id => candidateReport?.cases?.find(value => value.id === id)
const stop = originalCase('B14-STOP-ACK-UNKNOWN-NOT-RESENT')
const stopEvidence = stop?.evidence?.[0]
const reconnect = originalCase('B14-RECOVERY-REACHES-SAME-LIVING-RUNNER')
const counters = observation?.counters ?? {}
const tables = observation?.tables ?? {}
const sourcesStable = sourceCommit === git(['rev-parse', 'HEAD']) && files.every(file => hashes[file] === hash(file))

check('SOURCE_REMAINS_FIXED', sourcesStable, { sourceCommit, sourceHashes: hashes })
check('ORIGINAL_CANDIDATE_ASSERTIONS_COMPLETE', child.status === 0 && candidateReport?.totals?.FAIL === 0,
  { exitCode: child.status, signal: child.signal, error: child.error?.code ?? null, totals: candidateReport?.totals ?? null })
check('CURRENT_CANCEL_AND_AUTHENTICATED_RECONNECT_SUBSTRATE', reconnect?.status === 'PASS' && stop?.status === 'PASS' &&
  stopEvidence?.exitCode === 0 && stopEvidence?.stopAcked === 'terminated' && stopEvidence?.receipts?.stop === null && counters.cancel === 1,
  { reconnect: reconnect?.evidence ?? null, stop: stopEvidence ?? null, finalReceiverCounters: counters,
    scope: 'Inert authenticated service and receipt evidence only; physical writer quiescence is not established here.' })
check('ACTUAL_BUSINESS_RECEIVER_BEGIN_AND_ANSWER', counters.begin >= 1 && counters.answer >= 1, { counters })
const requiredTables = ['works', 'ticket', 'fact_receipts', 'dispatch_receipts', 'user_questions', 'answers', 'answer_deliveries', 'runtime_bindings', 'runtime_current']
const missingTables = requiredTables.filter(name => !(tables[name] >= 1))
check('ACTUAL_BUSINESS_RECORDS_ARE_POPULATED', missingTables.length === 0, { tables, missingTables })
const epochCase = originalCase('B14-EPOCH-FENCE-REFUSES-OLDER')
const epochEvidence = epochCase?.evidence?.find(value => value.currentEpoch !== undefined)
check('OLDER_EPOCH_COMMAND_IS_VALID_BEFORE_IDENTITY_REJECTION', observation?.olderCommandSchemaValid === true &&
  epochCase?.status === 'PASS' && epochEvidence?.currentEpoch >= 2 && epochEvidence?.sentEpoch >= 1,
  { currentEpoch: epochEvidence?.currentEpoch ?? observation?.currentEpoch ?? null, sentEpoch: epochEvidence?.sentEpoch ?? null,
    commandSchemaValid: observation?.olderCommandSchemaValid ?? null,
    requiredControl: 'currentEpoch >= 2 and oldEpoch >= 1; matching current command accepted under identical preconditions',
    scope: 'A failed focal stale-epoch test is an evidence gap, not a demonstrated permission bypass.' })

const failed = cases.filter(value => value.status === 'FAIL').length
const report = {
  protocol: 'wave16-runtime-production-repro/1', candidate, source: sourceCommit,
  status: failed ? 'FAIL_SCOPED_BUSINESS_RECOVERY_ADMISSION' : 'PASS_SCOPED_RECEIVER_AND_RECORD_CHECKS',
  cases, passed: cases.length - failed, failed, candidateTotals: candidateReport?.totals ?? null,
  privateObservation: observation, sourcesStable, candidateAssertionsChanged: false,
  candidateReportsWritten: false, observationDatabaseReadonly: true,
  originalCandidateReport: candidateReport,
  child: { exitCode: child.status, signal: child.signal, error: child.error?.code ?? null, stderr: child.stderr ?? '' },
  realModelTurns: 0, nativeTurnStarts: 0, budgetLedgerOpened: false,
  physicalWriterBarrierAdmitted: false,
  scope: 'Bounded B14 fixture replay. It preserves the existing B13 normal product admission. Receiver/table checks alone are not full production recovery or physical-writer admission.',
}
mkdirSync(dirname(requestedOutput), { recursive: true })
writeFileSync(requestedOutput, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ ...report, originalCandidateReport: undefined }, null, 2))
process.exitCode = failed ? 1 : 0
