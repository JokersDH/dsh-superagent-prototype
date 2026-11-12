import OpenAI from 'openai'
import { z } from 'zod'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { AssistantProviderStatus } from '@personal-agent/contracts'
import type { ReasonerProposal, Scope } from '@personal-agent/contracts'
import { ASSISTANT_REPLY_TOOL, AssistantSuggestionData } from './assistant-suggestion-data.ts'

export const DEFAULT_MODEL_CONFIG = join(homedir(), '.config/superagent-personal/model.json')
const ConfigurationSchema = z
  .strictObject({
    baseURL: z.url().refine((value) => {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    }),
    apiKey: z
      .string()
      .trim()
      .min(12)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/),
    model: z.string().min(1).max(160),
    allowedModels: z.array(z.string().min(1).max(160)).min(1).max(32),
    allowInsecureHttp: z.boolean().default(false),
    maxOutputTokens: z.number().int().min(64).max(4096).default(1200),
    suggestionsEnabled: z.boolean().default(false),
  })
  .refine(
    (value) =>
      value.allowedModels.includes(value.model) && new Set(value.allowedModels).size === value.allowedModels.length,
  )
  .refine((value) => value.baseURL.startsWith('https:') || value.allowInsecureHttp)

export class ModelProviderError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
export interface AssistantModelPort {
  status(): AssistantProviderStatus
  prepareReply?(): PreparedAssistantReply
  reply(
    messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
    context?: { projectId: string; sourceMessageId: string; scope?: Scope },
  ): Promise<AssistantModelReply>
}
export interface AssistantModelReply { text: string; model: string; suggestions?: readonly ReasonerProposal[] }
export interface PreparedAssistantReply {
  readonly model: string
  readonly configurationDigest: string
  readonly suggestionsEnabled?: boolean
  reply: AssistantModelPort['reply']
}

