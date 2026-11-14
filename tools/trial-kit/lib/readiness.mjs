/**
 * Read-only consumer of the main-published `GET /v1/readiness` (0064, `trial-readiness/1`).
 *
 * Boundaries enforced here:
 *   - the address must be an explicit loopback literal (`127.0.0.1`, `::1`, `localhost`) — this tool
 *     never discovers or guesses a service address;
 *   - the bearer token comes from an explicit private file (0600) or an explicit environment name,
 *     is bounded, and is never printed, logged or written into a report;
 *   - one GET request, no query, no redirects, finite deadline, response byte cap;
 *   - the body is validated against the published strict schema, so an unknown field, a wrong
 *     protocol, an authorization claim or a failing readonly invariant is refused rather than
 *     "made ready";
 *   - readiness carries no package identity, so package↔readiness binding is reported as `unknown`
 *     unless the caller asserts a configuration revision and observation age.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { request as secureRequest } from 'node:https'
import { TrialKitError, fail, pass, unknown } from './output.mjs'
import { LIMITS } from './limits.mjs'

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]'])

export function assertLoopbackUrl(raw) {
  let url
  try { url = new URL(raw) } catch { throw new TrialKitError('usage', '--readiness must be an absolute http(s) URL') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new TrialKitError('usage', '--readiness must use http or https')
  if (!LOOPBACK.has(url.hostname)) throw new TrialKitError('refused_target', 'Readiness address must be an explicit loopback target', { hostname: url.hostname })
  if (url.pathname !== '/' && url.pathname !== '') throw new TrialKitError('usage', 'Readiness takes no path; the tool appends /v1/readiness itself')
  if (url.search.length > 0) throw new TrialKitError('usage', 'Readiness takes no query parameters')
  return url
}

/**
 * Read one explicit private token file with descriptor-level checks:
 *   - O_NOFOLLOW: a symlink is refused instead of followed;
 *   - lstat/fstat dev+ino equality: a path swapped between check and open is refused;
 *   - regular file, exactly 0600, owned by this uid, single link (nlink === 1): hardlinks, FIFOs,
 *     sockets and devices are refused;
 *   - a hard size bound before reading.
 * The value is returned to the caller only and is never logged by this module.
 */
export function readTokenFile(path) {
  let before
  try { before = lstatSync(path) } catch { throw new TrialKitError('token_unavailable', 'Token file does not exist', { path }) }
  if (before.isSymbolicLink()) throw new TrialKitError('token_symlink', 'Token file must not be a symlink', { path })
  if (!before.isFile()) throw new TrialKitError('token_not_regular', 'Token file must be a regular file', { path })
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  } catch (error) {
    const code = String(error?.code ?? 'open_failed')
    throw new TrialKitError(code === 'ELOOP' ? 'token_symlink' : 'token_unavailable', 'Token file cannot be opened safely', { code })
  }
  try {
    const info = fstatSync(fd)
    if (info.dev !== before.dev || info.ino !== before.ino) throw new TrialKitError('token_replaced', 'Token file identity changed between check and open')
    if (!info.isFile()) throw new TrialKitError('token_not_regular', 'Token file descriptor is not a regular file')
    if ((info.mode & 0o777) !== 0o600) throw new TrialKitError('token_permissions', 'Token file must be exactly 0600', { mode: (info.mode & 0o777).toString(8) })
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new TrialKitError('token_owner', 'Token file must be owned by the current user')
    if (info.nlink !== 1) throw new TrialKitError('token_hardlink', 'Token file must not have other hardlinks', { nlink: info.nlink })
    if (info.size < 8 || info.size > 4096) throw new TrialKitError('token_invalid', 'Token file size is outside the accepted range', { bytes: info.size })
    const token = readFileSync(fd, 'utf8').trim()
    if (token.length < 8) throw new TrialKitError('token_invalid', 'Token is too short to be a real credential')
    return token
  } finally {
    closeSync(fd)
  }
}

function fetchOnce(url, { token, timeoutMs, maxBytes }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const client = url.protocol === 'https:' ? secureRequest : request
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('deadline exceeded')), timeoutMs)
    const headers = { accept: 'application/json' }
    if (typeof token === 'string' && token.length > 0) headers.authorization = `Bearer ${token}`
    const req = client({
      protocol: url.protocol, hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/v1/readiness', method: 'GET', headers, signal: controller.signal, agent: false,
    }, (response) => {
      const chunks = []
      let bytes = 0
      response.on('data', (chunk) => {
        bytes += chunk.byteLength
        if (bytes > maxBytes) {
          controller.abort(new Error('response too large'))
          rejectPromise(new TrialKitError('response_too_large', 'Readiness response exceeds the byte budget', { bytes, maxBytes }))
          response.destroy()
          return
        }
        chunks.push(chunk)
      })
      response.on('error', (error) => rejectPromise(new TrialKitError('readiness_failed', 'Readiness response failed', { cause: String(error?.message ?? error) })))
      response.on('end', () => {
        clearTimeout(timer)
        resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', (error) => {
      clearTimeout(timer)
      const aborted = error?.name === 'AbortError' || String(error?.message).includes('abort')
      rejectPromise(new TrialKitError(aborted ? 'readiness_timeout' : 'readiness_unreachable', aborted ? 'Readiness request hit its deadline' : 'Readiness endpoint is unreachable', { cause: String(error?.code ?? error?.message ?? error) }))
    })
    req.end()
  })
}

