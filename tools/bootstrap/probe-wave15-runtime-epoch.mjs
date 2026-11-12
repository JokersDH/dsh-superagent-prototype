import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

if (process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave15-runtime-epoch.mjs <B-root>')
const candidate = resolve(process.argv[2])
const load = file => import(pathToFileURL(`${candidate}/${file}`).href)
const { createRunnerCredential, connectRunnerRecovery, verifiedRunnerInspection } = await load('apps/coordinator/runner-link.ts')
const { producer } = await load('tests/integration/runtime-ingress-fixture.ts')
const root = mkdtempSync('/tmp/pa-wave15-b-epoch-')
const observations = []

try {
  for (const fixtureEpoch of [5, producer.attempt.fenceEpoch]) {
    const scene = `${root}/epoch-${fixtureEpoch}`
    mkdirSync(scene, { mode: 0o700 })
    createRunnerCredential(`${scene}/runner.key`)
    writeFileSync(`${scene}/epoch`, String(fixtureEpoch))
    const child = spawn(process.execPath, [`${candidate}/tests/native-acceptance/fixtures/b14-runner-service.mjs`, scene],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    const exited = once(child, 'exit')
    try {
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`ready deadline: ${stderr}`)), 10000)
        child.once('message', value => { clearTimeout(timer); resolve(value) })
        child.once('exit', () => { clearTimeout(timer); reject(new Error(`early exit: ${stderr}`)) })
      })
      const client = connectRunnerRecovery(ready.endpoint, producer, 2000)
      const before = verifiedRunnerInspection(await client.inspect()).value
      let outcome, code, after
      try {
        after = verifiedRunnerInspection(await client.cancel({ ...producer.attempt, id: `audit-cancel-${fixtureEpoch}`, kind: 'cancel' })).value
        outcome = 'accepted'
      } catch (error) { outcome = 'refused'; code = error.code }
      observations.push({ fixtureEpoch, authenticatedAttemptEpoch: before.attempt.fenceEpoch,
        sameCurrentAttempt: isDeepStrictEqual(before.attempt, producer.attempt),
        cancelOutcome: outcome, code, counters: JSON.parse(readFileSync(`${scene}/receivers.json`, 'utf8')),
        resultingState: after?.state, resultingWriter: after?.resources?.[0]?.writer,
        servicePid: child.pid, onlyResourceRef: before.resources[0]?.ref })
    } finally {
      if (child.exitCode === null) child.send('shutdown')
      const finished = await Promise.race([exited.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 2000))])
      if (!finished && child.exitCode === null) { child.kill('SIGKILL'); await exited }
    }
  }
} finally { rmSync(root, { recursive: true, force: true }) }

const report = { candidate, source: execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim(),
  observations, realModelTurns: 0, nativeTurnStarts: 0, ledgerOpened: false,
  scope:'Bounded epoch diagnosis using an inert private service; not production begin/answer/stop recovery or physical-writer evidence' }

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave15-admission/runtime-epoch.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report,null,2))
process.exitCode = observations[0]?.cancelOutcome === 'refused' && observations[1]?.cancelOutcome === 'accepted' ? 0 : 1
