import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { serveRunner } from '../../../apps/runner/src/runner-service.ts'
import { ProcessHost } from '../../../apps/runner/src/process-host.ts'
import { CodexProductDriver } from '../../../packages/drivers/codex-native/src/native.ts'
import { encodeFrame, JsonLineDecoder } from '../../../packages/driver-kit/src/index.ts'
import type { NativeRunnerLinkFactory } from '../../../apps/coordinator/product/native-attempt.ts'

/** Virtual resource only: production Driver/service run, but no OS process, sandbox or vendor. */
class ControlledProtocolHost extends ProcessHost {
  private readonly output = new PassThrough()
  private readonly errors = new PassThrough()
  private closed = false
  private finished = false
  private cwd = ''
  private readonly decoder = new JsonLineDecoder({ maxFrameBytes: 1048576, maxBufferedBytes: 2097152 })
  private resolveExit!: (value: { code: number; signal: null }) => void
  private readonly exited = new Promise<{ code: number; signal: null }>(resolve => { this.resolveExit = resolve })
  private readonly trace: CallbackTrace
  constructor(trace: CallbackTrace) { super(); this.trace = trace }
  override closeAdmission() { this.closed = true; super.closeAdmission() }
  override resources() { return this.finished ? [] : ['controlled-protocol-resource'] }
  override inventory() {
    return [{ ref: 'controlled-protocol-resource', ownership: 'spawned_process' as const,
      writer: this.finished ? 'quiescent' as const : 'active' as const,
      evidence: [this.finished ? 'virtual-resource-closed-not-os-proof' : 'virtual-resource-not-os-process'] }]
  }
  override async spawn() {
    this.trace.virtualResources++
    return { resourceRef: 'controlled-protocol-resource', identity: { pid: -1, groupId: -1, nonce: 'virtual', executable: 'virtual', argv: [], startMarker: null, spawnedAt: 0 },
      stdout: this.output, stderr: this.errors, exited: this.exited, write: (bytes: Uint8Array) => this.write('controlled-protocol-resource', bytes), closeOutput: () => {} }
  }
  private emit(value: unknown) { this.output.write(Buffer.from(JSON.stringify(value) + '\n')) }
  override async write(_ref: string, bytes: Uint8Array) {
    if (this.closed || this.finished) throw new Error('Controlled resource is closed')
    for (const decoded of this.decoder.push(bytes)) {
      const message = decoded.value as { id?: number; method?: string; params?: Record<string, any>; result?: Record<string, any> }
      this.trace.protocolMethods.push(message.method ?? 'server-reply')
      if (message.method === 'initialize') this.emit({ id: message.id, result: {} })
      else if (message.method === 'thread/start') {
        this.cwd = String(message.params!.cwd)
        this.emit({ id: message.id, result: { thread: { id: 'controlled-thread' }, cwd: this.cwd,
          approvalPolicy: 'on-request', model: 'controlled-model', sandbox: { type: 'workspaceWrite', networkAccess: false,
            writableRoots: [], excludeSlashTmp: true, excludeTmpdirEnvVar: true } } })
      } else if (message.method === 'turn/start') {
        this.emit({ id: message.id, result: { turn: { id: 'controlled-turn' } } })
        this.emit({ id: 42, method: 'item/tool/requestUserInput', params: { threadId: 'controlled-thread', turnId: 'controlled-turn',
          itemId: 'controlled-item', questions: [{ id: 'choice', header: 'Output', question: 'Choose output', options: [{ label: 'Alpha' }, { label: 'Beta' }] }] } })
      } else if (!message.method && message.id === 42 && message.result) {
        const selected = message.result.answers?.choice?.answers?.[0]
        if (selected !== 'Beta') throw new Error('Original native answer was not preserved')
        this.trace.nativeEffects++
        mkdirSync(join(this.cwd, 'src'), { recursive: true })
        writeFileSync(join(this.cwd, 'src/controlled-output.txt'), 'Beta\n')
        this.emit({ method: 'serverRequest/resolved', params: { threadId: 'controlled-thread', requestId: 42 } })
        this.emit({ method: 'turn/completed', params: { threadId: 'controlled-thread', turn: { id: 'controlled-turn', status: 'completed' } } })
      } else if (message.method === 'turn/interrupt') {
        this.emit({ id: message.id, result: {} })
        this.emit({ method: 'turn/completed', params: { threadId: 'controlled-thread', turn: { id: 'controlled-turn', status: 'interrupted' } } })
      }
    }
  }
  override async stopOwned() {
    if (!this.finished) { this.finished = true; this.output.end(); this.errors.end(); this.resolveExit({ code: 0, signal: null }) }
    return { quiescence: 'confirmed' as const, evidenceRefs: ['virtual-resource-closed-not-os-proof'] }
  }
  override async stopAll() { return this.stopOwned() }
}

