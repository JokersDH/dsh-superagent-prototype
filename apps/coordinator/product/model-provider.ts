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
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { AssistantProviderStatus } from '@personal-agent/contracts'

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
  reply(
    messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
  ): Promise<{ text: string; model: string }>
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
    const temporary = `${this.path}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      const bytes = Buffer.from(JSON.stringify({ ...config, model }, null, 2) + '\n')
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
    return this.status()
  }
  async reply(messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[]) {
    const config = this.read()
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
    try {
      const result = await client.chat.completions.create({
        model: config.model,
        messages: [...messages],
        max_tokens: config.maxOutputTokens,
        stream: false,
      })
      const text = result.choices[0]?.message.content?.trim()
      if (!text || text.length > 32768)
        throw new ModelProviderError('empty_response', '模型没有返回可显示的回复，请重试。')
      this.lastResponseAt = new Date().toISOString()
      return { text: text.split(config.apiKey).join('[密钥已隐藏]'), model: config.model }
    } catch (error) {
      this.failed = true
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
      this.busy--
    }
  }
}
