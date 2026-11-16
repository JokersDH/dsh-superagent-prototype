import { useEffect, useId, useRef, useState } from 'react'
import { KeyRound, Link2, PlugZap, ShieldCheck } from 'lucide-react'
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
  /** The only side effect: hand a transient draft to main. It must never persist or echo the key. */
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
  const [phase, setPhase] = useState<Phase>('idle')
  const [failure, setFailure] = useState<{ field?: TrialModelConnectionField; message: string }>()
  const [status, setStatus] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const draft = useRef<{ endpoint: string; model: string; apiKey: string } | undefined>(undefined)
  const mounted = useRef(true)
  const endpointRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const apiKey = secret.identity === identity ? secret.value : ''
  useEffect(() => () => {
    mounted.current = false
    if (draft.current !== undefined) draft.current.apiKey = ''
  }, [])
  useEffect(() => {
    // Identity switch invalidates every typed value and the in-flight draft reference.
    setEndpoint(initialEndpoint)
    setModel(initialModel)
    setSecret(current => current.identity === identity ? current : { identity, value: '' })
    setPhase('idle')
    setFailure(undefined)
    setStatus(undefined)
    setSubmitting(false)
    if (draft.current !== undefined) draft.current.apiKey = ''
    draft.current = undefined
  }, [identity, initialEndpoint, initialModel])

  const disabled = !availability.enabled || submitting
  const focusInvalid = (field: TrialModelConnectionField | undefined) => {
    requestAnimationFrame(() => {
      if (field === 'endpoint') endpointRef.current?.focus()
      else if (field === 'model') modelRef.current?.focus()
      else if (field === 'apiKey') keyRef.current?.focus()
    })
  }
  const submit = async () => {
    if (disabled) return
    const validation = trialModelConnectionDraft({ endpoint, model, apiKey }, availability)
    if (!validation.ok) {
      setFailure({ ...(validation.failure.kind === 'invalid' ? { field: validation.failure.field } : {}), message: validation.failure.message })
      setPhase('failed')
      focusInvalid(validation.failure.kind === 'invalid' ? validation.failure.field : undefined)
      return
    }
    const transient = { ...validation.draft }
    draft.current = transient
    // Clear the field before any await so a slow or failing connection cannot keep the key visible.
    setSecret({ identity, value: '' })
    setSubmitting(true)
    setFailure(undefined)
    setStatus(undefined)
    setPhase('idle')
    try {
      const result = await onConnect(transient)
      if (!mounted.current) return
      const message = trialConnectionMessage(result.message, transient.apiKey)
      if (result.status === 'connected') {
        setPhase('connected')
        setStatus(message)
      } else {
        setPhase('failed')
        setFailure({ message: result.status === 'unsupported' ? trialConnectionMessage(result.message ?? '当前设置不支持这条连接方式。', transient.apiKey) : message })
      }
    } catch (cause) {
      if (!mounted.current) return
      const raw = cause instanceof Error ? cause.message : undefined
      setPhase('failed')
      setFailure({ message: trialConnectionMessage(raw, transient.apiKey) })
    } finally {
      transient.apiKey = ''
      if (draft.current === transient) draft.current = undefined
      if (mounted.current) setSubmitting(false)
    }
  }
  return (
    <section className={`trial-model-connection${className === undefined ? '' : ` ${className}`}`} aria-labelledby={`${base}-title`}>
      <header className="trial-model-heading">
        <div>
          <Heading className="trial-model-title" id={`${base}-title`}>连接对话模型</Heading>
          <p className="trial-note">只提交到当前设置由主程序处理；配置存在不等于执行器已准入。</p>
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
          <p className="trial-model-key-note" id={keyNoteId}>
            <ShieldCheck size={14} aria-hidden="true" />密钥只用于本次连接请求，不写入浏览器存储、网址、日志或页面文本；提交后立即清空输入。脚本中的字符串无法物理擦除。
          </p>
          {failure !== undefined && <p className="trial-model-failure" id={`${base}-failure`} role="alert">{failure.message}</p>}
          {status !== undefined && <p className="trial-model-status" role="status">{status}</p>}
          <div className="trial-model-actions">
            <button type="submit" className="trial-model-submit" disabled={disabled} aria-busy={submitting}>
              {submitting ? '正在连接…' : phase === 'connected' ? '重新连接' : '连接模型'}
            </button>
            {onCancel !== undefined && <button type="button" className="quiet" disabled={submitting} onClick={onCancel}>取消</button>}
          </div>
          <p className="trial-note" aria-live="polite">
            {phase === 'connected' ? '连接结果由主程序确认；本页不显示密钥，也不会自动发起模型请求。' : '校验只检查字段本身；服务端保存、鉴权与跨域检查由主程序完成。'}
          </p>
        </form>
      )}
    </section>
  )
}