/** A single SDK completion call; no tool loop, native credentials or repository-file access. */
export class PrivateModelProvider implements AssistantModelPort {
  private readonly path: string
  private busy = 0
  private lastResponseAt: string | undefined
  private failed = false
  constructor(path = process.env.PA_MODEL_CONFIG ?? DEFAULT_MODEL_CONFIG) {
    this.path = path
  }
  private read() {
    if (!existsSync(this.path)) throw new ModelProviderError('not_configured', '尚未配置模型连接。')
    const directory = lstatSync(dirname(this.path)),
      file = lstatSync(this.path)
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o077) !== 0 ||
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.size > 16384 ||
      (file.mode & 0o077) !== 0 ||
      (process.getuid && (directory.uid !== process.getuid() || file.uid !== process.getuid()))
    )
      throw new ModelProviderError('configuration_invalid', '模型私有配置的权限或文件类型不正确。')
    try {
      return ConfigurationSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      throw new ModelProviderError('configuration_invalid', '模型私有配置格式不正确。')
    }
  }
  status(): AssistantProviderStatus {
    try {
      const config = this.read()
      return {
        protocol: 'assistant-provider/1',
        configured: true,
        baseURL: config.baseURL,
        model: config.model,
        models: config.allowedModels,
        state: this.busy ? 'responding' : this.failed ? 'error' : this.lastResponseAt ? 'available' : 'configured',
        secureTransport: config.baseURL.startsWith('https:'),
        suggestionsEnabled: config.suggestionsEnabled,
        ...(this.lastResponseAt ? { lastResponseAt: this.lastResponseAt } : {}),
      }
    } catch {
      return {
        protocol: 'assistant-provider/1',
        configured: false,
        baseURL: null,
        model: null,
        models: [],
        state: 'not_configured',
        secureTransport: false,
      }
    }
  }
  selectModel(model: string): AssistantProviderStatus {
    const config = this.read()
    if (!config.allowedModels.includes(model))
      throw new ModelProviderError('unsupported_model', '这个模型不在已配置的可选列表中。')
    this.write({ ...config, model })
    return this.status()
  }
  setSuggestionsEnabled(enabled: boolean): AssistantProviderStatus {
    const config = this.read()
    this.write({ ...config, suggestionsEnabled: enabled })
    return this.status()
  }
  private write(config: z.infer<typeof ConfigurationSchema>) {
    const temporary = `${this.path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      const bytes = Buffer.from(JSON.stringify(config, null, 2) + '\n')
      for (let offset = 0; offset < bytes.length; ) offset += writeSync(fd, bytes, offset)
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(temporary, this.path)
      const directory = openSync(dirname(this.path), 'r')
      try {
        fsyncSync(directory)
      } finally {
        closeSync(directory)
      }
    } finally {
      if (fd !== undefined) closeSync(fd)
      if (existsSync(temporary)) unlinkSync(temporary)
    }
    this.failed = false
    this.lastResponseAt = undefined
  }
  async reply(
    messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
    context?: { projectId: string; sourceMessageId: string; scope?: Scope },
  ) {
    return this.prepareReply().reply(messages, onDelta, signal, context)
  }
  prepareReply(): PreparedAssistantReply {
    const config = this.read()
    const replyDataSchema = config.suggestionsEnabled ? structuredClone(ASSISTANT_REPLY_TOOL) : undefined
    let used = false
    return Object.freeze({
      model: config.model,
      configurationDigest: createHash('sha256').update(JSON.stringify({ config, replyDataSchema: replyDataSchema ?? null })).digest('hex'),
      suggestionsEnabled: config.suggestionsEnabled,
      reply: async (...args: Parameters<AssistantModelPort['reply']>) => {
        if (used) throw new ModelProviderError('request_already_used', '这个模型请求已发送，未自动重发。')
        used = true
        return this.request(config, replyDataSchema, ...args)
      },
    })
  }
  private async request(
    config: z.infer<typeof ConfigurationSchema>,
    replyDataSchema: typeof ASSISTANT_REPLY_TOOL | undefined,
    messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
    context?: { projectId: string; sourceMessageId: string; scope?: Scope },
  ) {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
      timeout: 45000,
      logLevel: 'off',
      fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
    })
    this.busy++
    this.failed = false
    let abortStream: (() => void) | undefined
    const requestAbort = new AbortController()
    const abort = () => {
      requestAbort.abort()
      abortStream?.()
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const deadline = setTimeout(abort, 45000)
    try {
      const result = await client.chat.completions.create(
        {
          model: config.model,
          messages: [...messages.map(message => ({ ...message })), ...(config.suggestionsEnabled ? [{ role: 'system' as const,
            content: JSON.stringify({ instruction: 'Return assistant_reply data with optional proposals for explicit user review. Never execute anything. Only use the exact source/project/scope below, do not invent a contract or permissions. Missing inputs remain for the user.', requestContext: context ?? null }) }] : [])],
          max_tokens: config.maxOutputTokens,
          stream: true,
          ...(replyDataSchema ? { tools: [replyDataSchema], tool_choice: 'auto' as const, parallel_tool_calls: false } : {}),
        },
        { signal: requestAbort.signal },
      )
      abortStream = () => result.controller.abort()
      let text = '',
        pending = '',
        finished = false,
        terminal: string | undefined
      const suggestions = new AssistantSuggestionData()
      const emit = (value: string) => {
        if (!value) return
        text += value
        if (text.length > 32768)
          throw new ModelProviderError('response_limit', '模型回复超过显示上限，请缩小问题范围。')
        onDelta?.(value)
      }
      // Hold a possible key prefix across chunks, so a split credential never reaches the browser.
      const redact = (chunk: string, final = false) => {
        pending = (pending + chunk).split(config.apiKey).join('[密钥已隐藏]')
        let held = final ? 0 : Math.min(pending.length, config.apiKey.length - 1)
        while (held && !config.apiKey.startsWith(pending.slice(-held))) held--
        emit(pending.slice(0, pending.length - held))
        pending = held ? pending.slice(-held) : ''
      }
      for await (const chunk of result) {
        const choice = chunk.choices[0]
        if (!choice) continue
        if (choice.delta.content) redact(choice.delta.content)
        if (config.suggestionsEnabled && choice.delta.tool_calls) suggestions.append(choice.delta.tool_calls)
        if (choice.finish_reason) {
          terminal = choice.finish_reason
          if (choice.finish_reason === 'stop' || choice.finish_reason === 'length' || (config.suggestionsEnabled && choice.finish_reason === 'tool_calls')) finished = true
        }
      }
      if (!finished) throw new ModelProviderError('stream_interrupted', '模型回复中断，未自动重发。请重新发送后再试。')
      redact('', true)
      const structured = config.suggestionsEnabled ? suggestions.finish(terminal, config.apiKey) : undefined
      if (!text.trim() && structured) emit(structured.text)
      if (!text.trim()) throw new ModelProviderError('empty_response', '模型没有返回可显示的回复，请重试。')
      this.lastResponseAt = new Date().toISOString()
      const bound = structured?.suggestions.every(suggestion => suggestion.kind === 'reply' || (context &&
        suggestion.sourceMessageId === context.sourceMessageId &&
        (suggestion.kind !== 'propose_work' || suggestion.projectId === context.projectId) &&
        (suggestion.kind !== 'propose_decision' || suggestion.scope.projectId === context.projectId)))
      return { text: text.trim(), model: config.model, ...(structured && bound ? { suggestions: structured.suggestions } : {}) }
    } catch (error) {
      this.failed = true
      if (signal?.aborted) {
        this.failed = false
        throw new ModelProviderError('cancelled', '本机服务正在关闭，模型生成已停止，未自动重发。')
      }
      if (error instanceof ModelProviderError) throw error
      const status = error instanceof OpenAI.APIError ? error.status : undefined
      throw new ModelProviderError(
        'provider_error',
        status === 401 || status === 403
          ? '模型服务认证失败，请检查本机模型配置。'
          : status === 429
            ? '模型服务繁忙或额度受限，请稍后重试。'
            : '模型暂时未能完成回复，请稍后重新发送。',
      )
    } finally {
      clearTimeout(deadline)
      signal?.removeEventListener('abort', abort)
      abortStream?.()
      this.busy--
    }
  }
}
