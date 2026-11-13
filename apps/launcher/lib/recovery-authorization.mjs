/**
 * Consumption of main's recovery inspect/prepare interface (WP-16/0025 §3).
 *
 * The launcher is not an authorization service: it opens a local authenticated session with the
 * instance's own bootstrap credential, asks the instance what recovery state it is in, and requests a
 * bounded read-only rebinding plan. Main currently answers `authorization=not_granted` with
 * `commitAvailable=false`, so this module reports that as a blocker instead of inventing a commit.
 *
 * It never writes the database, the restore marker, the queue or any native profile, and it never
 * prints credentials. Everything here is local loopback with `connection: close`.
 */
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { readInstanceRecord, verifyInstance } from './instance.mjs'

export class RecoveryAuthorizationError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'RecoveryAuthorizationError'
    this.code = code
    this.detail = detail
  }
}

const SESSION_COOKIE = 'pa_local_session'

const call = (url, { method = 'GET', body, cookie, origin, timeoutMs = 10_000 } = {}) =>
  new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const outgoing = request(
      url,
      {
        method,
        agent: false,
        timeout: timeoutMs,
        headers: {
          connection: 'close',
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.byteLength) } : {}),
          ...(cookie ? { cookie } : {}),
          ...(origin ? { origin } : {}),
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = null
          try {
            parsed = text === '' ? null : JSON.parse(text)
          } catch {
            parsed = null
          }
          resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body: parsed, text })
        })
        response.on('error', reject)
      },
    )
    outgoing.on('timeout', () => outgoing.destroy(new RecoveryAuthorizationError('recovery_timeout', 'Recovery request timed out', { url })))
    outgoing.on('error', reject)
    if (payload) outgoing.write(payload)
    outgoing.end()
  })

const readSecret = (stateDir, name) => {
  const path = join(stateDir, name)
  try {
    const value = readFileSync(path, 'utf8').trim()
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('unexpected format')
    return value
  } catch {
    throw new RecoveryAuthorizationError('credential_unavailable', `Local ${name} is missing or unreadable; the instance was not started by this launcher`, { file: name })
  }
}

/**
 * Opens one short local session and returns a function that performs authenticated calls. The
 * session cookie and the bootstrap credential are never returned to the caller.
 */
const withSession = async ({ roots, allowStartupModes = ['recovery_readonly', 'normal'] }, work) => {
  const record = readInstanceRecord(roots.config)
  if (record === null) throw new RecoveryAuthorizationError('instance_not_running', 'No managed instance is recorded; recovery inspect/prepare needs a running instance')
  const verification = await verifyInstance(record)
  if (!verification.ok) throw new RecoveryAuthorizationError('instance_not_running', 'The recorded instance is not verifiably running', { reason: verification.code ?? null })
  const startupMode = record.startupMode ?? 'normal'
  if (!allowStartupModes.includes(startupMode))
    throw new RecoveryAuthorizationError('startup_mode_not_applicable', `Recovery inspect/prepare does not apply to a ${startupMode} instance`, { startupMode })
  const apiURL = record.apiURL
  const origin = new URL(apiURL).origin
  const bootstrap = readSecret(record.state ?? roots.data, 'bootstrap.key')
  const session = await call(`${apiURL}/v1/session`, { method: 'POST', body: { bootstrapToken: bootstrap }, origin })
  if (session.status !== 200) {
    throw new RecoveryAuthorizationError('auth_unavailable', 'The instance rejected the launcher bootstrap credential', { status: session.status, code: session.body?.code ?? null })
  }
  const cookies = session.headers['set-cookie'] ?? []
  // A local-development instance authenticates by Origin and returns no cookie; a token-mode
  // instance returns the private session cookie. Both are the instance's own local identity.
  const cookie = cookies.map((entry) => entry.split(';')[0]).find((entry) => entry.startsWith(`${SESSION_COOKIE}=`)) ?? null
  try {
    return await work({ apiURL, origin, cookie, record, startupMode })
  } finally {
    if (cookie !== null) await call(`${apiURL}/v1/session`, { method: 'DELETE', cookie, origin }).catch(() => {})
  }
}

const safeProject = (project) => ({
  id: typeof project?.id === 'string' ? project.id : null,
  displayName: typeof project?.displayName === 'string' ? project.displayName : null,
})

