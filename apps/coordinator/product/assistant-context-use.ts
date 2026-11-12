import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  AssistantContextBindingSchema, AssistantContextPrepareSchema, AssistantContextPreparedSchema, AssistantContextSendSchema,
  CommandReceiptSchema, ContextPreviewInputSchema, ContextPreviewSchema, DigestSchema, IdSchema, JsonSchema, ScopeSchema,
  TimestampSchema, TrustedActorSchema,
} from '@personal-agent/contracts'
import type {
  AssistantContextBinding, AssistantContextBindings, AssistantContextPrepare, AssistantContextPrepared, AssistantContextSend,
  CommandReceipt, ContextPreview, ConversationMessage, Scope, TrustedActor, UserCommand,
} from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import type { ProductApplication } from '@personal-agent/application'
import { key } from '@personal-agent/orchestrator-core'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import type { ProductContextPreview } from './context-preview.ts'
import { canonicalJson } from '@personal-agent/contracts/canonical'

const canonical = (value: unknown): string => canonicalJson(JsonSchema.parse(JSON.parse(JSON.stringify(value))))
const digest = (value: unknown) => canonicalDigest(JSON.parse(canonical(value ?? null)))
const textDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const MetaSchema = z.strictObject({ requestId: IdSchema, observedAt: TimestampSchema, expiresAt: TimestampSchema })
const SignedSchema = z.strictObject({ version: z.literal(1), actor: TrustedActorSchema,
  input: AssistantContextPrepareSchema, scope: ScopeSchema, meta: MetaSchema,
  conversationThrough: z.number().int().nonnegative().safe(), fingerprint: DigestSchema, bundleDigest: DigestSchema })
type Signed = z.infer<typeof SignedSchema>
const BundleSchema = z.strictObject({ protocol: z.literal('assistant-context-bundle/1'),
  input: ContextPreviewInputSchema, preview: ContextPreviewSchema, scope: ScopeSchema,
  conversationThrough: z.number().int().nonnegative().safe() })

function fingerprint(preview: ContextPreview): string {
  const { requestId: _requestId, observedAt: _observedAt, expiresAt: _expiresAt, sources, ...rest } = preview
  return digest({ ...rest, sources: sources.map(({ content: _content, ...source }) => source) })
}
function bundle(input: AssistantContextPrepare['context'], preview: ContextPreview, scope: Scope, conversationThrough: number) {
  return BundleSchema.parse({ protocol: 'assistant-context-bundle/1', input, preview, scope, conversationThrough })
}
const sourceRefs = (preview: ContextPreview) => preview.sources.map(({ sourceId, kind, sourceDigest, previewDigest, truncated }) =>
  ({ sourceId, kind, sourceDigest, previewDigest, truncated }))

interface Options {
  store: ProductStore
  application: ProductApplication
  principal: { userId: string; authorityRef: string }
  preview: Pick<ProductContextPreview, 'prepareGuarded'>
  bindings: AssistantContextBindings
  projects(): readonly { id: string; scope: Scope }[]
  secret: Uint8Array
  now?: () => string
  beforeNewSend?(): void
}
export interface SelectedAssistantContext {
  binding: AssistantContextBinding
  content: string
  assertCurrent(): void
}

