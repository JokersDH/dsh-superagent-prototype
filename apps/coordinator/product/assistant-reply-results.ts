import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { ApplicationFault } from '@personal-agent/application'
import { AssistantInferenceRecordSchema, AssistantReplyBodySchema, AssistantReplyResultSchema, JsonSchema } from '@personal-agent/contracts'
import type { AssistantReplyBody, AssistantReplyResults } from '@personal-agent/contracts'
import { canonicalJson } from '@personal-agent/contracts/canonical'
import { key } from '@personal-agent/orchestrator-core'
import type { ProductStore } from '@personal-agent/storage'
import type { AssistantModelReply } from './model-provider.ts'

const MAX_BYTES = 524288
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const invalid = () => new ApplicationFault('verification_failed', 'Completed assistant reply cannot be verified')

/** Returned data joins the existing request. A request receipt alone never permits another send. */
export class CompletedAssistantReplies {
  private readonly store: ProductStore
  private readonly results: AssistantReplyResults
  private readonly principal: { userId: string; authorityRef: string }
  private readonly projectIds: () => readonly string[]
  constructor(store: ProductStore, results: AssistantReplyResults,
    principal: { userId: string; authorityRef: string }, projectIds: () => readonly string[]) {
    this.store = store; this.results = results; this.projectIds = projectIds
    this.principal = structuredClone(principal)
  }
  private request(requestId: string) {
    const receipt = this.store.commands.get(requestId)
    const parsed = AssistantInferenceRecordSchema.safeParse(receipt?.result)
    if (!receipt || receipt.status !== 'recorded' || !parsed.success) throw invalid()
    const inference = parsed.data, input = inference.input, source = this.store.product.messages.getById(input.messageId)
    if (requestId !== key('assistant-request', input.messageId) || !this.projectIds().includes(input.projectId) ||
      !source || source.role !== 'user' || source.provenance !== 'trusted_user' || source.anchor ||
      source.projectId !== input.projectId || source.conversationId !== input.conversationId ||
      (inference.sourceTextDigest !== undefined && inference.sourceTextDigest !== digest(source.text))) throw invalid()
    return { receipt, inference }
  }
  save(requestId: string, response: AssistantModelReply): AssistantReplyBody {
    const { receipt, inference } = this.request(requestId), input = inference.input
    const base = { protocol: 'assistant-reply-body/1' as const,
      projectId: input.projectId, conversationId: input.conversationId,
      sourceMessageId: input.messageId, replyMessageId: key('assistant-reply', input.messageId),
      model: response.model, text: response.text }
    const structured = AssistantReplyBodySchema.safeParse({ ...base, suggestions: response.suggestions ?? [] })
    const body = structured.success ? structured.data : AssistantReplyBodySchema.parse({ ...base, suggestions: [] })
    if (inference.model !== body.model) throw invalid()
    const artifact = this.store.artifacts.write(Buffer.from(canonicalJson(JsonSchema.parse(body))))
    this.store.uow.atomic(() => {
      const current = this.request(requestId)
      if (current.receipt.payloadDigest !== receipt.payloadDigest) throw invalid()
      this.store.artifacts.insert(artifact)
      this.results.put(AssistantReplyResultSchema.parse({ protocol: 'assistant-reply-result/1', requestId,
        requestDigest: receipt.payloadDigest, sourceMessageId: input.messageId, replyMessageId: body.replyMessageId,
        projectId: input.projectId, conversationId: input.conversationId, principal: this.principal, model: body.model,
        artifactRef: artifact.id, artifactDigest: artifact.digest, textDigest: digest(body.text), recordedAt: new Date().toISOString() }))
    })
    return body
  }
  read(requestId: string): AssistantReplyBody | undefined {
    return this.readVerified(requestId)?.body
  }
  readVerified(requestId: string) {
    const value = this.results.forRequest(requestId)
    if (!value) return undefined
    try {
      const result = AssistantReplyResultSchema.parse(value), { receipt, inference } = this.request(requestId), input = inference.input
      if (result.requestId !== requestId || result.requestDigest !== receipt.payloadDigest ||
        result.sourceMessageId !== input.messageId || result.replyMessageId !== key('assistant-reply', input.messageId) ||
        result.projectId !== input.projectId || result.conversationId !== input.conversationId ||
        result.principal.userId !== this.principal.userId || result.principal.authorityRef !== this.principal.authorityRef ||
        result.model !== inference.model || result.artifactRef !== result.artifactDigest ||
        canonicalJson(this.results.forReply(result.replyMessageId) ?? null) !== canonicalJson(result)) throw invalid()
      const artifact = this.store.artifacts.get(result.artifactRef)
      if (!artifact || artifact.id !== result.artifactDigest || artifact.digest !== result.artifactDigest ||
        artifact.bytes < 1 || artifact.bytes > MAX_BYTES || !Number.isSafeInteger(artifact.bytes)) throw invalid()
      const fd = openSync(artifact.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      let data: Buffer
      try {
        const stat = fstatSync(fd)
        if (!stat.isFile() || stat.size !== artifact.bytes) throw invalid()
        data = Buffer.alloc(artifact.bytes + 1)
        let offset = 0, count: number
        while (offset < data.length && (count = readSync(fd, data, offset, data.length - offset, null))) offset += count
        if (offset !== artifact.bytes) throw invalid()
        data = data.subarray(0, offset)
      } finally { closeSync(fd) }
      if (digest(data) !== result.artifactDigest) throw invalid()
      const body = AssistantReplyBodySchema.parse(JSON.parse(data.toString('utf8')))
      if (body.projectId !== result.projectId || body.conversationId !== result.conversationId ||
        body.sourceMessageId !== result.sourceMessageId || body.replyMessageId !== result.replyMessageId ||
        body.model !== result.model || digest(body.text) !== result.textDigest) throw invalid()
      if (canonicalJson(this.results.forRequest(requestId) ?? null) !== canonicalJson(result) ||
        canonicalJson(this.results.forReply(result.replyMessageId) ?? null) !== canonicalJson(result)) throw invalid()
      const final = this.request(requestId)
      if (final.receipt.payloadDigest !== receipt.payloadDigest || canonicalJson(JsonSchema.parse(final.inference)) !== canonicalJson(JsonSchema.parse(inference))) throw invalid()
      return { body, result, inference }
    } catch { throw invalid() }
  }
}