export const recoveryInspect = ({ roots }) =>
  withSession({ roots, allowStartupModes: ['recovery_readonly', 'normal'] }, async ({ apiURL, origin, cookie, startupMode }) => {
    const response = await call(`${apiURL}/v1/recovery/inspect`, { origin, cookie })
    if (response.status !== 200)
      throw new RecoveryAuthorizationError('inspect_unavailable', 'Recovery inspect was refused by the instance', { status: response.status, code: response.body?.code ?? null })
    const body = response.body ?? {}
    return {
      protocol: 'personal-recovery-inspect/1',
      source: 'main GET /v1/recovery/inspect',
      state: body.state ?? startupMode,
      startupMode: body.state === 'recovery_readonly' ? 'recovery_readonly' : startupMode,
      observedAt: body.observedAt ?? null,
      inspectionFingerprint: body.inspectionFingerprint ?? null,
      markerDigest: body.markerDigest ?? null,
      productSchema: body.productSchema ?? null,
      schema: { productSchema: body.productSchema ?? null },
      eventCursor: body.eventCursor ?? null,
      heldQueue: body.heldQueue ?? null,
      retainedQueue: body.heldQueue ?? null,
      sourceWorksScanned: body.sourceWorksScanned ?? null,
      sourceScanTruncated: body.sourceScanTruncated === true,
      projects: Array.isArray(body.projects) ? body.projects.map(safeProject) : [],
      historicalAttempts: Array.isArray(body.historicalAttempts) ? body.historicalAttempts : [],
      blockers: Array.isArray(body.blockers) ? body.blockers : [],
      // Inspect is observation only; it is never an authorization.
      authorization: 'not_granted',
      commitAvailable: body.commitAvailable === true,
      limitations: [
        'Inspect is a bounded local observation, not proof that the physical writer stopped and not a grant for new work.',
        'D never treats this response, a saved fingerprint or a prepare plan as authorization.',
      ],
    }
  })

/**
 * Requests a read-only rebinding plan. `bindings` must be explicit: the caller names one existing
 * source project and one current absolute Git root. Nothing is applied or persisted by prepare.
 */
export const recoveryPrepare = ({ roots, bindings }) =>
  withSession({ roots, allowStartupModes: ['recovery_readonly'] }, async ({ apiURL, origin, cookie }) => {
    const inspect = await call(`${apiURL}/v1/recovery/inspect`, { origin, cookie })
    if (inspect.status !== 200)
      throw new RecoveryAuthorizationError('inspect_unavailable', 'Recovery inspect was refused before prepare', { status: inspect.status })
    const fingerprint = inspect.body?.inspectionFingerprint
    if (typeof fingerprint !== 'string') throw new RecoveryAuthorizationError('inspect_unavailable', 'Recovery inspect did not return an inspection fingerprint')
    const response = await call(`${apiURL}/v1/recovery/prepare`, {
      method: 'POST',
      origin,
      cookie,
      body: { expectedFingerprint: fingerprint, bindings },
    })
    if (response.status !== 200)
      throw new RecoveryAuthorizationError('prepare_refused', 'Recovery prepare was refused', { status: response.status, code: response.body?.code ?? null, blockers: response.body?.blockers ?? null })
    const plan = response.body ?? {}
    return {
      protocol: 'personal-recovery-prepare/1',
      source: 'main POST /v1/recovery/prepare',
      planId: plan.planId ?? null,
      createdAt: plan.createdAt ?? null,
      expiresAt: plan.expiresAt ?? null,
      executor: plan.executor ?? null,
      artifactsChecked: plan.artifactsChecked ?? null,
      inspectionFingerprint: fingerprint,
      authorization: plan.authorization ?? 'not_granted',
      commitAvailable: plan.commitAvailable === true,
      bindings: Array.isArray(plan.bindings) ? plan.bindings : [],
      blockers: Array.isArray(plan.blockers) ? plan.blockers : [],
      applied: false,
      limitations: [
        'Prepare is read-only: it writes no database row, event, receipt, native-projects entry or restore marker, and the old queue is untouched.',
        'The plan is not persisted and is not a signed authorization token.',
        'commit is not implemented; a successful preflight is not recovery activation and not native admission.',
      ],
    }
  })

export const RECOVERY_COMMIT_REQUIREMENTS = {
  status: 'BLOCKED',
  owner: 'main',
  interface: 'POST /v1/recovery/commit (WP-16/0025 §4: not implemented)',
  reason:
    'Main publishes inspect and read-only prepare only. Authorization, receipt and the necessary state transition must be committed together (or be a replayable deterministic activation boundary); D will not invent that boundary or flip the restored state to normal.',
  requiredInputs: [
    'isolation of the restored database from new business effects, and proof that no old execute/answer/assistant/verify/reconcile queue entry is consumed',
    'fresh re-verification of machine, project paths, executor, environment and physical resource state',
    'explicit authenticated confirmation of the exact plan plus current fingerprint, with idempotent receipt and expired/drifted/replayed rejection',
    'only new work/new contracts authorized; old markers kept and unknown-writer barriers preserved',
  ],
  forbidden: [
    'delete the restore marker',
    'switch a restored database to normal',
    'add a force/allow-resume switch',
    'replay the old queue',
    'treat a saved fingerprint or prepare plan as a credential',
  ],
}
