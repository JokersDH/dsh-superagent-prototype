import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileCheck2, RefreshCw } from 'lucide-react'
import type { ApplicationConfiguration, AssistantCandidatePrepare, AssistantCandidates, ConversationMessage, ProposalPreview } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

export type CandidateDraft = { selection: AssistantCandidatePrepare; preview: ProposalPreview; returnFocus?: HTMLButtonElement }
const labels = { propose_work: '创建工作', propose_revision: '修订工作', propose_decision: '记录决定' }

export function ReplyCandidates({ message, transport, configuration, onPrepared }: {
  message: ConversationMessage; transport: ConsoleTransport; configuration: ApplicationConfiguration;
  onPrepared(value: CandidateDraft): void
}) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [pending, setPending] = useState<number>()
  const [value, setValue] = useState<AssistantCandidates>(), [error, setError] = useState<string>()
  const sequence = useRef(0), sourceId = message.sourceRefs[0]
  useEffect(() => () => { sequence.current++ }, [])
  const read = async () => {
    if (!sourceId || !transport.replyCandidates || loading || pending !== undefined) return
    const request = ++sequence.current
    setLoading(true); setError(undefined); setValue(undefined)
    try {
      const result = await transport.replyCandidates(sourceId)
      if (result.replyMessageId !== message.id || result.projectId !== message.projectId || result.conversationId !== message.conversationId)
        throw new Error('Candidate source changed')
      if (request === sequence.current) setValue(result)
    } catch { if (request === sequence.current) setError('建议暂时无法核对，请重新读取。') }
    finally { if (request === sequence.current) setLoading(false) }
  }
  const prepare = async (candidate: AssistantCandidates['candidates'][number], returnFocus: HTMLButtonElement) => {
    if (!sourceId || !transport.prepareReplyCandidate || loading || pending !== undefined) return
    const request = ++sequence.current, selection = { messageId: sourceId, index: candidate.index, payloadDigest: candidate.payloadDigest }
    setPending(candidate.index); setError(undefined)
    try {
      const preview = await transport.prepareReplyCandidate(selection)
      if (preview.record.projectId !== message.projectId || preview.record.conversationId !== message.conversationId)
        throw new Error('Candidate preview source changed')
      if (request === sequence.current) onPrepared({ selection, preview, returnFocus })
    } catch { if (request === sequence.current) setError('建议或授权已变化，请重新读取后再预览。') }
    finally { if (request === sequence.current) setPending(undefined) }
  }
  const project = configuration.projects.find(project => project.id === message.projectId)
  return <details className="reply-candidates" open={open} onToggle={event => {
    const next = event.currentTarget.open; setOpen(next)
    if (next && !value && !error) void read()
  }}>
    <summary><FileCheck2 size={14} /><span>提案建议</span>{value && <span className="mini">{value.candidates.length}</span>}<ChevronDown size={14} /></summary>
    <div className="reply-candidate-body">
      <div className="reply-candidate-heading"><span>{loading ? '正在读取' : value?.status === 'candidates' ? '待审阅' : '建议'}</span>
        <button type="button" className="icon-button" title="重新读取建议" aria-label="重新读取建议" disabled={loading || pending !== undefined} onClick={() => void read()}><RefreshCw size={14} /></button></div>
      {error && <p role="alert" className="warn-text">{error}</p>}
      {!loading && value?.status === 'unavailable' && <p className="context-line" role="status">原回复结果暂不可用。</p>}
      {!loading && value?.status === 'none' && !value.rejected.length && <p className="context-line" role="status">暂无提案建议。</p>}
      {!!value?.candidates.length && <ul aria-label="回复提案建议">{value.candidates.map(candidate => {
        const unavailable = !configuration.proposalsAvailable || !transport.prepareReplyCandidate ||
          (candidate.kind !== 'propose_decision' && !project?.dispatchAllowed)
        return <li key={candidate.index}>
          <div><div className="reply-candidate-kind"><strong>{labels[candidate.kind]}</strong><span className="mini">{candidate.requiredInputs.length ? '需补全' : '待确认'}</span></div>
            <p title={candidate.summary}>{candidate.summary}</p></div>
          <button type="button" className="quiet" title={error ? '请重新读取建议' : unavailable ? '当前项目不可准备此提案' : `预览${labels[candidate.kind]}建议`}
            aria-label={`预览${labels[candidate.kind]}建议`} disabled={unavailable || !!error || loading || pending !== undefined} onClick={event => void prepare(candidate, event.currentTarget)}>
            <FileCheck2 size={14} />{pending === candidate.index ? '正在准备' : '预览提案'}</button>
        </li>
      })}</ul>}
      {!!value?.rejected.length && <p className="context-line" role="status">{value.rejected.length} 项建议当前不可用。</p>}
    </div>
  </details>
}
