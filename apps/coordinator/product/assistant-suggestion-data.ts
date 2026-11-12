import { z } from 'zod'
import { ReasonerProposalSchema } from '@personal-agent/contracts'
import type { ReasonerProposal } from '@personal-agent/contracts'

const data = z.strictObject({ text: z.string().trim().min(1).max(32768), suggestions: z.array(ReasonerProposalSchema).max(8) })
const { $schema: _schema, ...parameters } = z.toJSONSchema(data, { target: 'draft-7', io: 'input' })
export const ASSISTANT_REPLY_TOOL = {
  type: 'function' as const,
  function: { name: 'assistant_reply', strict: false,
    description: 'Return ordinary reply text and optional proposal data only. This function never executes work, records a decision or grants permission. Do not invent missing source, project or contract identities.',
    parameters },
}

const deltas = z.array(z.strictObject({ index: z.literal(0), id: z.string().max(256).nullish(), type: z.literal('function').nullish(),
  function: z.strictObject({ name: z.string().max(128).nullish(), arguments: z.string().max(262144).nullish() }).nullish() })).max(1)

/** Collects one bounded data channel. No tool callback, result message or second model request exists. */
export class AssistantSuggestionData {
  private name = ''
  private arguments = ''
  private bytes = 0
  private invalid = false
  private id: string | undefined
  append(input: unknown) {
    if (this.invalid) return
    const parsed = deltas.safeParse(input)
    if (!parsed.success) { this.invalid = true; this.arguments = ''; return }
    for (const delta of parsed.data) {
      if (this.invalid) continue
      if (delta.id != null) {
        if (delta.id.length > 256 || (this.id !== undefined && this.id !== delta.id)) this.invalid = true
        this.id = delta.id
      }
      if (delta.function?.name) this.name += delta.function.name
      const text = delta.function?.arguments ?? ''
      this.bytes += Buffer.byteLength(text)
      if (this.bytes > 262144 || this.name.length > 128) this.invalid = true
      if (this.invalid) { this.arguments = ''; continue }
      this.arguments += text
    }
  }
  finish(terminal: string | undefined, secret: string): { text: string; suggestions: readonly ReasonerProposal[] } | undefined {
    if (this.invalid || this.name !== 'assistant_reply' || !['stop', 'tool_calls'].includes(terminal ?? '')) return undefined
    try {
      const scrub = (value: unknown): unknown => {
        if (typeof value === 'string') return value.split(secret).join('[密钥已隐藏]')
        if (Array.isArray(value)) return value.map(scrub)
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, scrub(nested)]))
        return value
      }
      const parsed = data.safeParse(scrub(JSON.parse(this.arguments)))
      return parsed.success ? parsed.data : undefined
    } catch { return undefined }
  }
}
