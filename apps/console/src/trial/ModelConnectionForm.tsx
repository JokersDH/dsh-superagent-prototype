import { useEffect, useId, useRef, useState } from 'react'
import { KeyRound, Link2, PlugZap, Save, ShieldCheck } from 'lucide-react'
import type {
  TrialModelConnectionDraft, TrialModelConnectionField, TrialModelConnectionLimit, TrialModelConnectionResult,
} from './model-connection.ts'
import { trialConnectionMessage, trialModelConnectionDraft } from './model-connection.ts'
import './trial.css'

export interface TrialModelConnectionFormProps {
  /** Main decides whether the original settings surface offers a connection entry at all. */
  readonly availability?: TrialModelConnectionLimit | undefined
  /** Auth/transport identity. A change discards every field, including the transient secret. */
  readonly identity?: string | number | undefined
  /** Main may save privately; the form never persists in browser storage or echoes the key. */
  readonly onConnect: (draft: TrialModelConnectionDraft) => Promise<TrialModelConnectionResult>
  readonly onCancel?: (() => void) | undefined
  readonly initialEndpoint?: string | undefined
  readonly initialModel?: string | undefined
  readonly headingLevel?: 2 | 3 | undefined
  readonly className?: string | undefined
}

interface SecretState {
  readonly identity: string | number | undefined
  readonly value: string
}

type Phase = 'idle' | 'submitting' | 'connected' | 'failed'

/**
 * Contained model connection form. It only collects three fields and calls main; it never fetches,
 * never writes browser storage, never logs and never sends a model request. The submitted key lives in
 * one local draft for the duration of the callback; JavaScript strings cannot be physically zeroed, so
 * the form clears every reference it owns and states that limit in the interface.
 */
