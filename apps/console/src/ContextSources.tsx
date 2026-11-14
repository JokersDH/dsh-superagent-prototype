import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, FileSearch, Info, RefreshCw } from 'lucide-react'
import type { AssistantContextBinding, ContextPreview, ContextSources } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

export const contextKindLabel: Record<ContextPreview['sources'][number]['kind'], string> = {
  work: '工作', contract: '工作合同', verification: '验证', delivery: '接受记录', decision: '项目决定',
  project_metadata: '项目信息', conversation_message: '会话消息', artifact: '交付元数据',
}
export const contextSize = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
type Source = ContextPreview['sources'][number]
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function readable(source: Source) {
  let parsed: unknown
  try { parsed = JSON.parse(source.content) } catch { return { content: <pre>{source.content}</pre>, structured: false } }
  const value = object(parsed), work = object(value?.work), scope = object(value?.scope)
  const text = value && (typeof value.text === 'string' ? value.text : typeof value.content === 'string' ? value.content
    : typeof value.goal === 'string' ? value.goal : typeof work?.title === 'string' ? work.title
      : typeof value.displayName === 'string' ? value.displayName : undefined)
  if (!text) return { content: <pre>{JSON.stringify(parsed, null, 2)}</pre>, structured: false }
  const criteria = Array.isArray(value.criteria) ? value.criteria.flatMap(item => {
    const criterion = object(item)
    return typeof criterion?.description === 'string' ? [criterion.description] : []
  }).slice(0, 64) : []
  const paths = Array.isArray(scope?.allowedPaths) ? scope.allowedPaths.filter((path): path is string => typeof path === 'string').slice(0, 64) : []
  return { structured: true, content: <div className="context-readable"><p>{text}</p>
    {criteria.length > 0 && <><h4>验收标准</h4><ul>{criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></>}
    {paths.length > 0 && <dl><dt>范围</dt><dd>{paths.map(path => <code key={path}>{path}</code>)}</dd></dl>}
  </div> }
}
function SourceItem({ source }: { source: Source }) {
  const [copied, setCopied] = useState(false), [failed, setFailed] = useState(false)
  useEffect(() => { setCopied(false); setFailed(false) }, [source.content])
  const view = readable(source)
  const copy = async () => {
    setFailed(false)
    try { await navigator.clipboard.writeText(source.content); setCopied(true) }
    catch { setFailed(true) }
  }
  return <details className="context-source">
    <summary><FileSearch size={15} /><span><strong>{source.title || contextKindLabel[source.kind]}</strong>
      <small>{contextKindLabel[source.kind]} · {contextSize(source.bytes)} · 约 {Math.ceil(source.estimatedTokens)} tokens{source.truncated ? ' · 已截断' : ''}</small></span><ChevronDown size={14} /></summary>
    {view.content}
    <div className="context-source-tools"><button type="button" className="icon-button" title={copied ? '已复制原始内容' : '复制原始内容'} aria-label={copied ? '已复制原始内容' : '复制原始内容'} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      {failed && <span role="alert">复制未完成</span>}
      <details className="context-source-record"><summary>{view.structured ? '摘要与原始记录' : '校验摘要'}</summary>
        <dl><dt>来源摘要</dt><dd><code>{source.sourceDigest}</code></dd><dt>内容摘要</dt><dd><code>{source.previewDigest}</code></dd></dl>
        {view.structured && <pre>{source.content}</pre>}
      </details>
    </div>
  </details>
}
export function ContextSourceList({ sources }: { sources: ContextPreview['sources'] }) {
  return <div className="context-source-list">{sources.map(source => <SourceItem key={source.sourceId} source={source} />)}</div>
}

/** Mounted only when the user opens an audit or selects a history entry. */
export function ContextSourceRecord({ transport, messageId, projectId, conversationId, binding }: {
  transport: ConsoleTransport; messageId: string; projectId: string; conversationId: string; binding?: AssistantContextBinding
}) {
  return <SourceRecord key={JSON.stringify([projectId, conversationId, messageId, binding?.requestId, binding?.bundleDigest])}
    transport={transport} messageId={messageId} projectId={projectId} conversationId={conversationId} {...(binding ? { binding } : {})} />
}

const scopeReasonLabel: Record<NonNullable<ContextSources['scopeReview']>['reasons'][number], string> = {
  project_changed: '所属项目与冻结时不同', selection_narrowed: '当前允许路径比冻结时更窄',
  selection_broadened: '当前允许路径比冻结时更宽', selection_replaced: '允许路径已变化',
  exclusion_added: '新增了排除路径', exclusion_removed: '移除了排除路径', selection_validity_changed: '选择有效期与冻结时不同',
}
const sourceStateLabel = { verified: '已核对冻结原文', missing: '冻结原文文件缺失', unverified: '无法核对冻结原文', scope_changed: '当前只读选择与冻结时不同' }

function SourceRecord({ transport, messageId, projectId, conversationId, binding }: {
  transport: ConsoleTransport; messageId: string; projectId: string; conversationId: string; binding?: AssistantContextBinding
}) {
  const [view, setView] = useState<ContextSources>(), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  const [missing, setMissing] = useState(false), [refresh, setRefresh] = useState(0), sequence = useRef(0)
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'loading' | 'failed' | 'unavailable' | 'loaded'>('idle')
  const validateIdentity = (result: ContextSources) => {
    if (result.binding.projectId !== projectId || result.binding.conversationId !== conversationId ||
      result.binding.messageId !== messageId || (binding && (result.binding.requestId !== binding.requestId || result.binding.bundleDigest !== binding.bundleDigest)))
      throw new Error('Historical source identity mismatch')
  }
  useEffect(() => {
    const request = ++sequence.current
    setView(undefined); setLoading(true); setFailed(false); setMissing(false); setReviewStatus('idle')
    void (async () => {
      try {
        const result = await transport.contextSources?.(messageId)
        if (request !== sequence.current) return
        if (result) validateIdentity(result)
        setView(result); setMissing(!result)
      } catch { if (request === sequence.current) setFailed(true) }
      finally { if (request === sequence.current) setLoading(false) }
    })()
    return () => { sequence.current++ }
  }, [transport, messageId, projectId, conversationId, binding, refresh])
  const loadReview = async () => {
    if (reviewStatus === 'loading') return
    const request = sequence.current
    setReviewStatus('loading')
    try {
      const result = await transport.contextSources?.(messageId, { scopeReview: true })
      if (request !== sequence.current) return
      if (result) { validateIdentity(result); setView(result) }
      setReviewStatus(result?.scopeReview ? 'loaded' : 'unavailable')
    } catch { if (request === sequence.current) setReviewStatus('failed') }
  }
  const retry = <button type="button" className="icon-button" title="重新读取来源正文" aria-label="重新读取来源正文" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /></button>
  if (loading) return <p className="context-record-status" role="status">正在读取原始来源</p>
  if (failed) return <p className="context-record-status local-error" role="alert">来源正文暂时无法核对{retry}</p>
  if (missing) return binding ? <ul className="context-binding-sources">{binding.sources.map(source => <li key={source.sourceId}><span>{contextKindLabel[source.kind]}{source.truncated ? ' · 已截断' : ''}</span><code>{source.previewDigest}</code></li>)}</ul>
    : <p className="context-record-status" role="status">来源记录已缺失{retry}</p>
  if (!view) return null
  return <section className="context-frozen-sources" aria-label="原始上下文内容">
    <div className="context-record-heading"><span>{sourceStateLabel[view.state]}</span><div className="context-record-actions">
      <button type="button" className="quiet context-scope-action" aria-disabled={reviewStatus === 'loading'} aria-busy={reviewStatus === 'loading'} onClick={() => void loadReview()}>
        <Info size={14} aria-hidden="true" />{reviewStatus === 'loading' ? '正在读取范围' : reviewStatus === 'failed' ? '重试范围说明' : reviewStatus === 'loaded' ? '刷新范围说明' : '查看范围说明'}</button>{retry}
    </div></div>
    {view.state === 'verified' ? <>
      <div className="context-record-summary"><span>{view.sources.length} 条原始来源</span>{view.sources.some(source => source.truncated) && <span>包含截断记录</span>}</div>
      {view.injectionFlags.length > 0 && <p className="context-warning">{view.injectionFlags.length} 条来源含指令式文本</p>}
      <ContextSourceList sources={view.sources} />
      {view.omitted.length > 0 && <p className="context-record-status">原记录未纳入 {view.omitted.length} 项</p>}
    </> : <p className="context-record-status context-warning" role="status">{view.state === 'scope_changed' ? '冻结原文未展示' : view.state === 'missing' ? '当时的原文文件无法读取' : '原文或回执校验未通过'}</p>}
    {reviewStatus === 'failed' && <p className="context-record-status local-error" role="alert">范围说明暂时无法读取</p>}
    {reviewStatus === 'unavailable' && <p className="context-record-status" role="status">范围说明暂不可用</p>}
    {reviewStatus !== 'idle' && view.scopeReview && <section className="context-scope-review" aria-label="来源范围说明" aria-live="polite" aria-busy={reviewStatus === 'loading'}>
      <header><Info size={14} aria-hidden="true" /><h4>范围说明</h4>{view.scopeReview.partial && <span>原文未展示</span>}</header>
      {view.scopeReview.reasons.length > 0 ? <ul>{view.scopeReview.reasons.map(reason => <li key={reason}>{scopeReasonLabel[reason]}</li>)}</ul>
        : view.state === 'verified' && <p>未发现范围变化</p>}
      {view.scopeReview.withheldSourceCount > 0 && <p className="context-scope-withheld">另有 {view.scopeReview.withheldSourceCount} 条冻结来源未展示</p>}
    </section>}
  </section>
}