export type CallbackTrace = {
  virtualResources: number; nativeEffects: number; stdioFacts: string[]; stdioPayloads: number; stdioGuards: number;
  protocolMethods: string[]; errors: string[]; closers: (() => Promise<void>)[]
}
export function nativeCallbackLink(trace: CallbackTrace): NativeRunnerLinkFactory {
  return options => ({
    async spawnAttempt(spec, sink) {
      const input = new PassThrough(), receipts: any[] = [], progress: string[] = []
      const host = new ControlledProtocolHost(trace)
      let resolveReady!: () => void, rejectReady!: (error: Error) => void, resolveExit!: (frame: any) => void
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
      const exited = new Promise<any>(resolve => { resolveExit = resolve })
      const send = (frame: Record<string, unknown>) => { input.write(encodeFrame({ v: 1, ...frame })) }
      const service = serveRunner({ input, recoveryRoot: options.env!.PA_RUNNER_RECOVERY_ROOT!, eagerPrepare: true, processHost: host,
        payloads: { read: reference => options.payloads!.read(reference) },
        createDriver: (_spec, hooks) => new CodexProductDriver({ beforeAnswerWrite: hooks.beforeNativeWrite }),
        write: frame => {
          const value = frame as any
          if (value.type === 'ready') resolveReady()
          else if (value.type === 'exited') resolveExit(value)
          else if (value.type === 'receipt') receipts.push(value.receipt)
          else if (value.type === 'fact') {
            trace.stdioFacts.push(value.fact.kind)
            void sink(value.fact).then(receipt => send({ type: 'receipt', id: value.id, factId: value.fact.factId, receipt }))
              .catch(() => send({ type: 'ack-failed', id: value.id, factId: value.fact.factId, reason: 'controlled-sink-failed' }))
          } else if (value.type === 'payload-read') {
            trace.stdioPayloads++
            void options.payloads!.read(value.reference).then(body => send({ type: 'payload', id: value.requestId, requestId: value.requestId, value: body }))
              .catch(rejectReady)
          } else if (value.type === 'native-write-intent') {
            trace.stdioGuards++
            void Promise.resolve().then(() => options.beforeNativeWrite!(value.command)).then(() => send({ type: 'write-admission', id: value.id, allowed: true }))
              .catch(() => send({ type: 'write-admission', id: value.id, allowed: false }))
          } else if (value.type === 'error') { trace.errors.push(String(value.reason)); rejectReady(new Error(String(value.message))) }
        },
      })
      void service.catch(rejectReady)
      send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot: join(options.stateRoot!, 'payloads'),
        journalPath: join(options.stateRoot!, 'critical.journal'), producer: options.producer })
      let closed = false
      const close = async () => {
        if (closed) return
        closed = true; send({ type: 'shutdown', id: 'shutdown' }); input.end()
        const handle = await service; await handle.shutdown(); await host.stopAll()
      }
      trace.closers.push(close)
      await ready
      return { pid: process.pid, stateRoot: options.stateRoot!, journalPath: join(options.stateRoot!, 'critical.journal'), receipts, progress,
        command: async command => { send({ type: 'command', id: command.id, command }) }, waitExit: () => exited,
        close: async () => { await close(); return 0 } }
    },
  })
}
