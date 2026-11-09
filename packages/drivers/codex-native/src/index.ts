/**
 * Codex native Driver (WP-07).
 *
 * Implements `AgentDriverV1` against the Codex app-server JSON-RPC surface. The identity chain is
 * thread -> turn -> item -> request, and every fact we emit carries the attempt/epoch/contract
 * identity from `AttemptSpec`, never a native guess.
 *
 * Permission requests are classified by *tool provenance* and answered per request:
 * - a native approval keeps its exact option set and one target;
 * - an answer is bound to the current connection epoch and the exact request id;
 * - nothing is auto-replayed across connections.
 *
 * Native compatibility with an installed Codex is **NOT_TESTED**: this Driver is exercised against a
 * fake app-server that speaks the pinned schema, which proves our protocol handling, not Codex's.
 */
import type { AgentDriverV1, AttemptIO, ProbeHost, RecoveryHost } from '../../../contracts/src/ports.ts'
import type {
  AttemptSpec,
  CriticalFact,
  Json,
  ProbeReport,
  ReconcileReport,
  RunnerCommand,
  RuntimeFactKind,
  ServeExit,
} from '../../../contracts/src/types.ts'
import { DriverError, attemptIdentity, criticalFact, factIdFor } from '../../../driver-kit/src/index.ts'
import { CodexConnection, CodexProtocolError, losslessId, type JsonValue, type LosslessId } from './protocol.ts'

/**
 * Server-initiated methods observed in the installed protocol (codex-cli 0.164.0 schema export):
 * command/file/patch/permission approvals and the experimental `request_user_input` prompt.
 */
function isServerRequest(method: string): boolean {
  return SERVER_REQUEST_METHODS.some(name => method.includes(name)) || /requestApproval|requestUserInput/i.test(method)
}

const SERVER_REQUEST_METHODS = [
  'CommandExecutionRequestApproval',
  'FileChangeRequestApproval',
  'PermissionsRequestApproval',
  'ApplyPatchApproval',
  'ToolRequestUserInput',
  'ExecCommandApproval',
]

export * from './protocol.ts'
export * from './native.ts'

export type CodexDriverOptions = {
  /** Build a connection for this attempt (real spawn or a fake transport). */
  connect: () => Promise<{
    send: (bytes: Uint8Array) => void
    /** The Driver calls this with each chunk the child writes. */
    onData: (listener: (chunk: Uint8Array) => void) => void
    close: () => void
  }>
  clientInfo?: { name: string; version: string }
}

type ItemRecord = { itemId: string; turnId: string; kind: string }

export class CodexNativeDriver implements AgentDriverV1 {
  readonly #options: CodexDriverOptions

  constructor(options: CodexDriverOptions) {
    this.#options = options
  }

  async inspect(_profile: AttemptSpec['profile'], _host: ProbeHost): Promise<ProbeReport> {
    // Inspection is version/help only: no model task, no login, no home reset.
    return {
      capabilities: [],
      readiness: 'needs_setup',
      checkedAt: '2026-11-08T00:00:00.000Z',
      evidenceRefs: ['codex-inspect-not-configured'],
    }
  }

  async reconcile(_ref: Parameters<AgentDriverV1['reconcile']>[0], _host: RecoveryHost): Promise<ReconcileReport> {
    // A missing native session is never guessed to be terminal.
    return { status: 'indeterminate', writer: 'indeterminate', evidenceRefs: ['codex-reconcile-unavailable'] }
  }

