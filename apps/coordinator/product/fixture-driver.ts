import { fileURLToPath } from 'node:url'
import { key } from '@personal-agent/orchestrator-core'
import {
  ExecutionInputSchema,
  NativeAnswerPayloadSchema,
  NativeQuestionBindingSchema,
  WireRequestIdSchema,
  parseRuntimeFactPayload,
} from '@personal-agent/contracts'
import type {
  AgentDriverV1,
  AttemptIO,
  AttemptSpec,
  ContractRevision,
  Json,
  NativeQuestionBinding,
  RuntimeFactKind,
  ServeExit,
} from '@personal-agent/contracts'
import { criticalFact, factIdFor, JsonLineDecoder, encodeFrame } from '../../../packages/driver-kit/src/index.ts'

export const FIXTURE_AGENT = fileURLToPath(new URL('./fixture-agent.ts', import.meta.url))
/** Development-only protocol adapter. It executes one fixed scratch operation, never vendor tools or user text. */
export class ProductFixtureDriver implements AgentDriverV1 {
  private readonly contract: ContractRevision
  private readonly preparedPolicyRef: string
  private readonly mode: string
  private readonly beforeAnswerWrite: (id: string) => void
  constructor(
    contract: ContractRevision,
    preparedPolicyRef: string,
    mode: string,
    beforeAnswerWrite: (id: string) => void,
  ) {
    this.contract = contract
    this.preparedPolicyRef = preparedPolicyRef
    this.mode = mode
    this.beforeAnswerWrite = beforeAnswerWrite
  }
  async inspect(): Promise<never> {
    throw new Error('The controlled product fixture is not a vendor capability probe')
  }
  async reconcile(): Promise<never> {
    throw new Error('Independent Runner reconnect is a separate acceptance lane')
  }
  async serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit> {
    const process = await io.runtime.spawn({
      executable: spec.profile.executable,
      argv: [FIXTURE_AGENT, '--mode', this.mode],
      cwdRef: spec.workspaceRef,
      environmentRef: spec.attemptId,
    })
    void (async () => {
      for await (const _chunk of process.stderr) {
      }
    })().catch(() => undefined)
    let seq = 0,
      closed = false,
      began = false,
      tail = Promise.resolve()
    let resolveExit!: (value: ServeExit) => void
    const exit = new Promise<ServeExit>((resolve) => {
      resolveExit = resolve
    })
    const finish = (reason: ServeExit['reason']) => {
      if (!closed) {
        closed = true
        resolveExit({ reason, evidenceRefs: ['controlled-product-fixture'] })
      }
    }
    const targets = new Map<string, NativeQuestionBinding>()
    const record = (kind: RuntimeFactKind, value: unknown) => {
      const fact = criticalFact(spec, {
        factId: factIdFor(spec.attemptId, ++seq),
        source: 'controlled-product-fixture',
        kind,
        payloadRef: 'pending',
      })
      const payload = parseRuntimeFactPayload(fact, { kind, value })
      const work = tail.then(async () => {
        const ref = await io.payloads.store(JSON.parse(JSON.stringify(payload)) as Json, 'critical')
        await io.record({ ...fact, payloadRef: ref })
      })
      tail = work
      return work
    }
    const dispatch = (commandId: string, delivery: 'written' | 'native_accepted', evidence: string) =>
      record('dispatch.observed', { commandId, delivery, retry: 'reconcile_first', evidenceRefs: [evidence] })
    const controls = (async () => {
      for await (const command of io.commands) {
        if (closed) break
        if (command.kind === 'begin') {
          if (began || command.preparedPolicyRef !== this.preparedPolicyRef)
            throw new Error('Fixture begin requires the current prepared policy exactly once')
          began = true
          const input = ExecutionInputSchema.parse(await io.payloads.read(command.inputRef))
          await io.runtime.write(process.resourceRef, encodeFrame({ type: 'begin', id: command.id, text: input.text }))
          void dispatch(command.id, 'written', 'fixture-begin-written').catch(() => finish('error'))
        } else if (command.kind === 'answer') {
          const binding = NativeQuestionBindingSchema.parse(await io.payloads.read(command.nativeBindingRef))
          const answer = NativeAnswerPayloadSchema.parse(await io.payloads.read(command.answerRef))
          if (
            JSON.stringify(binding) !== JSON.stringify(answer.nativeBinding) ||
            JSON.stringify(targets.get(binding.id)) !== JSON.stringify(binding)
          )
            throw new Error('Unknown controlled native question binding')
          this.beforeAnswerWrite(command.id)
          await io.runtime.write(
            process.resourceRef,
            encodeFrame({
              type: 'answer',
              id: command.id,
              answerId: answer.answerId,
              targetBindingId: binding.id,
              nativeRequestId: binding.nativeRequestId,
              answer: answer.answer,
            }),
          )
          void dispatch(command.id, 'written', 'fixture-answer-written').catch(() => finish('error'))
        } else if (command.kind === 'deliver') {
          const input = ExecutionInputSchema.parse(await io.payloads.read(command.inputRef))
          await io.runtime.write(
            process.resourceRef,
            encodeFrame({ type: 'deliver', id: command.id, text: input.text }),
          )
          void dispatch(command.id, 'written', 'fixture-input-written').catch(() => finish('error'))
        } else if (command.kind === 'cancel')
          await io.runtime.write(process.resourceRef, encodeFrame({ type: 'cancel', id: command.id }))
      }
    })()
    void controls.catch(() => finish('error'))
    const decoder = new JsonLineDecoder({ maxFrameBytes: 128 * 1024, maxBufferedBytes: 256 * 1024 })
    const reading = (async () => {
      for await (const bytes of process.stdout) {
        for (const item of decoder.push(bytes)) {
          const frame = item.value as Record<string, unknown>
          if (frame.type === 'input_read')
            await dispatch(String(frame.commandId), 'native_accepted', 'fixture-input-read')
          if (frame.type === 'question') {
            const requestId = WireRequestIdSchema.parse(frame.requestId),
              id = key('fixture-question', spec.attemptId, JSON.stringify(requestId))
            const raw = await io.payloads.store(frame as Json, 'critical')
            const target = NativeQuestionBindingSchema.parse({
              id: key('fixture-target', id),
              ticketId: spec.ticketId,
              assignmentId: spec.assignmentId,
              attemptId: spec.attemptId,
              fenceEpoch: spec.fenceEpoch,
              contract: spec.contract,
              connectionEpoch: 1,
              nativeRequestId: requestId,
              nativeMethod: 'fixture/approve',
              provenanceRef: raw,
            })
            targets.set(target.id, target)
            await record('question.opened', {
              id,
              version: 1,
              kind: 'permission',
              contract: spec.contract,
              scope: this.contract.scope,
              prompt: String(frame.prompt),
              nativePayloadRef: raw,
              presentation: {
                kind: 'choices',
                multiple: false,
                options: [
                  { id: 'allow', label: 'Allow once', semantic: 'allow_once' },
                  { id: 'deny', label: 'Deny', semantic: 'deny' },
                ],
              },
              targets: [target],
              openedAt: new Date().toISOString(),
              validity: 'open',
            })
          }
          if (frame.type === 'answer_applied') {
            const target = targets.get(String(frame.targetBindingId))
            if (!target || JSON.stringify(target.nativeRequestId) !== JSON.stringify(frame.requestId))
              throw new Error('Wrong native response observation')
            const raw = await io.payloads.store(frame as Json, 'critical')
            await record('answer.observed', {
              answerId: String(frame.answerId),
              targetBindingId: target.id,
              status: 'native_applied',
              evidenceRefs: [raw],
            })
          }
          if (frame.type === 'cancel_observed')
            await record('cancel.observed', {
              dispatch: {
                commandId: String(frame.commandId),
                delivery: 'native_accepted',
                retry: 'none',
                evidenceRefs: ['fixture-cancel'],
              },
              acknowledged: true,
              evidenceRefs: ['fixture-cancel'],
            })
          if (frame.type === 'turn_ended') {
            await record('turn.ended', {
              nativeTurnRef: String(frame.nativeTurnRef),
              outcome: frame.outcome === 'completed' ? 'completed' : 'cancelled',
              candidateAvailable: frame.candidateAvailable === true,
              evidenceRefs: ['fixture-turn'],
            })
            finish(frame.outcome === 'completed' ? 'terminal' : 'cancelled')
          }
          if (frame.type === 'fatal') throw new Error('Controlled native protocol failed')
        }
      }
      decoder.end()
      if (!closed) finish('disconnected')
    })()
    void reading.catch(() => finish('error'))
    try {
      const result = await exit
      await tail
      return result
    } finally {
      await io.runtime.stopOwned(process.resourceRef, 1000)
      await reading.catch(() => undefined)
    }
  }
}
