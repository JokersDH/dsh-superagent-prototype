/**
 * Model connection input is transient component state, never a persisted or published projection.
 * This module owns only the local field validation, the secret-lifetime convention and the bounded
 * user-facing copy. The wire, private server-side storage, auth and origin checks stay in main.
 */

export interface TrialModelConnectionDraft {
  /** Base URL of the model endpoint as typed by the user; main re-validates it. */
  readonly endpoint: string
  /** Provider model name; main decides whether the provider accepts it. */
  readonly model: string
  /** Transient secret. Never store, log, serialise or render it. */
  readonly apiKey: string
  readonly allowInsecureHttp?: boolean
}

export type TrialModelConnectionResult =
  | { readonly status: 'saved'; readonly message?: string | undefined }
  | { readonly status: 'connected'; readonly message?: string | undefined }
  | { readonly status: 'failed'; readonly message?: string | undefined }
  | { readonly status: 'unsupported'; readonly message?: string | undefined }

export interface TrialModelConnectionLimit {
  readonly enabled: boolean
  /** Sanitised, user-facing reason when the connection entry is not available. */
  readonly reason?: string | undefined
}

export type TrialModelConnectionField = 'endpoint' | 'model' | 'apiKey'

export type TrialModelConnectionFailure =
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'invalid'; readonly field: TrialModelConnectionField; readonly message: string }

export type TrialModelConnectionValidation =
  | { readonly ok: true; readonly draft: TrialModelConnectionDraft }
  | { readonly ok: false; readonly failure: TrialModelConnectionFailure }

const defaultFailure = '连接未完成，请检查配置后重试。'
const unavailableCopy = '当前设置未提供模型连接入口。'

/** Strip anything that could leak a secret, a local path or an internal stack from feedback. */
export function trialConnectionMessage(raw: string | undefined, secret?: string): string {
  if (raw === undefined) return defaultFailure
  let text = raw.trim()
  if (!text) return defaultFailure
  // Refuse the whole message when the submitted secret appears; never try to partially redact it.
  if (secret !== undefined && secret.length > 0 && text.includes(secret)) return defaultFailure
  text = text
    .replace(/\b(?:api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*\S+/gi, '[已隐藏]')
    .replace(/(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\)\S+/g, ' [路径已隐藏]')
    .replace(/\bat\s+\S+\s+\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return defaultFailure
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

/** Reject control characters and anything that would turn a label into page structure. */
function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

/**
 * Validate exactly the three fields main needs. Endpoint credentials are refused because they would
 * become part of a URL, and plain HTTP is accepted only for loopback so a remote key is never sent in
 * the clear by this form's suggestion.
 */
export function trialModelConnectionDraft(
  input: { readonly endpoint: string; readonly model: string; readonly apiKey: string; readonly allowInsecureHttp?: boolean },
  limit: TrialModelConnectionLimit,
): TrialModelConnectionValidation {
  if (!limit.enabled) {
    return { ok: false, failure: { kind: 'unavailable', message: trialConnectionMessage(limit.reason ?? unavailableCopy) } }
  }
  const endpoint = clean(input.endpoint)
  const model = clean(input.model)
  const apiKey = input.apiKey.replace(/[\r\n]/g, '')
  if (!endpoint) return { ok: false, failure: { kind: 'invalid', field: 'endpoint', message: '请填写模型端点。' } }
  if (endpoint.length > 512) return { ok: false, failure: { kind: 'invalid', field: 'endpoint', message: '模型端点过长。' } }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, failure: { kind: 'invalid', field: 'endpoint', message: '模型端点需要是完整的 http(s) 地址。' } }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, failure: { kind: 'invalid', field: 'endpoint', message: '模型端点只支持 http(s) 地址。' } }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, failure: { kind: 'invalid', field: 'endpoint', message: '端点中不能包含账号或密码。' } }
  }
  if (url.search || url.hash) return { ok: false, failure: { kind: 'invalid', field: 'endpoint', message: '端点不能包含查询参数或片段。' } }
  if (url.protocol === 'http:' && !input.allowInsecureHttp) {
    return { ok: false, failure: { kind: 'invalid', field: 'endpoint', message: '使用 HTTP 需要明确允许未加密传输。' } }
  }
  if (!model) return { ok: false, failure: { kind: 'invalid', field: 'model', message: '请填写模型名称。' } }
  if (model.length > 128) return { ok: false, failure: { kind: 'invalid', field: 'model', message: '模型名称过长。' } }
  if (!apiKey) return { ok: false, failure: { kind: 'invalid', field: 'apiKey', message: '请填写 API Key。' } }
  if (apiKey.length > 4096) return { ok: false, failure: { kind: 'invalid', field: 'apiKey', message: 'API Key 过长。' } }
  if (endpoint.includes(apiKey) || model.includes(apiKey)) return { ok: false, failure: { kind: 'invalid', field: 'apiKey', message: '密钥不能出现在端点或模型名称中。' } }
  return { ok: true, draft: { endpoint, model, apiKey, allowInsecureHttp: input.allowInsecureHttp ?? false } }
}

export const trialModelConnectionFallback = defaultFailure