export function TrialModelConnectionForm({
  availability = { enabled: true }, identity, onConnect, onCancel, initialEndpoint = '', initialModel = '',
  headingLevel = 3, className,
}: TrialModelConnectionFormProps) {
  const base = useId()
  const endpointId = `${base}-endpoint`
  const modelId = `${base}-model`
  const keyId = `${base}-key`
  const keyNoteId = `${base}-key-note`
  const formId = `${base}-form`
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const [endpoint, setEndpoint] = useState(initialEndpoint)
  const [model, setModel] = useState(initialModel)
  const [secret, setSecret] = useState<SecretState>({ identity, value: '' })
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [failure, setFailure] = useState<{ field?: TrialModelConnectionField; message: string }>()
  const [status, setStatus] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const draft = useRef<{ endpoint: string; model: string; apiKey: string } | undefined>(undefined)
  const mounted = useRef(true)
  const generation = useRef(0), currentIdentity = useRef(identity)
  currentIdentity.current = identity
  const endpointRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const apiKey = secret.identity === identity ? secret.value : ''
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++; if (draft.current !== undefined) draft.current.apiKey = '' }
  }, [])
  useEffect(() => {
    // Identity switch invalidates every typed value and the in-flight draft reference.
    setEndpoint(initialEndpoint)
    setModel(initialModel)
    setAllowInsecureHttp(false)
    generation.current++
    setSecret(current => current.identity === identity ? current : { identity, value: '' })
    setPhase('idle')
    setFailure(undefined)
    setStatus(undefined)
    setSubmitting(false)
    if (draft.current !== undefined) draft.current.apiKey = ''
    draft.current = undefined
  }, [identity])

  const disabled = !availability.enabled || submitting
  const focusInvalid = (field: TrialModelConnectionField | undefined) => {
    requestAnimationFrame(() => {
      if (field === 'endpoint') endpointRef.current?.focus()
      else if (field === 'model') modelRef.current?.focus()
      else if (field === 'apiKey') keyRef.current?.focus()
    })
  }
  const submit = async () => {
    if (disabled || draft.current) return
    const validation = trialModelConnectionDraft({ endpoint, model, apiKey, allowInsecureHttp }, availability)
    if (!validation.ok) {
      setFailure({ ...(validation.failure.kind === 'invalid' ? { field: validation.failure.field } : {}), message: validation.failure.message })
      setPhase('failed')
      focusInvalid(validation.failure.kind === 'invalid' ? validation.failure.field : undefined)
      return
    }
    const transient = { ...validation.draft }
    const submittedSecret = transient.apiKey, requestGeneration = generation.current, requestIdentity = identity
    const isCurrent = () => mounted.current && generation.current === requestGeneration && currentIdentity.current === requestIdentity
    draft.current = transient
    // Clear the field before any await so a slow or failing connection cannot keep the key visible.
    setSecret({ identity, value: '' })
    setSubmitting(true)
    setFailure(undefined)
    setStatus(undefined)
    setPhase('idle')
    try {
      const result = await onConnect(transient)
      if (!isCurrent()) return
      const message = trialConnectionMessage(result.message ?? (result.status === 'saved' ? '已保存到本机；尚未发送验证请求。' : result.status === 'connected' ? '连接已确认。' : undefined), submittedSecret)
      if (result.status === 'connected' || result.status === 'saved') {
        setPhase('connected')
        setStatus(message)
      } else {
        setPhase('failed')
        setFailure({ message: result.status === 'unsupported' ? trialConnectionMessage(result.message ?? '当前服务不支持网页配置，请使用本机配置文件。', submittedSecret) : message })
      }
    } catch (cause) {
      if (!isCurrent()) return
      const raw = cause instanceof Error ? cause.message : undefined
      setPhase('failed')
      setFailure({ message: trialConnectionMessage(raw, submittedSecret) })
    } finally {
      transient.apiKey = ''
      if (draft.current === transient) draft.current = undefined
      if (isCurrent()) setSubmitting(false)
    }
  }
  return (
    <section className={`trial-model-connection${className === undefined ? '' : ` ${className}`}`} aria-labelledby={`${base}-title`}>
      <header className="trial-model-heading">
        <div>
          <Heading className="trial-model-title" id={`${base}-title`}>配置对话模型</Heading>
        </div>
        <PlugZap size={18} aria-hidden="true" />
      </header>
      {!availability.enabled ? (
        <p className="trial-model-unavailable" role="status">
          当前设置未提供模型连接入口{availability.reason === undefined ? '。' : `：${trialConnectionMessage(availability.reason)}`}
        </p>
      ) : (
        <form id={formId} className="trial-model-form" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
          <label className="trial-model-field" htmlFor={endpointId}>
            <span><Link2 size={14} aria-hidden="true" />模型端点</span>
            <input ref={endpointRef} id={endpointId} name="trial-model-endpoint" type="url" inputMode="url" autoComplete="off"
              spellCheck={false} value={endpoint} disabled={disabled} maxLength={512}
              aria-invalid={failure?.field === 'endpoint' || undefined}
              aria-describedby={failure?.field === 'endpoint' ? `${base}-failure` : undefined}
              placeholder="https://…" onChange={event => { setEndpoint(event.target.value); setFailure(undefined); setPhase('idle') }} />
          </label>
          <label className="trial-model-field" htmlFor={modelId}>
            <span><PlugZap size={14} aria-hidden="true" />模型名称</span>
            <input ref={modelRef} id={modelId} name="trial-model-name" type="text" autoComplete="off" spellCheck={false}
              value={model} disabled={disabled} maxLength={128}
              aria-invalid={failure?.field === 'model' || undefined}
              aria-describedby={failure?.field === 'model' ? `${base}-failure` : undefined}
              placeholder="模型标识" onChange={event => { setModel(event.target.value); setFailure(undefined); setPhase('idle') }} />
          </label>
          <label className="trial-model-field" htmlFor={keyId}>
            <span><KeyRound size={14} aria-hidden="true" />API Key</span>
            <input ref={keyRef} id={keyId} name="trial-model-key" type="password" autoComplete="new-password"
              data-1p-ignore="true" data-lpignore="true" spellCheck={false} value={apiKey} disabled={disabled}
              maxLength={4096} aria-describedby={keyNoteId}
              aria-invalid={failure?.field === 'apiKey' || undefined}
              onChange={event => { setSecret({ identity, value: event.target.value }); setFailure(undefined); setPhase('idle') }} />
          </label>
          <p className="trial-model-key-note" id={keyNoteId}><ShieldCheck size={14} aria-hidden="true" />密钥保存在本机，提交后清空输入，不会回显。</p>
          {endpoint.trim().startsWith('http:') && <label className="settings-toggle"><input type="checkbox" checked={allowInsecureHttp} disabled={disabled}
            onChange={event => setAllowInsecureHttp(event.target.checked)} />允许未加密的 HTTP（密钥会随请求发送）</label>}
          {failure !== undefined && <p className="trial-model-failure" id={`${base}-failure`} role="alert">{failure.message}</p>}
          {status !== undefined && <p className="trial-model-status" role="status">{status}</p>}
          <div className="trial-model-actions">
            <button type="submit" className="trial-model-submit" disabled={disabled} aria-busy={submitting}>
              <Save size={14} aria-hidden="true" />{submitting ? '正在保存…' : '保存配置'}
            </button>
            {onCancel !== undefined && <button type="button" className="quiet" disabled={submitting} onClick={onCancel}>取消</button>}
          </div>
        </form>
      )}
    </section>
  )
}
