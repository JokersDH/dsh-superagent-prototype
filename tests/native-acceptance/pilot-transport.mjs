/**
 * Real Codex pilot transport (wave-06 B: author execution, checkpoint, continuation, fresh session).
 *
 * This is an actual transport, not a descriptor of one. It spawns the installed `codex app-server`
 * and speaks its JSON-RPC 2.0 protocol over stdio, newline-delimited, with lossless string ids.
 *
 * Method surface verified against the installed codex-cli 0.164.0 (751 generated bindings plus the
 * native binary's own method strings):
 *
 *   initialize            handshake; does not bill
 *   thread/start          create a thread (`ephemeral: true` keeps it off disk); does not bill
 *   thread/resume         re-open an existing thread; does not bill
 *   thread/fork           branch a thread, optionally `lastTurnId`; does not bill
 *   thread/read           read a thread and its turns; does not bill
 *   turn/start            *** THE ONLY BILLING OPERATION ***
 *   turn/interrupt        stop the current turn
 *   turn/completed        notification: a turn finished
 *   thread/tokenUsage/updated  notification: usage for a turn (arrives after the turn ran)
 *
 * Two rules are structural here, not documentation:
 *
 * 1. `startTurn` refuses to write to the wire unless a reservation hook admits it. There is no
 *    code path that sends a turn without one, and the `no_review` author arm is not exempt - the
 *    author turn is billable too, so labelling an arm "no review" cannot make it free.
 * 2. The pre-send intent is persisted through the hook *before* the bytes are written. If the
 *    process dies mid-write the hook record still identifies the send, so it is reconciled under
 *    its original identity and never re-sent under a new one.
 *
 * Nothing here inspects or constructs in a way that sends a model task: `inspect()` only reads.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

/** Methods that must never bill. Exposed so a caller and a test can assert the split. */
export const NON_BILLING_METHODS = Object.freeze([
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/fork',
  'thread/read',
  'thread/list',
  'thread/turns/list',
  'thread/items/list',
])

/** The single method that can start a model turn. */
export const BILLING_METHOD = 'turn/start'

const sha256 = value => createHash('sha256').update(value).digest('hex')

export class PilotTransportError extends Error {
  constructor(reason, message, detail = {}) {
    super(message)
    this.name = 'PilotTransportError'
    this.reason = reason
    this.detail = detail
  }
}

/**
 * One live `codex app-server` process.
 *
 * Usage:
 *   const transport = await PilotTransport.launch({ cwd })
 *   await transport.initialize()
 *   const thread = await transport.startThread({ ephemeral: true })
 *   ...
 *   await transport.close()
 */
export class PilotTransport {
  #child
  #buffer = ''
  #nextId = 1
  #open = new Map()
  #notifications = []
  #incomingRequests = []
  #sentMethods = []
  #closed = false
  #stderr = ''

  static async launch(options = {}) {
    const transport = new PilotTransport(options)
    await transport.#spawnProcess()
    return transport
  }

  constructor(options = {}) {
    this.binary = options.binary ?? 'codex'
    this.args = options.args ?? ['app-server']
    this.cwd = options.cwd ?? process.cwd()
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.env = options.env
  }

