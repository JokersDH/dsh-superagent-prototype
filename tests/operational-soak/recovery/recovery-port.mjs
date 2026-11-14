/**
 * Recovery-port recipe for the already-admitted B surface: `serveRunnerRecovery` /
 * `connectRunnerRecovery` (inspect + cancel only, authenticated Unix socket, registered dev/ino).
 *
 * The backend is an in-process test state, not a coordinator, ledger or receipt-only business
 * service. No begin/deliver/answer route exists here, no model/native call happens, and every fault
 * is a legal protocol response or client-side check: auth_failed, identity_mismatch, timeout and
 * stale_proof. Business reconnect/resume remains NOT_REACHED and is not simulated.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRunnerCredential, connectRunnerRecovery, serveRunnerRecovery, verifiedRunnerInspection } from '../../../packages/execution/src/recovery-transport.ts'

const RESOURCE = 'fixture-resource-owned'

function context(attempt, source) {
  return { attempt, runnerIdentityRef: 'fixture-runner-identity', source }
}

export async function runRecoveryPortRecipe({ root, attempt, factSource }) {
  // Unix socket paths are limited to ~104 bytes; keep this run's socket+credential in a fresh,
  // short, owned temporary directory and remove it at the end. No user path or state is involved.
  const directory = mkdtempSync('/tmp/trial-recovery-port-')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const socketPath = join(directory, 'recovery.sock')
  if (Buffer.byteLength(socketPath) > 90) throw new Error(`Recovery socket path is too long (${Buffer.byteLength(socketPath)} > 90)`)
  const credentialPath = join(directory, 'recovery.key')
  createRunnerCredential(credentialPath)

  const state = {
    inspectCount: 0,
    cancelCount: 0,
    delayMs: 0,
    current: {
      state: 'serving', admission: 'closed', coverage: 'complete_owned_resources',
      resources: [{ ref: RESOURCE, ownership: 'spawned_process', writer: 'quiescent', evidence: ['fixture:writer-quiescent'] }],
      evidence: ['fixture:inspection'],
    },
  }
  const backend = {
    async inspect() {
      state.inspectCount += 1
      if (state.delayMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, state.delayMs))
      return structuredClone(state.current)
    },
    async cancel() {
      state.cancelCount += 1
      state.current = { ...state.current, state: 'terminated', admission: 'closed', evidence: ['fixture:cancelled'] }
      return structuredClone(state.current)
    },
  }

  const trusted = context(attempt, factSource)
  const server = await serveRunnerRecovery({ socketPath, credentialPath }, trusted, backend)
  const report = {
    protocol: 'recovery-port-fixture/1',
    surface: 'admitted-recovery-port (GET /v1/inspection, POST /v1/cancel)',
    businessSurface: 'NOT_REACHED',
    modelCalls: 0,
    modelTurns: 0,
    executor: 'none (in-process recovery backend)',
    endpoint: { socketPath: '<temporary-owned>/recovery.sock', credentialPath: '<temporary-owned>/recovery.key', socketIdentity: server.endpoint.socketIdentity },
    positive: null,
    faults: [],
  }
  try {
    const link = connectRunnerRecovery(server.endpoint, trusted, 1000)
    const proof = await link.inspect()
    const verified = verifiedRunnerInspection(proof, 5000)
    const cancelled = await link.cancel({ kind: 'cancel', id: 'fixture-cancel-1', ...attempt })
    const afterCancel = verifiedRunnerInspection(cancelled, 5000)
    report.positive = {
      inspect: { state: verified.value.state, admission: verified.value.admission, coverage: verified.value.coverage, resources: verified.value.resources.length, evidence: verified.value.evidence },
      cancel: { state: afterCancel.value.state, admission: afterCancel.value.admission, evidence: afterCancel.value.evidence },
      counts: { inspect: state.inspectCount, cancel: state.cancelCount },
    }

    // Fault 1: wrong credential value (private file, wrong content).
    const wrongKey = join(directory, 'wrong.key')
    writeFileSync(wrongKey, 'b'.repeat(64), { mode: 0o600 })
    report.faults.push({ id: 'wrong_credential', expected: 'auth_failed', actual: await codeOf(() => connectRunnerRecovery({ ...server.endpoint, credentialPath: wrongKey }, trusted, 500).inspect()), sends: 0, executes: 0 })

    // Fault 2: different subject context.
    report.faults.push({ id: 'foreign_subject', expected: 'identity_mismatch', actual: await codeOf(() => connectRunnerRecovery(server.endpoint, context(attempt, 'foreign-source-wave26'), 500).inspect()), sends: 0, executes: 0 })

    // Fault 3: changed registered socket identity (dev/ino from another stat).
    report.faults.push({ id: 'changed_socket_identity', expected: 'identity_mismatch', actual: await codeOf(() => connectRunnerRecovery({ ...server.endpoint, socketIdentity: { dev: server.endpoint.socketIdentity.dev + 1, ino: server.endpoint.socketIdentity.ino + 1 } }, trusted, 500).inspect()), sends: 0, executes: 0 })

    // Fault 4: slow backend beyond the client deadline.
    state.delayMs = 400
    report.faults.push({ id: 'inspection_timeout', expected: 'timeout', actual: await codeOf(() => connectRunnerRecovery(server.endpoint, trusted, 100).inspect()), sends: 0, executes: 0 })
    state.delayMs = 0

    // Fault 5: stale proof after the verification window.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30))
    report.faults.push({ id: 'stale_proof', expected: 'stale_proof', actual: await codeOf(async () => verifiedRunnerInspection(proof, 1)), sends: 0, executes: 0 })

    report.faultsOk = report.faults.every((fault) => fault.expected === fault.actual)
    return report
  } finally {
    await server.close()
    try { rmSync(directory, { recursive: true, force: true }) } catch { /* own fixture cleanup */ }
  }
}

async function codeOf(action) {
  try { await action(); return 'unexpected_success' } catch (error) { return String(error?.code ?? error?.message ?? 'unknown') }
}

/** Datareader for the fixture: confirm only the admitted surface is reachable. */
export function readRecoveryFacts({ root }) {
  const reportPath = join(root, 'recovery-port.json')
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  return {
    protocol: 'recovery-port-read/1',
    surface: report.surface,
    businessSurface: report.businessSurface,
    positive: report.positive,
    faults: report.faults,
    sends: 0,
    executes: 0,
    modelCalls: 0,
  }
}
