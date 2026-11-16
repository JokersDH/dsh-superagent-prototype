import { z } from 'zod'

/** Transient authenticated input. Never include it in status, receipts or logs. */
export const AssistantConnectionInputSchema = z.strictObject({
  baseURL: z.url().max(512).refine(value => {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  }),
  model: z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/),
  apiKey: z.string().min(12).max(4096).regex(/^[\x21-\x7e]+$/),
  allowInsecureHttp: z.boolean().default(false),
}).refine(value => value.baseURL.startsWith('https:') || value.allowInsecureHttp)
  .refine(value => !value.baseURL.includes(value.apiKey) && !value.model.includes(value.apiKey))

export type AssistantConnectionInput = z.infer<typeof AssistantConnectionInputSchema>