/**
 * Perform the bounded read and validate the payload. Returns `{ checks, readiness, meta }`.
 * `schema` is the published `TrialReadinessSchema`; it is injected so this module has no second copy
 * of the contract.
 */
export async function readReadiness({ url, token, schema, expectations = {}, timeoutMs = LIMITS.networkTimeoutMs, maxBytes = LIMITS.maxResponseBytes }) {
  const checks = []
  const target = assertLoopbackUrl(url)
  const observations = []
  let response
  try {
    response = await fetchOnce(target, { token, timeoutMs, maxBytes })
    checks.push(pass('http_status', { status: response.status }))
  } catch (error) {
    const known = error instanceof TrialKitError ? error : new TrialKitError('readiness_failed', String(error?.message ?? error))
    checks.push(fail(known.code === 'readiness_timeout' ? 'deadline' : known.code === 'response_too_large' ? 'body_size' : 'http_status', { code: known.code, detail: known.detail ?? null }))
    return { checks, readiness: null, meta: { address: target.origin, authenticated: typeof token === 'string' && token.length > 0 } }
  }

  if (response.status >= 300 && response.status < 400) {
    checks.push(fail('no_redirect', { status: response.status, location: response.headers.location ?? null }))
    return { checks, readiness: null, meta: { address: target.origin } }
  }
  if (response.status !== 200) {
    checks.push(fail('http_status', { status: response.status, note: 'only 200 with a schema-valid body is observable readiness' }))
    return { checks, readiness: null, meta: { address: target.origin } }
  }
  checks.push(pass('body_size', { bytes: Buffer.byteLength(response.body) }))

  let payload
  try {
    payload = JSON.parse(response.body)
    checks.push(pass('json_valid'))
  } catch {
    checks.push(fail('json_valid', { reason: 'invalid_json' }))
    return { checks, readiness: null, meta: { address: target.origin } }
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    checks.push(fail('schema_valid', { issues: parsed.error.issues.slice(0, 8).map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })) }))
    return { checks, readiness: null, meta: { address: target.origin } }
  }
  const readiness = parsed.data
  checks.push(pass('schema_valid', { protocol: readiness.protocol }))
  checks.push(readiness.authorization === 'none' ? pass('authorization_none') : fail('authorization_none', { observed: readiness.authorization }))

  const observedAt = Date.parse(readiness.observedAt)
  checks.push(Number.isFinite(observedAt) ? pass('observation_time', { observedAt: readiness.observedAt }) : fail('observation_time', { observedAt: readiness.observedAt }))
  if (expectations.maxAgeSeconds !== undefined) {
    const ageSeconds = Number.isFinite(observedAt) ? Math.round((Date.now() - observedAt) / 1000) : null
    const ok = ageSeconds !== null && ageSeconds >= -300 && ageSeconds <= expectations.maxAgeSeconds
    checks.push(ok ? pass('observation_fresh', { ageSeconds }) : fail('observation_fresh', { ageSeconds, maxAgeSeconds: expectations.maxAgeSeconds }))
    observations.push({ field: 'ageSeconds', value: ageSeconds })
  } else {
    checks.push(unknown('observation_fresh', { reason: 'not_requested', note: 'pass --max-observation-age-seconds to reject stale observations' }))
  }

  const comparison = []
  if (expectations.configurationRevision !== undefined) comparison.push({ field: 'configurationRevision', expected: expectations.configurationRevision, observed: readiness.configurationRevision, ok: readiness.configurationRevision === expectations.configurationRevision })
  if (expectations.mode !== undefined) comparison.push({ field: 'mode', expected: expectations.mode, observed: readiness.mode, ok: readiness.mode === expectations.mode })
  if (expectations.startupMode !== undefined) comparison.push({ field: 'startupMode', expected: expectations.startupMode, observed: readiness.startupMode, ok: readiness.startupMode === expectations.startupMode })
  if (comparison.length > 0) {
    const failed = comparison.filter((entry) => !entry.ok)
    checks.push(failed.length === 0 ? pass('expected_subject', { comparisons: comparison }) : fail('expected_subject', { comparisons: comparison }))
  } else {
    checks.push(unknown('expected_subject', { reason: 'not_requested' }))
  }

  // The published payload has no build/source field. Saying otherwise would invent a binding.
  checks.push(unknown('package_binding', {
    reason: 'readiness_has_no_package_identity',
    note: 'readiness carries configuration facts only; binding to a package needs an explicit configuration revision or the caller\'s own instance record',
  }))

  return {
    checks,
    readiness: {
      protocol: readiness.protocol, observedAt: readiness.observedAt, configurationRevision: readiness.configurationRevision,
      mode: readiness.mode, startupMode: readiness.startupMode, discussion: readiness.discussion, execution: readiness.execution,
      development: readiness.development, projects: readiness.projects, profiles: readiness.profiles,
      capabilities: readiness.capabilities, authorization: readiness.authorization,
    },
    meta: { address: target.origin, authenticated: typeof token === 'string' && token.length > 0, observations },
  }
}