  async #spawnProcess() {
    this.#child = spawn(this.binary, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.env ? { env: { ...process.env, ...this.env } } : {}),
    })
    this.#child.stdout.setEncoding('utf8')
    this.#child.stdout.on('data', chunk => this.#onData(chunk))
    this.#child.stderr.setEncoding('utf8')
    this.#child.stderr.on('data', chunk => {
      // Keep stderr bounded: it is diagnostic only, never a business fact.
      if (this.#stderr.length < 16_384) this.#stderr += chunk
    })
    this.#child.once('exit', (code, signal) => this.#onExit(code, signal))
    this.#child.once('error', error => this.#onExit(null, null, error))
    // A refused write (already-exited child) must not surface as an unhandled error.
    this.#child.stdin.on('error', () => {})
  }

  get pid() {
    return this.#child?.pid ?? null
  }

  /** Every method this transport actually put on the wire, in order. */
  sentMethods() {
    return this.#sentMethods.slice()
  }

  /** Notifications received so far (turn/completed, token usage, ...). */
  receivedNotifications() {
    return this.#notifications.slice()
  }

  /** Server-to-client requests received (approvals, user input). Recorded, never auto-answered. */
  receivedRequests() {
    return this.#incomingRequests.slice()
  }

  stderrTail() {
    return this.#stderr.slice(-2048)
  }

  #onData(chunk) {
    this.#buffer += chunk
    let index
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index).trim()
      this.#buffer = this.#buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        // A malformed line is dropped: it cannot become a business fact.
        continue
      }
      this.#dispatch(message)
    }
  }

  #dispatch(message) {
    if (message === null || typeof message !== 'object') return
    const hasId = message.id !== undefined && message.id !== null
    const hasMethod = typeof message.method === 'string'
    // A reply carries an id and no method.
    if (hasId && !hasMethod) {
      const key = String(message.id)
      const waiter = this.#open.get(key)
      if (!waiter) return
      this.#open.delete(key)
      clearTimeout(waiter.timer)
      if (message.error) waiter.reject(new PilotTransportError('rpc_error', String(message.error.message ?? 'rpc error'), { rpc: message.error }))
      else waiter.resolve(message.result)
      return
    }
    // A server-to-client request carries both; a notification carries only a method.
    if (hasMethod && hasId) {
      this.#incomingRequests.push({ id: message.id, method: message.method, params: message.params })
      return
    }
    if (hasMethod) {
      this.#notifications.push({ method: message.method, params: message.params })
    }
  }

  #onExit(code, signal, error) {
    if (this.#closed) return
    this.#closed = true
    const detail = { code, signal, ...(error ? { error: String(error.message ?? error) } : {}) }
    for (const [, waiter] of this.#open) {
      clearTimeout(waiter.timer)
      waiter.reject(new PilotTransportError('process_exited', `the app-server exited during ${waiter.method}`, detail))
    }
    this.#open.clear()
  }

  /** Write one request and await its reply. Records the method for the billing audit. */
  #request(method, params) {
    if (this.#closed) return Promise.reject(new PilotTransportError('process_exited', 'the transport is closed'))
    const id = `pa-${this.#nextId++}`
    this.#sentMethods.push(method)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#open.delete(id)
        reject(new PilotTransportError('request_timeout', `${method} timed out after ${this.requestTimeoutMs}ms`, { method }))
      }, this.requestTimeoutMs)
      this.#open.set(id, { resolve, reject, timer, method })
      try {
        this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`)
      } catch (writeError) {
        clearTimeout(timer)
        this.#open.delete(id)
        reject(new PilotTransportError('write_failed', `could not write ${method}`, { cause: String(writeError) }))
      }
    })
  }

  /**
   * Call any NON-BILLING protocol method.
   *
   * This exists so a caller can reach protocol verbs the named helpers do not wrap (for example
   * `thread/goal/set` when testing whether a real token budget exists) without opening a second
   * code path to the billing method. `turn/start` is refused here; the only way to send a turn is
   * `startTurn`, which enforces the reservation hook.
   */
  async call(method, params) {
    if (typeof method !== 'string' || method.length === 0) {
      throw new PilotTransportError('invalid_method', 'call() needs a method name')
    }
    if (method === BILLING_METHOD) {
      throw new PilotTransportError(
        'billing_method_refused',
        'call() refuses turn/start; use startTurn() so the reservation hook is enforced',
      )
    }
    return this.#request(method, params)
  }

  // ---------------------------------------------------------------------------------------------
  // Non-billing operations. None of these can start a model turn.
  // ---------------------------------------------------------------------------------------------

  async initialize(clientInfo = { name: 'personal-agent-pilot', title: null, version: '0.0.0' }) {
    return this.#request('initialize', { clientInfo, capabilities: null })
  }

  /**
   * Create a thread. `ephemeral: true` keeps it off disk, which is what a fresh reviewer needs.
   * Creating a thread does not send a model turn.
   */
  async startThread(options = {}) {
    const params = {}
    if (options.ephemeral !== undefined) params.ephemeral = options.ephemeral
    if (options.cwd) params.cwd = options.cwd
    if (options.model) params.model = options.model
    if (options.sandbox) params.sandbox = options.sandbox
    if (options.approvalPolicy) params.approvalPolicy = options.approvalPolicy
    const result = await this.#request('thread/start', params)
    return normalizeThread(result)
  }

  /** Re-open an existing thread by id. Does not send a model turn. */
  async resumeThread(threadId, options = {}) {
    const params = { threadId }
    if (options.ephemeral !== undefined) params.ephemeral = options.ephemeral
    if (options.cwd) params.cwd = options.cwd
    const result = await this.#request('thread/resume', params)
    return normalizeThread(result)
  }

  /** Branch a thread, optionally at an inclusive cut turn. Does not send a model turn. */
  async forkThread(threadId, options = {}) {
    const params = { threadId }
    if (options.lastTurnId) params.lastTurnId = options.lastTurnId
    if (options.ephemeral !== undefined) params.ephemeral = options.ephemeral
    if (options.cwd) params.cwd = options.cwd
    const result = await this.#request('thread/fork', params)
    return normalizeThread(result)
  }

  /** Read a thread. This is how a checkpoint and a reconciliation are taken, without sending. */
  async readThread(threadId, options = {}) {
    const params = { threadId }
    if (options.excludeTurns) params.excludeTurns = true
    const result = await this.#request('thread/read', params)
    return normalizeThread(result)
  }

  // ---------------------------------------------------------------------------------------------
  // The billing operation.
  // ---------------------------------------------------------------------------------------------

  /**
   * Start one model turn. THIS IS THE ONLY CALL THAT CAN SPEND MONEY.
   *
   * A reservation hook is mandatory. It is invoked BEFORE the request is written, so an admitted
   * send always has a durable record even if the process dies immediately afterwards.
   *
   * @param {object} options
   * @param {string} options.threadId
   * @param {unknown} options.input      the turn input (text/items), passed through unchanged
   * @param {object} options.hook        the E-owned reservation hook
   * @param {object} options.identity    { caseId, arm, turn, materialDigest, bound }
   */
  async startTurn({ threadId, input, hook, identity }) {
    if (!threadId) throw new PilotTransportError('thread_required', 'a turn needs an existing thread id')
    if (!hook || typeof hook.reserve !== 'function') {
      // Fail closed, before any bytes reach the wire. This includes the author arm: a turn is a
      // turn, and the absence of a "review" label does not make it free.
      throw new PilotTransportError('no_reservation_hook', 'turn/start requires a reservation hook; refusing to send')
    }
    if (!identity || !identity.caseId || !identity.arm) {
      throw new PilotTransportError('identity_required', 'turn/start requires caseId and arm identity for reconciliation')
    }

    let verdict
    try {
      verdict = hook.reserve({ ...identity, threadId })
    } catch (error) {
      throw new PilotTransportError('reservation_failed', 'the reservation hook threw; refusing to send', { cause: String(error) })
    }
    if (!verdict || verdict.admitted !== true) {
      throw new PilotTransportError('reservation_refused', verdict?.reason ?? 'the reservation hook refused this turn', { identity })
    }

    // The reservation is durable and identifies this exact send. From here on the send is
    // accountable even if we never observe its outcome.
    const sendIntent = {
      reservationId: verdict.reservationId ?? null,
      threadId,
      identity,
      inputDigest: sha256(JSON.stringify(input ?? null)),
      method: BILLING_METHOD,
    }

    const params = { threadId, input }
    try {
      const result = await this.#request('turn/start', params)
      return { ok: true, sendIntent, result: normalizeTurn(result) }
    } catch (error) {
      // The write may or may not have reached the model. Report it as uncertain with the SAME
      // intent, so the caller reconciles instead of re-sending under a new id.
      throw new PilotTransportError('send_unknown', `turn/start outcome unknown: ${error.message}`, {
        sendIntent,
        cause: error.reason ?? 'unknown',
      })
    }
  }

  /** Stop the running turn. Does not create a new turn. */
  async interruptTurn({ threadId, turnId }) {
    const params = { threadId }
    if (turnId) params.turnId = turnId
    return this.#request('turn/interrupt', params)
  }

  // ---------------------------------------------------------------------------------------------
  // Reconciliation by original identity.
  // ---------------------------------------------------------------------------------------------

  /**
   * Reconcile a send that may or may not have happened, by re-reading the ORIGINAL thread.
   *
   * This never sends a turn. It answers "what actually exists on the thread I already named".
   * The caller decides whether to resume, cancel or abandon - it must not re-send under a new id.
   */
  async reconcile({ threadId, turnId, sendIntent }) {
    if (!threadId) throw new PilotTransportError('thread_required', 'reconciliation needs the original thread id')
    const thread = await this.readThread(threadId)
    const turns = thread.turns ?? []
    const matched = turnId ? turns.find(turn => turn.id === turnId) : turns[turns.length - 1]
    return {
      threadId,
      observedTurnCount: turns.length,
      matchedTurnId: matched?.id ?? null,
      matchedStatus: matched?.status ?? null,
      // A turn that exists on the original thread means the send landed; absence is not proof it
      // did not, only that this thread shows no turn yet.
      sendObserved: Boolean(matched),
      sendIntentDigest: sendIntent?.inputDigest ? sha256(JSON.stringify([sendIntent.threadId, sendIntent.inputDigest])) : null,
      recommendation: matched
        ? 'inspect the observed turn; do not re-send the same input under a new id'
        : 'no turn is visible on the original thread; treat the send as unknown and reconcile with the provider before any retry',
    }
  }

  /** Usage reported for a thread, from notifications only. Arrives after a turn ran. */
  usageFromNotifications() {
    const updates = this.#notifications.filter(item => item.method === 'thread/tokenUsage/updated')
    const last = updates[updates.length - 1]
    return last ? last.params : null
  }

  /** Turns seen as completed via notification. */
  completedTurns() {
    return this.#notifications
      .filter(item => item.method === 'turn/completed')
      .map(item => item.params)
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#child?.stdin?.end()
    } catch {}
    try {
      this.#child?.kill('SIGKILL')
    } catch {}
    // Give the OS a moment, but never hang on an already-dead child.
    await new Promise(resolve => {
      if (!this.#child || this.#child.exitCode !== null || this.#child.signalCode !== null) return resolve()
      const timer = setTimeout(resolve, 2000)
      this.#child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

function normalizeThread(result) {
  const thread = result?.thread ?? result ?? {}
  return {
    id: thread.id ?? thread.threadId ?? null,
    model: result?.model ?? thread.model ?? null,
    modelProvider: result?.modelProvider ?? thread.modelProvider ?? null,
    turns: Array.isArray(thread.turns) ? thread.turns : [],
    raw: result,
  }
}

function normalizeTurn(result) {
  const turn = result?.turn ?? result ?? {}
  return {
    id: turn.id ?? turn.turnId ?? null,
    status: turn.status ?? null,
    raw: result,
  }
}

export { sha256 }
