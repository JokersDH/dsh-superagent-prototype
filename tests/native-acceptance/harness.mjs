/**
 * Native MVP acceptance harness (external Agent B).
 *
 * This directory owns **only** acceptance tooling, fixtures, evidence and reports. It does not
 * change runner/driver/core/HTTP/console/schema/root-lock, and it never lowers the product's
 * expectations to make a case pass.
 *
 * Two lanes, never mixed:
 *
 * - **read-only lane** (default): probes the running product's published boundary, validates
 *   `GET /v1/configuration`, and asserts the harness itself works. No model call, no state change.
 * - **native lane** (`--run-native`): performs real delegations against a private scratch project
 *   with the real Codex driver. It refuses to run when the published configuration does not contain
 *   an admitted native profile, and it never falls back to a fixture profile to "pass".
 *
 * Usage:
 *   node tests/native-acceptance/harness.mjs --url http://127.0.0.1:8796 [--run-native] [--expect-results <file>]
 *
 * The harness prints one JSON report (also written with `--record`) and exits non-zero when any
 * executed case FAILs. Unavailable native prerequisites are reported as NOT_TESTED, never as PASS.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const ACCEPTANCE_ROOT = here

// --- argument parsing --------------------------------------------------------

export function parseArgs(argv) {
  const options = { url: 'http://127.0.0.1:8796', runNative: false, record: undefined, state: undefined, project: undefined, timeoutMs: 30_000 }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const next = argv[index + 1]
    if (flag === '--url') options.url = next, index += 1
    else if (flag === '--run-native') options.runNative = true
    else if (flag === '--record') options.record = next, index += 1
    else if (flag === '--state') options.state = next, index += 1
    else if (flag === '--project') options.project = next, index += 1
    else if (flag === '--timeout-ms') options.timeoutMs = Number(next), index += 1
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw new Error(`Unknown argument: ${flag}`)
  }
  return options
}

// --- transport ---------------------------------------------------------------

/**
 * Minimal authenticated HTTP client.
 *
 * The API bearer credential is read from the private state file and is **never** printed or stored in
 * the report. Cookies from `POST /v1/session` are kept in memory only.
 */
export class ApiClient {
  #base
  #bearer
  #cookie
  #timeoutMs

  constructor({ url, bearer, timeoutMs = 30_000 }) {
    this.#base = url.replace(/\/+$/, '')
    this.#bearer = bearer
    this.#cookie = undefined
    this.#timeoutMs = timeoutMs
  }

  get base() {
    return this.#base
  }

  /** The private bootstrap token used to establish a session (never printed). */
  static bootstrapTokenFrom(stateDir) {
    const path = stateDir && resolve(stateDir, 'bootstrap.key')
    return path && existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined
  }

  static fromState({ url, stateDir, timeoutMs }) {
    // The product writes `api.key`; the other names are accepted for older private layouts.
    const candidates = [
      stateDir && resolve(stateDir, 'api.key'),
      stateDir && resolve(stateDir, 'api-token'),
      stateDir && resolve(stateDir, 'token'),
      stateDir && resolve(stateDir, 'private', 'api-token'),
    ].filter(Boolean)
    const found = candidates.find(candidate => existsSync(candidate))
    if (!found) {
      return { client: new ApiClient({ url, bearer: undefined, timeoutMs }), bearerAvailable: false }
    }
    const bearer = readFileSync(found, 'utf8').trim()
    return { client: new ApiClient({ url, bearer, timeoutMs }), bearerAvailable: true }
  }

  async session(bootstrapToken) {
    const response = await this.#call('POST', '/v1/session', { body: { bootstrapToken }, anonymous: true })
    const setCookie = response.headers['set-cookie']
    if (Array.isArray(setCookie) && setCookie.length > 0) this.#cookie = setCookie[0].split(';')[0]
    return response
  }

  async request(method, path, { body, anonymous = false } = {}) {
    return this.#call(method, path, { body, anonymous })
  }

  async #call(method, path, { body, anonymous }) {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const headers = {}
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = payload.length
      // Cookie-authenticated state changes must carry the exact authorized origin.
      headers.origin = this.#base
    }
    if (!anonymous && this.#bearer) headers.authorization = `Bearer ${this.#bearer}`
    if (!anonymous && this.#cookie) headers.cookie = this.#cookie
    headers.accept = 'application/json'

    const startedAt = Date.now()
    const response = await new Promise((resolvePromise, rejectPromise) => {
      const req = httpRequest(`${this.#base}${path}`, { method, headers, timeout: this.#timeoutMs }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json
          try {
            json = text ? JSON.parse(text) : undefined
          } catch {
            json = undefined
          }
          resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, text, json, elapsedMs: Date.now() - startedAt })
        })
      })
      req.once('timeout', () => req.destroy(new Error('request timed out')))
      req.once('error', rejectPromise)
      if (payload) req.write(payload)
      req.end()
    })
    return response
  }
}

// --- case bookkeeping --------------------------------------------------------

export const STATUS = ['PASS', 'FAIL', 'SKIPPED', 'NOT_TESTED']

export class CaseLog {
  #cases = []
  #current

  begin(id, title, lane) {
    this.#current = { id, title, lane, status: 'NOT_TESTED', detail: [], evidence: [], entities: [] }
    return this
  }

  note(text) {
    if (this.#current) this.#current.detail.push(text)
    return this
  }

  evidence(value) {
    if (this.#current) this.#current.evidence.push(value)
    return this
  }

  entity(value) {
    if (this.#current) this.#current.entities.push(value)
    return this
  }

  finish(status, detail) {
    if (!this.#current) return
    if (detail) this.#current.detail.push(detail)
    this.#current.status = status
    this.#cases.push(this.#current)
    this.#current = undefined
  }

  pass(detail) {
    this.finish('PASS', detail)
  }

  fail(detail) {
    this.finish('FAIL', detail)
  }

  skip(detail) {
    this.finish('SKIPPED', detail)
  }

  notTested(detail) {
    this.finish('NOT_TESTED', detail)
  }

  get cases() {
    return this.#cases
  }
}

// --- environment / identity --------------------------------------------------

/** Product, driver and platform identity recorded with every report. */
export function environmentIdentity(extra = {}) {
  return {
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    acceptanceCheckpoint: 'tests/native-acceptance',
    ...extra,
  }
}

export function writeReport({ cases, environment, extra = {} }, recordPath) {
  const counts = Object.fromEntries(STATUS.map(status => [status, cases.filter(item => item.status === status).length]))
  const report = {
    generatedAt: new Date().toISOString(),
    environment,
    totals: { cases: cases.length, ...counts },
    ...extra,
    cases,
  }
  if (recordPath) {
    mkdirSync(dirname(recordPath), { recursive: true })
    writeFileSync(recordPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  return report
}