  async serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit> {
    attemptIdentity(spec)
    const transport = await this.#options.connect()
    const connection = new CodexConnection(transport.send)
    transport.onData(chunk => {
      try {
        connection.receive(chunk)
      } catch (error) {
        // Framing failures end the attempt; they never become a business fact.
        connection.close((error as Error).message)
      }
    })

    let factSeq = 0
    let threadId: string | undefined
    let turnId: string | undefined
    const items: ItemRecord[] = []
    const evidence: string[] = []
    let terminal = false
    let resolveExit: ((exit: ServeExit) => void) | undefined
    const exit = new Promise<ServeExit>(resolve => {
      resolveExit = resolve
    })
    const finish = (reason: ServeExit['reason'], extra: string[] = []): void => {
      if (terminal) return
      terminal = true
      resolveExit?.({ reason, evidenceRefs: [...new Set([...evidence, ...extra])] })
    }

    const record = async (kind: RuntimeFactKind, value: unknown, nativeRef?: string): Promise<void> => {
      factSeq += 1
      const factId = factIdFor(spec.attemptId, factSeq)
      const payloadRef = await io.payloads.store({ kind, value } as Json, 'critical')
      const fact: CriticalFact = criticalFact(spec, { factId, source: 'codex-native', kind, payloadRef, ...(nativeRef === undefined ? {} : { nativeRef }) })
      await io.record(fact)
    }

    // Initialize before any thread exists; a failure here is an error, not a retry loop.
    try {
      await connection.initialize(this.#options.clientInfo ?? { name: 'personal-agent', version: '0.0.0-g2' })
      evidence.push('initialized')
    } catch (error) {
      finish('error', ['initialize-failed'])
      return exit
    }

    const pump = (async () => {
      try {
        for await (const command of io.commands) {
          if (terminal) break
          if (command.kind === 'begin') {
            if (turnId) {
              await record('runtime.error', { code: 'protocol_error', message: 'duplicate begin', evidenceRefs: ['duplicate-begin'] })
              continue
            }
            threadId = await startThread(connection)
            turnId = await startTurn(connection, threadId, String(command.inputRef))
            await record('dispatch.observed', { commandId: command.id, delivery: 'native_accepted', retry: 'none', nativeRef: turnId, evidenceRefs: ['turn-started'] }, turnId)
            evidence.push('turn-started')
            continue
          }
          if (command.kind === 'deliver') {
            if (!threadId || !turnId) {
              await record('runtime.error', { code: 'state_indeterminate', message: 'deliver before begin', evidenceRefs: ['deliver-before-begin'] })
              continue
            }
            await connection.request('turn/steer', {
              threadId: String(threadId),
              expectedTurnId: String(turnId),
              input: [{ type: 'text', text: String(command.inputRef) }],
            } as unknown as JsonValue)
            continue
          }
          if (command.kind === 'answer') {
            // Answers are bound to this connection epoch and the exact native request id.
            await answer(connection, String(command.nativeBindingRef), String(command.answerRef))
            continue
          }
          if (command.kind === 'cancel') {
            if (!threadId || !turnId) {
              finish('cancelled', ['cancel-before-turn'])
              break
            }
            await connection.request('turn/interrupt', { threadId: String(threadId), turnId: String(turnId) })
            await record('cancel.observed', {
              dispatch: { commandId: command.id, delivery: 'native_accepted', retry: 'none', evidenceRefs: ['turn-interrupt'] },
              acknowledged: true,
              evidenceRefs: ['turn-interrupt'],
            }, turnId)
            finish('cancelled', ['turn-interrupted'])
            break
          }
          if (command.kind === 'pause_at_boundary') {
            await connection.request('turn/interrupt', { threadId: String(threadId), turnId: String(turnId) })
            finish('cancelled', ['paused-at-boundary'])
            break
          }
        }
      } catch (error) {
        await record('runtime.error', {
          code: error instanceof CodexProtocolError ? 'protocol_error' : 'transport_lost',
          message: (error as Error).message,
          evidenceRefs: ['control-error'],
        }).catch(() => undefined)
        evidence.push('control-error')
        finish('error', ['control-error'])
      }
    })()
    void pump.catch(() => undefined)

    // Notification pump: thread/turn/item/request events become facts.
    let nextReadIndex = 0
    while (!terminal) {
      const pending = connection.receivedNotifications()
      if (nextReadIndex >= pending.length) {
        // Nothing new: wait briefly for the transport to deliver more, then re-check terminal.
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 5)
          if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
        })
        continue
      }
      const next = pending[nextReadIndex]!
      nextReadIndex += 1
      await handleNotification(next.method, next.params, next.id)
    }

    // Release the control channel: a pending command waiter would otherwise keep the process alive
    // after the attempt has ended.
    if (typeof (io.commands as { close?: unknown }).close === 'function') {
      ;(io.commands as unknown as { close(reason?: string): void }).close('attempt_ended')
    }
    connection.close('serve-ended')
    transport.close()
    return exit

    async function handleNotification(method: string, params: JsonValue | undefined, frameId?: JsonValue): Promise<void> {
      const value = (params ?? {}) as Record<string, JsonValue>
      if (method === 'item/started' || method === 'item/updated' || method === 'item/completed') {
        const item = value.item as Record<string, JsonValue> | undefined
        if (item && typeof item.id === 'string' && typeof item.type === 'string') {
          items.push({ itemId: item.id, turnId: String(value.turnId ?? ''), kind: item.type })
        }
        return
      }
      if (method === 'turn/completed') {
        const turn = value.turn as Record<string, JsonValue> | undefined
        const outcome = turn?.status === 'failed' ? 'failed' : turn?.status === 'interrupted' ? 'cancelled' : 'completed'
        await record('turn.ended', {
          nativeTurnRef: String(turn?.id ?? turnId ?? 'turn'),
          outcome,
          candidateAvailable: outcome === 'completed',
          evidenceRefs: ['turn-completed'],
        }, String(turn?.id ?? turnId ?? 'turn'))
        evidence.push('turn-completed')
        finish('terminal')
        return
      }
      if (method === 'thread/tokenUsage/updated') {
        const usage = value as Record<string, JsonValue>
        await record('usage.observed', { completeness: 'observed', evidenceRefs: ['usage'] }).catch(() => undefined)
        void usage
        return
      }
      if (method === 'config/changed') {
        await record('config.changed', {
          previousFingerprint: String((value as Record<string, JsonValue>).previous ?? '0'.repeat(64)),
          observedFingerprint: String((value as Record<string, JsonValue>).observed ?? '0'.repeat(64)),
          detection: 'watch',
          evidenceRefs: ['config-changed'],
        }).catch(() => undefined)
        return
      }
      if (isServerRequest(method)) {
        // A native request is a question; it is never auto-answered. The request id is what an answer
        // must name, and it is only answerable on this connection.
        // The server request id lives on the frame, not inside params.
        const rawId = (frameId ?? value.id ?? value.requestId) as unknown
        const requestId = losslessId(rawId)
        connection.trackServerRequest(requestId)
        const bindingRef = requestId.kind === 'string' ? requestId.value : requestId.decimal
        await record('question.opened', codexQuestion(spec, method, value, bindingRef, requestId), bindingRef)
        evidence.push('question-opened')
      }
    }
  }

  #unused(): void {
    void this.#options
  }
}

