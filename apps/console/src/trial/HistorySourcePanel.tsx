import { useId } from 'react'
import { ChevronDown, Clock3, History, Info, RefreshCw, ShieldAlert } from 'lucide-react'
import type { ContextHistory, ContextHistoryEntry, ContextSources } from '@personal-agent/contracts'
import type { TrialHistoryScope } from './history-source.ts'
import {
  trialHistoryAdmission, trialHistoryMessage, trialScopeReasonLabel, trialSourceExcerpt, trialSourceKindLabel,
  trialSourceStateLabel, trialSourcesAdmission,
} from './history-source.ts'
import './trial.css'

export interface HistorySourcePanelProps {
  /** Original A history page from main; the panel never fetches a page itself. */
  readonly history?: ContextHistory | undefined
  /** Project/conversation the surrounding screen belongs to; foreign pages are refused. */
  readonly scope?: TrialHistoryScope | undefined
  readonly selectedMessageId?: string | undefined
  readonly sources?: ContextSources | undefined
  readonly loading?: boolean | undefined
  readonly error?: 'failed' | 'stale' | undefined
  readonly loadingMore?: boolean | undefined
  readonly sourcesLoading?: boolean | undefined
  readonly sourcesError?: string | undefined
  readonly onSelect?: ((entry: ContextHistoryEntry) => void) | undefined
  readonly onLoadMore?: (() => void) | undefined
  readonly onRetry?: (() => void) | undefined
  readonly onOpenConversation?: ((conversationId: string) => void) | undefined
  readonly headingLevel?: 2 | 3 | undefined
  readonly className?: string | undefined
}

/**
 * A compact, read-only history/source browser. It shows original message identities, bounded source
 * bodies, live continuation and partial/missing states without turning any of them into a grant.
 */
