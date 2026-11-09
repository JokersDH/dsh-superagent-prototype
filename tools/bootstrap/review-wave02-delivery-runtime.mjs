import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { request } from 'node:http'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { connectRunnerRecovery, verifiedRunnerInspection } from '../../apps/coordinator/runner-link.ts'
import { confirmOwnedQuiescence } from '../../apps/coordinator/resource-barrier.ts'

const { values } = parseArgs({
  options: {
    workspaces: { type: 'string' },
    runner: { type: 'string' },
    only: { type: 'string' },
    record: { type: 'boolean' },
  },
})
if (values.only && !['workspaces', 'runner'].includes(values.only))
  throw new Error('--only must be workspaces or runner')
const checkWorkspace = values.only !== 'runner',
  checkRunner = values.only !== 'workspaces'
if ((checkWorkspace && !values.workspaces) || (checkRunner && !values.runner))
  throw new Error('Provide the committed checkout for each selected owner')
const load = (root, file) => import(pathToFileURL(join(resolve(root), file)).href)
const root = mkdtempSync('/tmp/pa-admit-')
const cases = []
const git = (cwd, args) =>
  execFileSync('git', ['-c', 'user.name=Admission Fixture', '-c', 'user.email=fixture@localhost', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const attempt = { ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract }
async function until(read, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Admission fixture timed out')
}
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function workspaceCases() {
  const { WorkspaceManager } = await load(values.workspaces, 'packages/workspaces/src/index.ts')
  const project = join(root, 'project')
  mkdirSync(project)
  git(project, ['init', '-q'])
  writeFileSync(join(project, 'seed.txt'), 'base\n')
  git(project, ['add', 'seed.txt'])
  git(project, ['commit', '-qm', 'base'])
  const manager = new WorkspaceManager(join(root, 'workspaces'))
  const mixed = manager.reserve({ projectPath: project, assignment: attempt })
  writeFileSync(join(mixed.path, 'staged.txt'), 'staged new bytes\n')
  git(mixed.path, ['add', 'staged.txt'])
  writeFileSync(join(mixed.path, 'untracked.txt'), 'untracked new bytes\n')
  const indexPath = git(mixed.path, ['rev-parse', '--git-path', 'index']).toString().trim()
  const indexBefore = digest(readFileSync(resolve(mixed.path, indexPath)))
  const frozen = manager.freeze({ attemptId: attempt.attemptId })
  const replay = manager.reserve({ projectPath: project, assignment: { ...attempt, attemptId: 'attempt-replay' } })
  git(replay.path, ['apply', '--binary', frozen.patchPath])
  const stagedRestored =
    existsSync(join(replay.path, 'staged.txt')) &&
    readFileSync(join(replay.path, 'staged.txt'), 'utf8') === 'staged new bytes\n'
  const untrackedRestored =
    existsSync(join(replay.path, 'untracked.txt')) &&
    readFileSync(join(replay.path, 'untracked.txt'), 'utf8') === 'untracked new bytes\n'
  const indexUnchanged = digest(readFileSync(resolve(mixed.path, indexPath))) === indexBefore
  cases.push({
    owner: 'A',
    id: 'PATCH-MIXED-STAGED-AND-UNTRACKED',
    passesInvariant: stagedRestored && untrackedRestored && indexUnchanged,
    observed: { stagedRestored, untrackedRestored, indexUnchanged },
  })

  const committed = manager.reserve({
    projectPath: project,
    assignment: { ...attempt, attemptId: 'attempt-committed' },
  })
  writeFileSync(join(committed.path, 'committed.txt'), 'committed deliverable\n')
  git(committed.path, ['add', 'committed.txt'])
  git(committed.path, ['commit', '-qm', 'agent commit'])
  const committedArtifact = manager.freeze({ attemptId: 'attempt-committed' })
  const patch = readFileSync(committedArtifact.patchPath)
  cases.push({
    owner: 'A',
    id: 'PATCH-INCLUDES-COMMITS-SINCE-RESERVE-BASE',
    passesInvariant: patch.toString().includes('committed deliverable'),
    observed: {
      baseDiffersFromHead: committedArtifact.baseCommit !== committedArtifact.headCommit,
      patchBytes: patch.byteLength,
    },
  })
  for (const id of ['attempt-1', 'attempt-replay', 'attempt-committed']) manager.release({ attemptId: id })
}

async function runnerCases() {
  const { serveRunner } = await load(values.runner, 'apps/runner/src/runner-service.ts')
  const { endpointDirectory } = await load(values.runner, 'apps/runner/src/recovery-endpoint.ts')
  const { ProcessHost } = await load(values.runner, 'apps/runner/src/process-host.ts')
  const { makeAttemptSpec } = await load(values.runner, 'packages/testing/src/fixtures.ts')
  const spec = makeAttemptSpec()
  const producer = { attempt, source: 'attempt-runner', runnerIdentityRef: `runner-${spec.attemptId}` }
  const input = new PassThrough(),
    frames = [],
    seen = []
  const recoveryRoot = join(root, 'recovery')
  const endpointRoot = endpointDirectory(recoveryRoot, spec.attemptId)
  let nativeRef, nativePid, serviceHandle
  const heartbeat = join(root, 'owned-writer.txt')
  let stopCalls = 0
  const originalStopAll = ProcessHost.prototype.stopAll
  const serving = serveRunner({
    input,
    recoveryRoot,
    write: (frame) => frames.push(frame),
    payloads: { read: async () => null },
    createDriver: () => ({
      inspect: async () => {
        throw new Error('Fixture only')
      },
      reconcile: async () => {
        throw new Error('Fixture only')
      },
      serve: async (_spec, io) => {
        const child = await io.runtime.spawn({
          executable: process.execPath,
          argv: [
            '-e',
            `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'tick\\n'),25)`,
          ],
          cwdRef: spec.workspaceRef,
          environmentRef: spec.attemptId,
        })
        nativeRef = child.resourceRef
        nativePid = Number(/^res-(\d+)-/.exec(nativeRef)?.[1])
        void (async () => {
          for await (const command of io.commands) seen.push(command.kind)
        })().catch(() => undefined)
        await child.exited
        return { reason: 'cancelled', evidenceRefs: ['fixture-child-exit'] }
      },
    }),
  })
  const write = (frame) => input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
  try {
    write({
      type: 'bootstrap',
      id: 'bootstrap',
      spec,
      payloadRoot: join(root, 'payloads'),
      journalPath: join(root, 'critical.journal'),
      producer,
    })
    await until(
      () => frames,
      (values) => values.some((frame) => frame.type === 'ready'),
    )
    write({
      type: 'command',
      id: 'begin-1',
      command: {
        ...attempt,
        id: 'begin-1',
        kind: 'begin',
        inputRef: 'initial-input',
        preparedPolicyRef: 'prepared-policy',
      },
    })
    await until(() => nativeRef, Boolean)
    await until(() => existsSync(heartbeat), Boolean)
    assert.ok(nativePid && alive(nativePid), 'The negative probe must have a real live child')
    const socketPath = join(endpointRoot, 'runner.sock'),
      credentialPath = join(endpointRoot, 'runner.credential')
    const stat = lstatSync(socketPath)
    const endpoint = { socketPath, credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } }
    let client,
      credentialAdapterUsed = false,
      credentialError
    try {
      client = connectRunnerRecovery(endpoint, producer, 2000)
    } catch (error) {
      credentialError = error.code
    }
    cases.push({
      owner: 'B',
      id: 'DIRECT-MAIN-CLIENT-RECOVERY-CREDENTIAL',
      passesInvariant: !!client,
      observed: { credentialBytes: lstatSync(credentialPath).size, expectedBytes: 64, error: credentialError },
    })
    if (!client) {
      // Continue independent gates with a private fixture key reference; keep B's original file intact.
      const adaptedPath = join(endpointRoot, 'client.key')
      writeFileSync(adaptedPath, readFileSync(credentialPath, 'utf8').trim(), { mode: 0o600 })
      client = connectRunnerRecovery({ ...endpoint, credentialPath: adaptedPath }, producer, 2000)
      credentialAdapterUsed = true
    }
    const inspection = verifiedRunnerInspection(await client.inspect()).value
    cases.push({
      owner: 'B',
      id: 'ACTUAL-SERVICE-LIVE-INVENTORY',
      passesInvariant:
        inspection.state === 'serving' && inspection.resources.some((resource) => resource.ref === nativeRef),
      observed: {
        credentialAdapterUsed,
        nativeAlive: alive(nativePid),
        registeredResources: inspection.resources.length,
        reportedState: inspection.state,
        includesActualChild: inspection.resources.some((resource) => resource.ref === nativeRef),
      },
    })

    // Inject an unproven cleanup into this private probe process, without editing the candidate.
    ProcessHost.prototype.stopAll = async () => {
      stopCalls++
      return { quiescence: 'indeterminate', evidenceRefs: ['injected-unproven-cleanup'] }
    }
    const cancel = { ...attempt, id: 'cancel-1', kind: 'cancel' }
    const proof = await client.cancel(cancel)
    const stoppedView = verifiedRunnerInspection(proof).value
    const beforeBytes = readFileSync(heartbeat).byteLength
    await new Promise((resolve) => setTimeout(resolve, 60))
    const writerStillWriting = readFileSync(heartbeat).byteLength > beforeBytes
    const store = new ProductStore({ path: join(root, 'barrier.sqlite') })
    let barrierAccepted = false
    try {
      store.bindings.record({
        ...attempt,
        source: producer.source,
        runnerIdentityRef: producer.runnerIdentityRef,
        state: 'stopping',
        resources: [],
      })
      store.bindings.setCurrent(attempt.ticketId, attempt.attemptId)
      try {
        confirmOwnedQuiescence(store, proof)
        barrierAccepted = true
      } catch {
        /* Expected when cleanup is unproven. */
      }
      cases.push({
        owner: 'B',
        id: 'INDETERMINATE-CLEANUP-CANNOT-MINT-BARRIER',
        passesInvariant: !barrierAccepted,
        observed: {
          nativeAlive: alive(nativePid),
          cleanupCalled: stopCalls > 0,
          writerStillWriting,
          reportedState: stoppedView.state,
          coverage: stoppedView.coverage,
          registeredResources: stoppedView.resources.length,
          barrierAccepted,
        },
      })
    } finally {
      store.close()
    }
    write({
      type: 'command',
      id: 'deliver-after-cancel',
      command: { ...attempt, id: 'deliver-after-cancel', kind: 'deliver', inputRef: 'supplement' },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    cases.push({
      owner: 'B',
      id: 'CLOSED-RECOVERY-ADMISSION-CLOSES-BUSINESS-PUMP',
      passesInvariant: !seen.includes('deliver'),
      observed: { admission: stoppedView.admission, deliverReachedDriver: seen.includes('deliver') },
    })

    const before = stopCalls
    const body = JSON.stringify({ ...cancel, id: 'wrong-tuple-cancel', ticketId: 'another-ticket' })
    const token = readFileSync(credentialPath, 'utf8').trim()
    const response = await new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath,
          method: 'POST',
          path: '/v1/cancel',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
          timeout: 2000,
        },
        (res) => {
          res.resume()
          res.once('end', () => resolve(res.statusCode))
        },
      )
      req.once('error', reject)
      req.once('timeout', () => req.destroy(new Error('Fixture request deadline')))
      req.end(body)
    })
    cases.push({
      owner: 'B',
      id: 'RECOVERY-CANCEL-REQUIRES-FULL-ATTEMPT-IDENTITY',
      passesInvariant: stopCalls === before && response !== 200,
      observed: { httpStatus: response, wrongTupleReachedStop: stopCalls > before },
    })
  } finally {
    ProcessHost.prototype.stopAll = originalStopAll
    if (nativePid && alive(nativePid)) {
      try {
        process.kill(-nativePid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    input.end()
    serviceHandle = await serving
    await serviceHandle.shutdown()
    await serviceHandle.done
  }
}

async function journalCase() {
  const { FileCriticalJournal } = await load(values.runner, 'apps/runner/src/file-journal.ts')
  const { replayJournal } = await load(values.runner, 'apps/runner/src/runner.ts')
  const { makeFact } = await load(values.runner, 'packages/testing/src/fixtures.ts')
  const path = join(root, 'changed-after-open.journal'),
    journal = new FileCriticalJournal({ path })
  let sinkCalls = 0,
    refused = false
  try {
    await journal.open()
    journal.append(makeFact('turn.ended'), {
      kind: 'turn.ended',
      value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: false, evidenceRefs: ['fixture'] },
    })
    appendFileSync(path, 'x'.repeat(40) + '\n')
    try {
      await replayJournal(journal, {
        record: async (fact) => ({ factId: fact.factId, persisted: true, seq: ++sinkCalls }),
      })
    } catch {
      refused = true
    }
    cases.push({
      owner: 'B',
      id: 'JOURNAL-CORRUPTION-AFTER-OPEN-REFUSES-ALL-REPLAY',
      passesInvariant: refused && sinkCalls === 0,
      observed: { refused, sinkCalls },
    })
  } finally {
    journal.close()
  }
}

try {
  if (checkWorkspace) await workspaceCases()
  if (checkRunner) {
    await runnerCases()
    await journalCase()
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
const report = {
  status: cases.every((item) => item.passesInvariant)
    ? 'PASS_WAVE02_DELIVERY_RUNTIME_ADMISSION'
    : 'BLOCKED_WAVE02_DELIVERY_RUNTIME_ADMISSION',
  checkedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  reviewerCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
  }).trim(),
  ...(checkWorkspace
    ? {
        workspaceSource: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: values.workspaces,
          encoding: 'utf8',
        }).trim(),
      }
    : {}),
  ...(checkRunner
    ? { runnerSource: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: values.runner, encoding: 'utf8' }).trim() }
    : {}),
  cases,
  scope:
    'Committed candidates only; private temporary projects, real harmless child, injected unproven stop, real main barrier; no vendor/model/user-project operation',
}
if (values.record)
  writeFileSync(
    new URL('../../reports/releases/wave-02-delivery-runtime-admission.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  )
console.log(JSON.stringify(report, null, 2))
assert.ok(
  cases.every((item) => item.passesInvariant),
  'Do not admit generic delivery or the independent service until these invariants pass',
)