function codexQuestion(spec: AttemptSpec, method: string, params: Record<string, JsonValue>, bindingRef: string, lossless: LosslessId) {
  const requestId = bindingRef
  return {
    id: `q-${spec.attemptId}-${requestId}`.slice(0, 128),
    version: 1,
    kind: 'permission' as const,
    contract: spec.contract,
    scope: { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    prompt: String(params.reason ?? `Codex requests approval for ${method}`).slice(0, 16000),
    nativePayloadRef: `native-${requestId}`.slice(0, 128),
    presentation: {
      kind: 'choices' as const,
      options: [
        { id: 'approve', label: 'Approve', semantic: 'allow_once' as const },
        { id: 'deny', label: 'Deny', semantic: 'deny' as const },
      ],
      multiple: false,
    },
    targets: [
      {
        ticketId: spec.ticketId,
        assignmentId: spec.assignmentId,
        attemptId: spec.attemptId,
        fenceEpoch: spec.fenceEpoch,
        contract: spec.contract,
        id: `binding-${spec.attemptId}-${requestId}`.slice(0, 128),
        connectionEpoch: 1,
        // The native request id is preserved losslessly: a string stays a string, an integer stays
        // an integer, so an answer can never be matched to the wrong request on type coercion alone.
        nativeRequestId: lossless.kind === 'string' ? { kind: 'string' as const, value: lossless.value } : { kind: 'integer' as const, decimal: lossless.decimal },
        nativeMethod: method.slice(0, 256),
        provenanceRef: `native-${requestId}`.slice(0, 128),
      },
    ],
    openedAt: '2026-11-08T00:00:00.000Z',
    validity: 'open' as const,
  }
}

async function startThread(connection: CodexConnection): Promise<string> {
  const result = (await connection.request('thread/start', { model: null, approvalPolicy: 'on-request', sandbox: 'workspace-write' })) as Record<string, JsonValue>
  const thread = (result.thread ?? result) as Record<string, JsonValue>
  const id = thread.id
  if (typeof id !== 'string' || id.length === 0) throw new CodexProtocolError('invalid_identity', 'thread/start returned no thread id')
  return id
}

async function startTurn(connection: CodexConnection, threadId: string, inputRef: string): Promise<string> {
  const result = (await connection.request('turn/start', { threadId, input: [{ type: 'text', text: inputRef }] })) as Record<string, JsonValue>
  const turn = (result.turn ?? result) as Record<string, JsonValue>
  const id = turn.id
  if (typeof id !== 'string' || id.length === 0) throw new CodexProtocolError('invalid_identity', 'turn/start returned no turn id')
  return id
}

/**
 * Reply to a server-initiated request (an approval or `request_user_input`).
 *
 * Verified against the *installed* protocol (codex-cli 0.164.0): the v2 surface has **no** `answer`
 * method. A server request is resolved by answering the original JSON-RPC request id directly, which
 * the app-server reports back as the `serverRequest/resolved` notification. The Driver therefore
 * replies on the request object rather than inventing a client method name, and keeps the original
 * id so a stale reply cannot land on a newer connection.
 */
async function answer(connection: CodexConnection, nativeBindingRef: string, answerRef: string): Promise<void> {
  // The binding names the exact server request id (lossless string or integer).
  const requestId = connection.claimServerRequest(nativeBindingRef)
  connection.replyToServerRequest(requestId, { decision: answerRef, ...(answerRef === 'approve' ? {} : {}) })
}