export function HistorySourcePanel({
  history, scope = {}, selectedMessageId, sources, loading = false, error, loadingMore = false, sourcesLoading = false,
  sourcesError, onSelect, onLoadMore, onRetry, onOpenConversation, headingLevel = 3, className,
}: HistorySourcePanelProps) {
  const base = useId()
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const admission = history === undefined ? undefined : trialHistoryAdmission(history, scope)
  const page = admission?.ok === true ? admission.page : undefined
  const selected = page?.entries.find(entry => entry.messageId === selectedMessageId)
  const sourceAdmission = sources === undefined || selected === undefined || scope.projectId === undefined || scope.conversationId === undefined
    ? undefined
    : trialSourcesAdmission(sources, { messageId: selected.messageId, projectId: scope.projectId, conversationId: scope.conversationId })
  const sourceRefused = sources !== undefined && sourceAdmission !== undefined && sourceAdmission.ok === false
  const format = (value: string) => {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未读取'
  }
  return (
    <section className={`trial-history${className === undefined ? '' : ` ${className}`}`} aria-labelledby={`${base}-title`} aria-busy={loading || loadingMore}>
      <header className="trial-history-head">
        <div>
          <Heading className="trial-history-title" id={`${base}-title`}><History size={15} aria-hidden="true" />历史与来源</Heading>
          <p className="trial-note">原 Work/合同/消息身份只读呈现；续页是当前 keyset，不是冻结快照。</p>
        </div>
        {onRetry !== undefined && <button type="button" className="icon-button" title="重新读取历史" aria-label="重新读取历史" disabled={loading} onClick={onRetry}><RefreshCw size={15} /></button>}
      </header>
      {admission !== undefined && admission.ok === false && (
        <p className="trial-history-status" role="alert">
          {admission.reason === 'foreign_project' || admission.reason === 'foreign_conversation'
            ? '这批历史属于另一个项目或会话，已拒绝显示。'
            : admission.reason === 'duplicate_entry' ? '续页与已显示记录重叠，已拒绝合并。'
              : admission.reason === 'page_limit' ? '历史超过 200 条上限，请缩小范围。'
                : '历史续页不完整，已拒绝显示。'}
        </p>
      )}
      {error !== undefined && (
        <p className="trial-history-status" role="alert">
          {error === 'stale' ? '续页游标已过期或范围已变化，请重新读取。' : '历史暂时无法读取。'}
          {onRetry !== undefined && <button type="button" className="quiet" onClick={onRetry}>重试</button>}
        </p>
      )}
      {loading && page === undefined && <p className="trial-history-status" role="status">正在读取历史…</p>}
      {page !== undefined && page.entries.length === 0 && !loading && <p className="trial-history-status" role="status">当前范围暂无历史记录。</p>}
      {page !== undefined && page.entries.length > 0 && admission?.ok !== false && (
        <div className="trial-history-body">
          <ol className="trial-history-list" aria-label="历史记录列表">
            {page.entries.map(entry => (
              <li key={entry.messageId}>
                <button type="button" className="trial-history-row" aria-current={entry.messageId === selectedMessageId ? 'true' : undefined}
                  onClick={() => onSelect?.(entry)} disabled={onSelect === undefined}>
                  <span className="trial-history-meta"><Clock3 size={12} aria-hidden="true" /><time dateTime={entry.confirmedAt}>{format(entry.confirmedAt)}</time>
                    <span>{entry.sourceCount} 条来源</span>{entry.contract !== undefined && <span>合同版本 {entry.contract.revision}</span>}</span>
                  <span className="trial-history-text">{entry.message.state === 'available' ? entry.message.text : trialHistoryMessage.missing}
                    {entry.message.truncated ? ` · ${trialHistoryMessage.truncated}` : ''}</span>
                  <span className="trial-history-ids trial-mono">{entry.messageId}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="trial-history-continuation">
            {page.hasMore && page.entries.length < 200
              ? <button type="button" className="quiet" disabled={loadingMore || error !== undefined || onLoadMore === undefined} onClick={onLoadMore}>
                <ChevronDown size={14} aria-hidden="true" />{loadingMore ? '读取中…' : '更多记录'}
              </button>
              : <p className="trial-note">已显示 {page.entries.length} 条{page.hasMore ? '，达到 200 条上限' : '，没有更多记录'}。</p>}
            <span className="trial-note">读取于 {format(page.observedAt)}</span>
          </div>
        </div>
      )}
      {selected !== undefined && (
        <div className="trial-history-detail" aria-label="所选历史原文">
          <header className="trial-history-detail-head">
            <div><strong>原始上下文</strong><p>{format(selected.confirmedAt)} · {selected.sourceCount} 条来源</p></div>
            {onOpenConversation !== undefined && <button type="button" className="quiet" onClick={() => onOpenConversation(selected.conversationId)}>返回原会话</button>}
          </header>
          <p className="trial-history-message">{selected.message.state === 'available' ? selected.message.text : trialHistoryMessage.missing}</p>
          {sourcesLoading && <p className="trial-history-status" role="status">正在核验冻结来源…</p>}
          {sourcesError !== undefined && <p className="trial-history-status" role="alert">{sourcesError}</p>}
          {sourceRefused && <p className="trial-history-status" role="alert"><ShieldAlert size={14} aria-hidden="true" />来源身份与所选历史不一致，已拒绝显示。</p>}
          {sources !== undefined && sourceAdmission?.ok === true && (
            <div className="trial-history-sources">
              <p className="trial-history-source-state">{trialSourceStateLabel[sources.state]}</p>
              {sources.state === 'verified' ? (
                <ul>
                  {sources.sources.map(source => {
                    const excerpt = trialSourceExcerpt(source.content)
                    return (
                      <li key={source.sourceId}>
                        <details>
                          <summary>{source.title || trialSourceKindLabel[source.kind]}
                            <small>{trialSourceKindLabel[source.kind]} · {(source.bytes / 1024).toFixed(1)} KB{source.truncated ? ' · 来源已截断' : ''}</small>
                          </summary>
                          <pre>{excerpt.text}</pre>
                          {excerpt.truncated && <p className="trial-note">此处只展示原文前 1200 字符；完整冻结内容仍在原来源详情中。</p>}
                        </details>
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="trial-history-status">当前状态不展示冻结原文；这不会被当成完整的零条来源。</p>}
              {sources.omitted.length > 0 && <p className="trial-note">原记录另有 {sources.omitted.length} 项未纳入。</p>}
              {sources.injectionFlags.length > 0 && <p className="trial-history-status" role="status"><Info size={14} aria-hidden="true" />{sources.injectionFlags.length} 条来源含指令式文本，仅作数据。</p>}
              {sources.scopeReview !== undefined && (
                <section className="trial-history-scope" aria-label="来源范围说明">
                  <strong>范围说明</strong>
                  {sources.scopeReview.reasons.length === 0
                    ? <p>未发现范围变化。</p>
                    : <ul>{sources.scopeReview.reasons.map(reason => <li key={reason}>{trialScopeReasonLabel[reason]}</li>)}</ul>}
                  {sources.scopeReview.withheldSourceCount > 0 && <p>另有 {sources.scopeReview.withheldSourceCount} 条冻结来源未展示。</p>}
                </section>
              )}
            </div>
          )}
          <p className="trial-note">历史可读、来源可核对，都不构成发送、执行或批准权限。</p>
        </div>
      )}
    </section>
  )
}
