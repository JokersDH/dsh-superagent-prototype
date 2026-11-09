import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import {
  ExecutionInputSchema,
  JsonSchema,
  NativeAnswerPayloadSchema,
  NativeQuestionBindingSchema,
  PreparedExecutionPolicySchema,
  ScopeSchema,
  RunnerCommandSchema,
  AttemptRefSchema,
  UserQuestionSchema,
  parseQuestionAnswer,
  parseRuntimeFactPayload,
} from '@personal-agent/contracts'
import type {
  AgentDriverV1,
  AttemptIO,
  AttemptSpec,
  Json,
  NativeQuestionBinding,
  RuntimeFactKind,
  RunnerCommand,
  ServeExit,
  UserQuestion,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { attemptIdentity, criticalFact, factIdFor } from '../../../driver-kit/src/index.ts'
import { admitPreparedPolicy } from '../../../policy-preparation/src/index.ts'
import { CodexConnection, idKey, losslessId } from './protocol.ts'
import type { JsonValue, LosslessId } from './protocol.ts'

export const NativeCodexSettingsSchema = z.strictObject({
  kind: z.literal('codex-native-settings/1'),
  workspacePath: z.string().min(1),
  scope: ScopeSchema,
  model: z.string().max(160).optional(),
  approvalPolicy: z.enum(['untrusted', 'on-request']).default('untrusted'),
  timeoutMs: z.number().int().min(1000).max(1800000).default(600000),
})
type Settings = z.infer<typeof NativeCodexSettingsSchema>
type Target = {
  binding: NativeQuestionBinding
  questionId: string
  question?: UserQuestion
  method: string
  params: Record<string, JsonValue>
  answer?: { answerId: string; commandId: string; written: boolean; applied: boolean }
}
const same = (a: unknown, b: unknown) => canonicalDigest(JsonSchema.parse(a)) === canonicalDigest(JsonSchema.parse(b))
const inside = (parent: string, child: string) => {
  const path = relative(parent, resolve(child))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
const identifier = (prefix: string, value: Json) => `${prefix}-${canonicalDigest(value).slice(0, 48)}`

/** Production adapter: Codex owns reasoning/tools; this module binds policy, I/O and native identities. */
export class CodexProductDriver implements AgentDriverV1 {
  private readonly beforeAnswerWrite: (command: RunnerCommand) => Promise<void>
  constructor(options: { beforeAnswerWrite: (command: RunnerCommand) => Promise<void> }) {
    this.beforeAnswerWrite = options.beforeAnswerWrite
  }
  async inspect(): Promise<never> {
    throw new Error('Use the installed executable/catalog probe')
  }
  async reconcile(): Promise<never> {
    throw new Error('Use the authenticated owned-resource endpoint')
  }
  async serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit> {
    const settings = NativeCodexSettingsSchema.parse(await io.payloads.read(spec.policySnapshotRef))
    const workspace = realpathSync(settings.workspacePath)
    settings.workspacePath = workspace
    if (
      !same(settings.scope.allowedPaths, ['.']) ||
      settings.scope.externalActions.length ||
      settings.scope.excludedPaths.some((path) => path !== '.git')
    )
      throw new Error('This native profile requires one complete project worktree and no external actions')
    const child = await io.runtime.spawn({
      executable: spec.profile.executable,
      argv: [...spec.profile.argv],
      cwdRef: spec.workspaceRef,
      environmentRef: spec.attemptId,
    })
    let connection!: CodexConnection,
      writes = Promise.resolve(),
      sequence = 0,
      tail = Promise.resolve()
    let done: ServeExit | undefined,
      threadId = '',
      turnId = '',
      began = false
    const targets = new Map<string, Target>()
    const finish = (reason: ServeExit['reason'], evidence: string) => {
      done ??= { reason, evidenceRefs: [evidence] }
    }
    connection = new CodexConnection((bytes) => {
      writes = writes.then(() => io.runtime.write(child.resourceRef, bytes))
      void writes.catch(() => {
        connection.close('native-write-failed')
        finish('disconnected', 'native-write-failed')
      })
    })
    const reading = (async () => {
      for await (const bytes of child.stdout) connection.receive(bytes)
    })()
    void reading.catch(() => {
      connection.close('native-framing-failed')
      finish('error', 'native-framing-failed')
    })
    void child.exited.then(() => {
      connection.close('native-exited')
      finish('disconnected', 'native-exited')
    })
    void (async () => {
      for await (const _bytes of child.stderr) {
      }
    })().catch(() => undefined)
    const deadline = globalThis.setTimeout(() => {
      connection.close('native-deadline')
      finish('error', 'native-deadline')
      void io.runtime.stopOwned(child.resourceRef, 1500)
    }, settings.timeoutMs)
    const record = (kind: RuntimeFactKind, value: unknown) => {
      const fact = criticalFact(spec, {
        factId: factIdFor(spec.attemptId, ++sequence),
        source: 'codex-native',
        kind,
        payloadRef: 'pending',
      })
      const payload = JsonSchema.parse(parseRuntimeFactPayload(fact, { kind, value }))
      const work = tail.then(async () => {
        const payloadRef = await io.payloads.store(payload, 'critical')
        await io.record({ ...fact, payloadRef })
      })
      tail = work
      return work
    }
    let policyRef = ''
    try {
      await record('writer.observed', {
        resources: [
          {
            resourceRef: child.resourceRef,
            ownership: 'spawned_process',
            status: 'active',
            evidenceRefs: ['owned-codex-process'],
          },
        ],
      })
      await connection.initialize({ name: 'personal_agent', version: '0.1.0' }, { experimentalApi: true })
      const started = (await connection.request('thread/start', {
        cwd: workspace,
        approvalPolicy: settings.approvalPolicy,
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
        ...(settings.model ? { model: settings.model } : {}),
        ephemeral: true,
        config: {
          mcp_servers: {},
          features: { apps: false },
          sandbox_workspace_write: { network_access: false, exclude_slash_tmp: true, exclude_tmpdir_env_var: true },
        },
        developerInstructions:
          'Work only inside the assigned worktree. Do not access accounts, external services or other repositories. Do not change Git metadata, commit, push, merge or deploy. Implement the user requirement and tests. Ask the user when a decision is needed; never invent an answer. Report changes and actual checks.',
      })) as Record<string, JsonValue>
      const sandbox = started.sandbox as Record<string, JsonValue> | undefined
      const nativeThread = started.thread as Record<string, JsonValue> | undefined
      if (
        typeof nativeThread?.id !== 'string' ||
        started.cwd !== workspace ||
        started.approvalPolicy !== settings.approvalPolicy ||
        sandbox?.type !== 'workspaceWrite' ||
        sandbox.networkAccess !== false ||
        sandbox.excludeSlashTmp !== true ||
        sandbox.excludeTmpdirEnvVar !== true ||
        (Array.isArray(sandbox.writableRoots) &&
          sandbox.writableRoots.some((root) => typeof root !== 'string' || !inside(workspace, root)))
      )
        throw new Error('Native policy handshake did not confirm the requested worktree sandbox')
      threadId = nativeThread.id
      const applied = JsonSchema.parse({
        cwd: workspace,
        sandbox,
        approvalPolicy: started.approvalPolicy,
        model: started.model,
      })
      const evidence = await io.payloads.store(applied, 'critical')
      const policy = PreparedExecutionPolicySchema.parse({
        ticketId: spec.ticketId,
        assignmentId: spec.assignmentId,
        attemptId: spec.attemptId,
        fenceEpoch: spec.fenceEpoch,
        contract: spec.contract,
        requestedPolicyRevision: spec.profile.permissionPolicyRevision,
        nativeAppliedSettingsRef: evidence,
        effectiveConfigFingerprint: canonicalDigest(applied),
        enforcement: 'enforced',
        verification: 'passed',
        evidenceRef: evidence,
      })
      // Spec contains profile/lease fields; the policy record carries only the shared attempt identity.
      const cleanPolicy = PreparedExecutionPolicySchema.parse({
        ticketId: spec.ticketId,
        assignmentId: spec.assignmentId,
        attemptId: spec.attemptId,
        fenceEpoch: spec.fenceEpoch,
        contract: spec.contract,
        requestedPolicyRevision: policy.requestedPolicyRevision,
        nativeAppliedSettingsRef: policy.nativeAppliedSettingsRef,
        effectiveConfigFingerprint: policy.effectiveConfigFingerprint,
        enforcement: policy.enforcement,
        verification: policy.verification,
        evidenceRef: policy.evidenceRef,
      })
      policyRef = await io.payloads.store(JsonSchema.parse(cleanPolicy), 'critical')
      await record('policy.prepared', cleanPolicy)
      const controls = (async () => {
        for await (const command of io.commands) {
          if (done) break
          RunnerCommandSchema.parse(command)
          if (
            !same(
              AttemptRefSchema.parse({
                ticketId: command.ticketId,
                assignmentId: command.assignmentId,
                attemptId: command.attemptId,
                fenceEpoch: command.fenceEpoch,
                contract: command.contract,
              }),
              attemptIdentity(spec),
            )
          )
            throw new Error('Native command belongs to another attempt')
          if (command.kind === 'begin') {
            if (
              began ||
              command.preparedPolicyRef !== policyRef ||
              !admitPreparedPolicy(cleanPolicy, spec, {
                profile: spec.profile,
                currentFingerprint: cleanPolicy.effectiveConfigFingerprint,
              }).allowed
            )
              throw new Error('Native begin has no current prepared policy')
            began = true
            const input = ExecutionInputSchema.parse(await io.payloads.read(command.inputRef))
            if (!same(input.contract, spec.contract)) throw new Error('Native input has another contract')
            const result = (await connection.request('turn/start', {
              threadId,
              cwd: workspace,
              input: [{ type: 'text', text: input.text }],
              effort: 'low',
            })) as Record<string, JsonValue>
            const turn = result.turn as Record<string, JsonValue>
            if (typeof turn?.id !== 'string') throw new Error('No native turn identity')
            turnId = turn.id
            await record('dispatch.observed', {
              commandId: command.id,
              delivery: 'native_accepted',
              retry: 'none',
              nativeRef: turnId,
              evidenceRefs: ['codex-turn-start-accepted'],
            })
          } else if (command.kind === 'deliver') {
            const input = ExecutionInputSchema.parse(await io.payloads.read(command.inputRef))
            if (
              !turnId ||
              !same(input.contract, spec.contract) ||
              (command.expectedTurnRef && command.expectedTurnRef !== turnId)
            )
              throw new Error('No matching active native turn')
            await connection.request('turn/steer', {
              threadId,
              expectedTurnId: turnId,
              input: [{ type: 'text', text: input.text }],
            })
            await record('dispatch.observed', {
              commandId: command.id,
              delivery: 'native_accepted',
              retry: 'none',
              evidenceRefs: ['codex-turn-steer-accepted'],
            })
          } else if (command.kind === 'answer') {
            const binding = NativeQuestionBindingSchema.parse(await io.payloads.read(command.nativeBindingRef))
            const answer = NativeAnswerPayloadSchema.parse(await io.payloads.read(command.answerRef))
            const target = targets.get(binding.id)
            if (
              !target ||
              target.answer ||
              !same(target.binding, binding) ||
              !same(answer.nativeBinding, binding) ||
              answer.questionId !== target.questionId ||
              answer.questionVersion !== 1
            )
              throw new Error('Stale native answer binding')
            if (!target.question) throw new Error('Native question is not currently answerable')
            const response = responseFor(target, parseQuestionAnswer(target.question, answer.answer), settings)
            await this.beforeAnswerWrite(command)
            target.answer = { answerId: answer.answerId, commandId: command.id, written: false, applied: false }
            connection.replyToServerRequest(connection.claimServerRequest(binding.nativeRequestId), response)
            await writes
            await record('dispatch.observed', {
              commandId: command.id,
              delivery: 'written',
              retry: 'reconcile_first',
              evidenceRefs: ['codex-answer-written'],
            })
            target.answer.written = true
          } else if (command.kind === 'cancel' || command.kind === 'pause_at_boundary') {
            if (turnId) await connection.request('turn/interrupt', { threadId, turnId })
            if (command.kind === 'cancel')
              await record('cancel.observed', {
                dispatch: {
                  commandId: command.id,
                  delivery: 'native_accepted',
                  retry: 'none',
                  evidenceRefs: ['codex-turn-interrupt'],
                },
                acknowledged: true,
                evidenceRefs: ['codex-turn-interrupt'],
              })
            finish('cancelled', 'codex-turn-interrupted')
          }
        }
      })()
      void controls.catch(() => {
        connection.close('native-control-failed')
        finish('error', 'native-control-failed')
      })
      const pendingEvents: ReturnType<CodexConnection['drainNotifications']> = []
      while (!done) {
        pendingEvents.push(...connection.drainNotifications())
        if (pendingEvents.length > 4096) throw new Error('Native event backlog exceeded its bound')
        while (pendingEvents.length && !done) {
          const event = pendingEvents[0]!
          const params = (event.params ?? {}) as Record<string, JsonValue>
          if (!turnId && (params.turnId !== undefined || event.method === 'turn/completed')) {
            if (!began) throw new Error('Native turn event arrived before begin')
            break
          }
          if (event.method === 'serverRequest/resolved') {
            const request = losslessId(params.requestId ?? params.id)
            const target = [...targets.values()].find((item) => idKey(item.binding.nativeRequestId) === idKey(request))
            if (target?.answer && !target.answer.written) break
          }
          pendingEvents.shift()
          if (params.threadId && params.threadId !== threadId) throw new Error('Native event belongs to another thread')
          if (params.turnId !== undefined && params.turnId !== turnId)
            throw new Error('Native event belongs to another turn')
          if (event.id !== undefined) {
            if (params.threadId !== threadId || params.turnId !== turnId || typeof params.itemId !== 'string')
              throw new Error('Native request has no matching thread/turn/item identity')
            const id = losslessId(event.id)
            connection.trackServerRequest(id)
            const raw = await io.payloads.store(JsonSchema.parse({ method: event.method, params, id }), 'critical')
            const binding = NativeQuestionBindingSchema.parse({
              ticketId: spec.ticketId,
              assignmentId: spec.assignmentId,
              attemptId: spec.attemptId,
              fenceEpoch: spec.fenceEpoch,
              contract: spec.contract,
              id: identifier('codex-target', [spec.attemptId, idKey(id)]),
              connectionEpoch: 1,
              nativeRequestId: id,
              nativeMethod: event.method,
              provenanceRef: raw,
            })
            const questionId = identifier('codex-question', [spec.attemptId, idKey(id)])
            const target: Target = { binding, questionId, method: event.method, params }
            const question = UserQuestionSchema.parse({
              ...questionFor(target, settings),
              id: questionId,
              version: 1,
              contract: spec.contract,
              scope: settings.scope,
              nativePayloadRef: raw,
              targets: [binding],
              openedAt: new Date().toISOString(),
              validity: 'open',
            })
            target.question = question
            targets.set(binding.id, target)
            await record('question.opened', question)
          } else if (event.method === 'serverRequest/resolved') {
            if (params.threadId !== threadId) throw new Error('Native resolution belongs to another thread')
            const request = losslessId(params.requestId ?? params.id)
            const target = [...targets.values()].find((item) => idKey(item.binding.nativeRequestId) === idKey(request))
            if (!target?.answer) throw new Error('Native request resolved without an admitted answer')
            if (!target.answer.applied) {
              await record('answer.observed', {
                answerId: target.answer.answerId,
                targetBindingId: target.binding.id,
                status: 'native_applied',
                evidenceRefs: ['codex-server-request-resolved'],
              })
              target.answer.applied = true
            }
          } else if (event.method === 'turn/completed') {
            if (params.threadId !== threadId) throw new Error('Native terminal event has no matching thread identity')
            const turn = params.turn as Record<string, JsonValue>
            if (turn?.id !== turnId || !['completed', 'failed', 'interrupted'].includes(String(turn.status)))
              throw new Error('Unrecognized native terminal identity')
            const outcome =
              turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'cancelled' : 'failed'
            await record('turn.ended', {
              nativeTurnRef: turnId,
              outcome,
              candidateAvailable: outcome === 'completed',
              evidenceRefs: ['codex-turn-completed'],
            })
            finish(
              outcome === 'completed' ? 'terminal' : outcome === 'cancelled' ? 'cancelled' : 'error',
              'codex-turn-completed',
            )
          } else if (event.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
            io.publishProgress({
              ticketId: spec.ticketId,
              assignmentId: spec.assignmentId,
              attemptId: spec.attemptId,
              fenceEpoch: spec.fenceEpoch,
              contract: spec.contract,
              text: params.delta.slice(0, 8192),
              observedAt: new Date().toISOString(),
            })
          }
        }
        if (connection.state === 'closed' && !done) finish('disconnected', 'native-connection-closed')
        if (!done) await setTimeout(10)
      }
      await tail
      return done
    } catch (error) {
      const detail = String(error)
        .replace(/sk-[A-Za-z0-9_-]+|Bearer\s+\S+/g, '<REDACTED>')
        .slice(0, 1200)
      await record('runtime.error', {
        code: 'protocol_error',
        message: `Native Codex preparation or protocol failed: ${detail}`,
        evidenceRefs: ['codex-native-failure'],
      }).catch(() => undefined)
      return { reason: 'error', evidenceRefs: ['codex-native-failure'] }
    } finally {
      globalThis.clearTimeout(deadline)
      connection.close('native-attempt-ended')
      await io.runtime.stopOwned(child.resourceRef, 1500)
      await reading.catch(() => undefined)
    }
  }
}

function questionFor(target: Target, settings: Settings) {
  const { method, params } = target
  if (method === 'item/tool/requestUserInput') {
    const questions = Array.isArray(params.questions) ? (params.questions as Record<string, JsonValue>[]) : []
    if (!questions.length || questions.length > 64) throw new Error('Unsupported native questions')
    if (questions.some((question) => question.isSecret === true))
      throw new Error('Secret input must stay in a native authentication flow')
    return {
      kind: 'clarification',
      prompt: questions.map((q) => String(q.question ?? q.header)).join('\n\n'),
      presentation: {
        kind: 'form',
        fields: questions.map((q, index) => ({
          id: `field-${index}`,
          label: String(q.question ?? q.header).slice(0, 512),
          required: true,
          ...(Array.isArray(q.options) && q.options.length
            ? {
                kind: 'single',
                options: q.options.map((option, optionIndex) => ({
                  id: `option-${optionIndex}`,
                  label: String((option as Record<string, JsonValue>).label),
                  semantic: 'business_choice',
                })),
              }
            : { kind: 'text' }),
        })),
      },
    }
  }
  if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method))
    throw new Error('Native request is not admitted by this profile')
  const broad =
    !!params.networkApprovalContext ||
    (typeof params.grantRoot === 'string' && !inside(settings.workspacePath, params.grantRoot))
  return {
    kind: 'permission',
    prompt: [
      String(params.reason ?? 'Codex 请求执行权限'),
      typeof params.command === 'string' ? params.command : '',
      broad ? '请求超出当前项目授权，本次仅可拒绝或取消。' : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    presentation: {
      kind: 'choices',
      multiple: false,
      options: [
        ...(!broad ? [{ id: 'accept', label: '仅本次允许', semantic: 'allow_once' }] : []),
        { id: 'decline', label: '拒绝', semantic: 'deny' },
        { id: 'cancel', label: '取消执行', semantic: 'cancel' },
      ],
    },
  }
}
function responseFor(target: Target, answer: unknown, settings: Settings): JsonValue {
  const parsed = NativeAnswerPayloadSchema.shape.answer.parse(answer)
  if (target.method === 'item/tool/requestUserInput') {
    if (parsed.kind !== 'form') throw new Error('Native clarification requires a form answer')
    const questions = target.params.questions as Record<string, JsonValue>[]
    return {
      answers: Object.fromEntries(
        questions.map((question, index) => {
          const value = parsed.values[`field-${index}`]
          if (Array.isArray(question.options) && question.options.length) {
            const optionIndex = Number(String(value).replace(/^option-/, ''))
            const selected = question.options[optionIndex] as Record<string, JsonValue> | undefined
            if (!selected || typeof selected.label !== 'string')
              throw new Error('Unknown original native answer option')
            return [String(question.id), { answers: [selected.label] }]
          }
          if (typeof value !== 'string') throw new Error('A native text answer is required')
          return [String(question.id), { answers: [value] }]
        }),
      ),
    }
  }
  const presentation = questionFor(target, settings).presentation
  if (
    parsed.kind !== 'choices' ||
    parsed.optionIds.length !== 1 ||
    presentation.kind !== 'choices' ||
    !presentation.options?.some((option) => option.id === parsed.optionIds[0])
  )
    throw new Error('Unsupported native approval option')
  return { decision: parsed.optionIds[0]! }
}