/** One explicitly selected discussion bundle joins the existing chat receipt and provider effect. */
export class ProductAssistantContext {
  private readonly options: Options
  private readonly principal: Options['principal']
  private readonly secret: Buffer
  constructor(options: Options) {
    if (options.secret.byteLength < 32) throw new TypeError('Selected context requires a private signing key')
    this.options = options; this.principal = structuredClone(options.principal); this.secret = Buffer.from(options.secret)
  }
  private now() { return this.options.now?.() ?? new Date().toISOString() }
  private actor(value: TrustedActor) {
    const actor = TrustedActorSchema.parse(value)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source === 'explicit_rule')
      throw new ApplicationFault('forbidden', 'Selected context requires the authenticated local user', 'none')
    return actor
  }
  private scope(projectId: string, fresh = true): Scope {
    const project = this.options.projects().find(value => value.id === projectId)
    if (!project) throw new ApplicationFault('forbidden', 'Selected context project is not configured', 'none')
    const scope = ScopeSchema.parse(project.scope)
    if (fresh && scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(this.now()))
      throw new ApplicationFault('stale_contract', 'Selected context project authorization expired')
    return scope
  }
  private signature(body: string) { return createHmac('sha256', this.secret).update(`assistant-context-use/1:${body}`).digest('base64url') }
  private chat(value: Signed): Extract<UserCommand, { kind: 'chat' }> {
    return { kind: 'chat', commandId: value.input.commandId, conversationId: value.input.context.conversationId,
      projectId: value.input.context.projectId, text: value.input.text }
  }
  private current(value: Signed): void {
    if (Date.parse(this.now()) < Date.parse(value.meta.observedAt) || Date.parse(this.now()) >= Date.parse(value.meta.expiresAt) ||
      digest(this.scope(value.input.context.projectId)) !== digest(value.scope))
      throw new ApplicationFault('stale_contract', 'Selected context expired or authorization changed; prepare again')
  }
  private decode(command: AssistantContextSend, actor: TrustedActor): Signed {
    const [body, signature] = command.token.split('.') as [string, string]
    const expected = Buffer.from(this.signature(body)), actual = Buffer.from(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ApplicationFault('forbidden', 'Selected context signature is invalid', 'none')
    let signed: Signed
    try { signed = SignedSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))) }
    catch { throw new ApplicationFault('forbidden', 'Selected context confirmation is invalid', 'none') }
    if (signed.actor.userId !== actor.userId || signed.actor.authorityRef !== actor.authorityRef ||
      signed.actor.source === 'explicit_rule' || signed.input.commandId !== command.commandId)
      throw new ApplicationFault('forbidden', 'Selected context confirmation belongs to another request', 'none')
    return signed
  }
  private checkPreview(preview: ContextPreview, input: AssistantContextPrepare['context']): void {
    if (preview.projectId !== input.projectId || preview.conversationId !== input.conversationId ||
      preview.contract?.workId !== input.workId || digest(preview.selections) !== digest(input.selections) || !preview.sources.length ||
      preview.sources.some(source => source.previewDigest !== textDigest(source.content) || source.bytes !== Buffer.byteLength(source.content)))
      throw new ApplicationFault('verification_failed', 'Selected context is empty or does not match the chosen sources')
  }
  async prepare(input: AssistantContextPrepare, inputActor: TrustedActor): Promise<AssistantContextPrepared> {
    const value = AssistantContextPrepareSchema.parse(input), actor = this.actor(inputActor), { store, bindings } = this.options
    if (store.uow.nesting) throw new ApplicationFault('invalid_request', 'Context preparation runs outside transactions')
    if (store.commands.get(value.commandId) || bindings.forCommand(value.commandId))
      throw new ApplicationFault('conflict', 'This message command has already been used; reconcile the original request')
    this.options.beforeNewSend?.()
    const scope = this.scope(value.context.projectId)
    const conversationThrough = store.workflows.conversations.get(value.context.conversationId)?.lastSequence ?? 0
    const prepared = await this.options.preview.prepareGuarded(value.context, actor, { conversationThrough })
    this.checkPreview(prepared.preview, value.context)
    prepared.assertCurrent()
    if (digest(scope) !== digest(prepared.scope) || digest(this.scope(value.context.projectId)) !== digest(scope))
      throw new ApplicationFault('conflict', 'Selected context authorization changed while preparing')
    const preview = prepared.preview
    const frozen = canonical(bundle(value.context, preview, scope, conversationThrough))
    const signed = SignedSchema.parse({ version: 1, actor, input: value, scope,
      meta: { requestId: preview.requestId, observedAt: preview.observedAt, expiresAt: preview.expiresAt },
      conversationThrough, fingerprint: fingerprint(preview), bundleDigest: textDigest(frozen) })
    this.current(signed)
    const body = Buffer.from(JSON.stringify(signed)).toString('base64url')
    return AssistantContextPreparedSchema.parse({ protocol: 'assistant-context-prepared/1', commandId: value.commandId,
      token: `${body}.${this.signature(body)}`, preview, text: value.text, expiresAt: preview.expiresAt })
  }
  private matches(binding: AssistantContextBinding, value: Signed): boolean {
    return binding.commandId === value.input.commandId && binding.messageId === key('message', value.input.commandId) &&
      binding.requestId === value.meta.requestId && binding.projectId === value.input.context.projectId &&
      binding.conversationId === value.input.context.conversationId && binding.userTextDigest === textDigest(value.input.text) &&
      digest(binding.principal) === digest(this.principal) && digest(binding.scope) === digest(value.scope) &&
      binding.bundleDigest === value.bundleDigest && binding.bundleRef === value.bundleDigest &&
      binding.expiresAt === value.meta.expiresAt && digest(binding.selections) === digest(value.input.context.selections) &&
      binding.contract?.workId === value.input.context.workId && Date.parse(binding.confirmedAt) >= Date.parse(value.meta.observedAt)
  }
  private rejectionDigest(value: Signed): string {
    return digest({ protocol: 'assistant-context-rejection/1', confirmation: value })
  }
  private replay(value: Signed): CommandReceipt | undefined {
    const { store, bindings } = this.options, prior = store.commands.get(value.input.commandId)
    const bound = bindings.forCommand(value.input.commandId)
    if (!prior && !bound) return undefined
    if (prior?.status === 'rejected' && !bound && prior.payloadDigest === this.rejectionDigest(value)) {
      const receipt = CommandReceiptSchema.parse({ ...(prior.result as object), commandId: value.input.commandId, seq: prior.seq })
      if (receipt.status !== 'rejected') throw new ApplicationFault('storage_unavailable', 'Selected context rejection result is inconsistent', 'none')
      return receipt
    }
    if (!prior || !bound) throw new ApplicationFault('conflict', 'Message receipt and selected context binding do not name the same request')
    const binding = AssistantContextBindingSchema.parse(bound), byMessage = bindings.forMessage(binding.messageId)
    const user = store.product.messages.getById(binding.messageId)
    if (prior.status !== 'recorded' || prior.payloadDigest !== digest({ command: this.chat(value), actor: value.actor }) ||
      !this.matches(binding, value) || digest(byMessage) !== digest(binding) || !user || user.role !== 'user' ||
      user.provenance !== 'trusted_user' || user.anchor || user.text !== value.input.text ||
      user.projectId !== binding.projectId || user.conversationId !== binding.conversationId)
      throw new ApplicationFault('conflict', 'The message command already names another immutable request')
    const receipt = CommandReceiptSchema.parse({ ...(prior.result as object), commandId: value.input.commandId, seq: prior.seq })
    if (receipt.status !== 'recorded') throw new ApplicationFault('storage_unavailable', 'Selected context receipt result is inconsistent', 'none')
    return receipt
  }
  async dispatch(input: AssistantContextSend, inputActor: TrustedActor): Promise<CommandReceipt> {
    const command = AssistantContextSendSchema.parse(input), actor = this.actor(inputActor), value = this.decode(command, actor)
    if (this.options.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Selected context send owns the outer transaction')
    try { return await this.send(command, actor, value) }
    catch (error) {
      if (!(error instanceof ApplicationFault) || !['conflict', 'stale_contract', 'verification_failed', 'budget_exceeded', 'forbidden', 'unsupported_capability', 'policy_unprepared', 'invalid_request'].includes(error.error.code)) throw error
      return this.options.store.uow.atomic(() => {
        const prior = this.replay(value)
        if (prior) return prior
        const receipt = this.options.store.commands.record(command.commandId, this.rejectionDigest(value),
          () => ({ status: 'rejected' as const, error: error.error }), 'rejected')
        return CommandReceiptSchema.parse({ ...receipt.result, commandId: command.commandId, seq: receipt.seq })
      })
    }
  }
  private async send(command: AssistantContextSend, actor: TrustedActor, value: Signed): Promise<CommandReceipt> {
    const { store, bindings, application } = this.options
    if (store.uow.nesting) throw new ApplicationFault('invalid_request', 'Selected context send owns the outer transaction')
    const prior = this.replay(value)
    if (prior) return prior
    this.options.beforeNewSend?.()
    this.current(value)
    let guarded
    try { guarded = await this.options.preview.prepareGuarded(value.input.context, actor, { conversationThrough: value.conversationThrough }) }
    catch (error) { const repeated = this.replay(value); if (repeated) return repeated; throw error }
    const afterPreview = this.replay(value)
    if (afterPreview) return afterPreview
    this.checkPreview(guarded.preview, value.input.context)
    if (fingerprint(guarded.preview) !== value.fingerprint || digest(guarded.scope) !== digest(value.scope))
      throw new ApplicationFault('conflict', 'Selected context sources changed; prepare again')
    const preview = ContextPreviewSchema.parse({ ...guarded.preview, ...value.meta })
    const frozen = canonical(bundle(value.input.context, preview, value.scope, value.conversationThrough))
    if (textDigest(frozen) !== value.bundleDigest)
      throw new ApplicationFault('conflict', 'Selected context bundle changed; prepare again')
    let prepared
    try { prepared = await application.prepareCommand(this.chat(value), value.actor) }
    catch (error) { const repeated = this.replay(value); if (repeated) return repeated; throw error }
    const afterPreflight = this.replay(value)
    if (afterPreflight) return afterPreflight
    this.current(value)
    guarded.assertCurrent()
    const artifact = store.artifacts.write(Buffer.from(frozen))
    if (artifact.digest !== value.bundleDigest) throw new ApplicationFault('storage_unavailable', 'Selected context bundle could not be frozen', 'none')
    return store.uow.atomic(() => {
      const repeated = this.replay(value)
      if (repeated) return repeated
      this.current(value); guarded.assertCurrent()
      const receipt = application.commitPrepared(prepared)
      if (receipt.status === 'rejected') throw new ApplicationFault(receipt.error.code, receipt.error.message, receipt.error.retry)
      const binding = AssistantContextBindingSchema.parse({ protocol: 'assistant-context-binding/1',
        commandId: command.commandId, messageId: key('message', command.commandId), requestId: value.meta.requestId,
        projectId: value.input.context.projectId, conversationId: value.input.context.conversationId, userTextDigest: textDigest(value.input.text),
        principal: this.principal, purpose: 'conversation_discussion', scope: value.scope, selections: value.input.context.selections,
        ...(preview.contract ? { contract: preview.contract } : {}), bundleRef: artifact.id, bundleDigest: artifact.digest,
        sources: sourceRefs(preview), confirmedAt: this.now(), expiresAt: value.meta.expiresAt })
      store.artifacts.insert(artifact, binding.confirmedAt)
      try {
        const persisted = store.artifacts.read(artifact.id)
        if (!persisted || textDigest(persisted.data) !== value.bundleDigest) throw new Error('Bundle mismatch')
      } catch { throw new ApplicationFault('storage_unavailable', 'Selected context artifact could not be verified', 'none') }
      const written = bindings.put(binding)
      if (digest(written.binding) !== digest(binding)) throw new ApplicationFault('storage_unavailable', 'Selected context binding differs from the confirmed message', 'none')
      this.current(value)
      return receipt
    })
  }
  audit(messageId: string): AssistantContextBinding | undefined {
    const value = this.options.bindings.forMessage(IdSchema.parse(messageId))
    if (!value) return undefined
    const binding = AssistantContextBindingSchema.parse(value)
    if (digest(binding.principal) !== digest(this.principal))
      throw new ApplicationFault('forbidden', 'Selected context belongs to another principal', 'none')
    this.scope(binding.projectId, false)
    return binding
  }
  async forMessage(user: ConversationMessage): Promise<SelectedAssistantContext | undefined> {
    const binding = this.audit(user.id)
    if (!binding) return undefined
    const { store, bindings } = this.options
    if (store.uow.nesting) throw new ApplicationFault('invalid_request', 'Context revalidation runs outside transactions')
    const message = store.product.messages.getById(user.id), receipt = store.commands.get(binding.commandId)
    const command = { kind: 'chat', commandId: binding.commandId, projectId: binding.projectId,
      conversationId: binding.conversationId, text: user.text }
    if (!message || digest(message) !== digest(user) || message.role !== 'user' || message.provenance !== 'trusted_user' || message.anchor ||
      binding.messageId !== key('message', binding.commandId) || binding.projectId !== message.projectId ||
      binding.conversationId !== message.conversationId || binding.userTextDigest !== textDigest(message.text) ||
      digest(bindings.forCommand(binding.commandId)) !== digest(binding) || !receipt || receipt.status !== 'recorded' ||
      !(['local_ui', 'local_cli'] as const).some(source => receipt.payloadDigest === digest({ command, actor: { ...this.principal, source } })))
      throw new ApplicationFault('storage_unavailable', 'Selected context message or receipt identity is inconsistent', 'none')
    const original = CommandReceiptSchema.safeParse({ ...(receipt.result as object), commandId: binding.commandId, seq: receipt.seq })
    if (!original.success || original.data.status !== 'recorded')
      throw new ApplicationFault('storage_unavailable', 'Selected context receipt result is inconsistent', 'none')
    const assertBinding = () => {
      if (Date.parse(this.now()) < Date.parse(binding.confirmedAt) || Date.parse(this.now()) >= Date.parse(binding.expiresAt) ||
        digest(this.scope(binding.projectId)) !== digest(binding.scope) ||
        digest(bindings.forMessage(user.id)) !== digest(binding) || digest(bindings.forCommand(binding.commandId)) !== digest(binding) ||
        digest(store.commands.get(binding.commandId)) !== digest(receipt) ||
        digest(store.product.messages.getById(user.id)) !== digest(user))
        throw new ApplicationFault('stale_contract', 'Selected context expired or its message authorization changed; prepare again')
    }
    assertBinding()
    let frozen: z.infer<typeof BundleSchema>
    try {
      const artifact = store.artifacts.get(binding.bundleRef)
      if (!artifact || artifact.bytes > 1024 * 1024 || artifact.digest !== binding.bundleDigest) throw new Error('Bundle registry mismatch')
      const read = store.artifacts.read(binding.bundleRef)
      if (!read || textDigest(read.data) !== binding.bundleDigest || read.data.byteLength !== artifact.bytes) throw new Error('Bundle bytes mismatch')
      frozen = BundleSchema.parse(JSON.parse(Buffer.from(read.data).toString('utf8')))
    } catch { throw new ApplicationFault('storage_unavailable', 'Selected context bundle is missing or changed', 'none') }
    this.checkPreview(frozen.preview, frozen.input)
    if (frozen.preview.requestId !== binding.requestId || frozen.preview.expiresAt !== binding.expiresAt ||
      frozen.input.projectId !== binding.projectId || frozen.input.conversationId !== binding.conversationId ||
      digest(frozen.scope) !== digest(binding.scope) || digest(sourceRefs(frozen.preview)) !== digest(binding.sources) ||
      digest(frozen.preview.contract) !== digest(binding.contract) || digest(frozen.input.selections) !== digest(binding.selections))
      throw new ApplicationFault('storage_unavailable', 'Selected context bundle does not match its binding', 'none')
    const current = await this.options.preview.prepareGuarded(frozen.input, { ...this.principal, source: 'local_ui' },
      { conversationThrough: frozen.conversationThrough })
    if (fingerprint(current.preview) !== fingerprint(frozen.preview) || digest(current.scope) !== digest(binding.scope))
      throw new ApplicationFault('conflict', 'Selected context sources changed before sending; prepare again')
    const content = canonical({ protocol: 'user-selected-context/1', trust: 'untrusted_data',
      sources: frozen.preview.sources.map(({ sourceId, kind, content }) => ({ sourceId, kind, content })) })
    if (Buffer.byteLength(content) > 512 * 1024) throw new ApplicationFault('budget_exceeded', 'Selected context projection exceeds the bounded message budget')
    const registry = digest(store.artifacts.get(binding.bundleRef))
    const assertCurrent = () => {
      assertBinding(); current.assertCurrent()
      if (digest(store.artifacts.get(binding.bundleRef)) !== registry)
        throw new ApplicationFault('conflict', 'Selected context artifact changed before sending')
    }
    assertCurrent()
    return { binding, content, assertCurrent }
  }
}
