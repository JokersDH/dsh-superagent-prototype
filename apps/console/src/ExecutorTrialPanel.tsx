import { useState } from 'react'
import { ExecutorTrialCommandSchema } from '@personal-agent/contracts'
import type { ExecutionProfileView, ExecutorTrialCommand, ExecutorTrialInspection, ExecutorTrialReceipt } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'
import { TransportError } from './transport.ts'

const pendingKey = 'personal-agent:executor-trial-command'
function remembered() {
  try { const raw = sessionStorage.getItem(pendingKey); return { command: raw ? ExecutorTrialCommandSchema.parse(JSON.parse(raw)) : undefined, damaged: false } }
  catch { return { command: undefined, damaged: true } }
}
const labels = { verified: '原生验证通过', compatible_unverified: '协议兼容 · 版本尚未实测', incompatible: '协议不兼容', unknown: '检查信息不完整' }

export function ExecutorTrialPanel({ transport, profiles = [] }: { transport: ConsoleTransport; profiles?: readonly ExecutionProfileView[] }) {
  const [initial] = useState(remembered)
  const [pending, setPending] = useState<ExecutorTrialCommand | undefined>(initial.command)
  const [choice, setChoice] = useState(initial.command?.profileId ?? '')
  const selected = choice || profiles[0]?.id
  const selectedProfile = profiles.find(profile => profile.id === selected)
  const [inspection, setInspection] = useState<ExecutorTrialInspection>(), [receipt, setReceipt] = useState<ExecutorTrialReceipt>()
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState(initial.damaged ? '原同意请求暂不可读，请保留当前工作区并查看诊断。' : '')
  const act = async (run: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await run() } catch (problem) { setError(problem instanceof TransportError ? problem.message : '版本检查尚未完成，请保留原请求并核对。') }
    finally { setBusy(false) }
  }
  const inspect = () => act(async () => {
    if (!transport.inspectExecutorTrial) return
    setInspection(undefined); setConfirmed(false); setUnavailable(false)
    const value = await transport.inspectExecutorTrial(selected)
    setInspection(value); setUnavailable(!value); setConfirmed(false)
  })
  const consent = () => act(async () => {
    if (!inspection || !confirmed || !transport.confirmExecutorTrial || pending || initial.damaged) return
    const command = ExecutorTrialCommandSchema.parse({ commandId: inspection.confirmationCommandId, profileId: inspection.profile.id,
      revision: inspection.profile.revision, identityDigest: inspection.identityDigest, policyDigest: inspection.policyDigest, confirmUnverifiedVersion: true })
    sessionStorage.setItem(pendingKey, JSON.stringify(command))
    setPending(command)
    try {
      const value = await transport.confirmExecutorTrial(command)
      setReceipt(value); setPending(undefined); sessionStorage.removeItem(pendingKey)
    } catch (problem) {
      if (problem instanceof TransportError && ['invalid_request', 'forbidden', 'auth_required', 'conflict', 'unsupported_capability'].includes(problem.code)) {
        sessionStorage.removeItem(pendingKey); setPending(undefined); setInspection(undefined); setConfirmed(false)
      }
      throw problem
    }
  })
  const reconcile = () => act(async () => {
    if (!pending || !transport.executorTrialReceipt) return
    const value = await transport.executorTrialReceipt(pending.commandId)
    if (value) { setReceipt(value); setPending(undefined); sessionStorage.removeItem(pendingKey) }
    else setError('尚未查到原同意回执。请保留这个请求，核对服务状态后再查询。')
  })
  if (!transport.inspectExecutorTrial) return null
  return <section className="executor-trial" aria-label="执行器版本检查" aria-busy={busy}>
    <h3>执行器版本检查</h3>
    <p>版本不同会先核对协议和当前策略。检查不发送模型任务，也不会自动允许编码。</p>
    {profiles.length > 0 && <label>检查执行器
      <select aria-label="检查执行器" value={selected} disabled={busy || !!pending || initial.damaged} onChange={event => {
        setChoice(event.target.value); setInspection(undefined); setConfirmed(false); setReceipt(undefined); setUnavailable(false); setError('')
      }}>
        {choice && !profiles.some(profile => profile.id === choice) && <option value={choice}>待核对的原执行器</option>}
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}
      </select>
    </label>}
    {selectedProfile?.driverId === 'acp-v1' && <p>标准 ACP v1。当前 DSH 配置开放文件读写与编辑，检查由工作台运行；运行中补充、原生会话恢复和结构化澄清尚未开放。</p>}
    {!pending && !receipt && <button type="button" disabled={busy || initial.damaged} onClick={() => void inspect()}>{busy ? '正在检查…' : '检查版本兼容'}</button>}
    {unavailable && <p role="status">当前执行器无需试用确认，或此安装尚未提供检查入口。执行可用性以工作台当前状态为准。</p>}
    {inspection && <div className="executor-trial-facts"><strong>{labels[inspection.profile.compatibility?.classification ?? 'unknown']}</strong><p>{inspection.profile.compatibility?.nativeVersion ?? '版本尚未核实'}</p>
      {inspection.confirmationAvailable && !pending && !receipt && inspection.authorization !== 'granted' && <>
        <label className="executor-trial-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
          我理解此版本尚未完成真实任务验证，同意仅按当前检测身份和策略试用。每项任务仍需明确委托。</label>
        <button type="button" className="primary" disabled={busy || !confirmed} onClick={() => void consent()}>记录此版本的试用同意</button>
      </>}
      {!inspection.confirmationAvailable && <p>缺少完整兼容或策略信息，当前不能开放试用。请使用已验证版本或等待针对该版本的支持。</p>}
      {inspection.authorization === 'granted' && !receipt && <p role="status">当前身份的同意已记录；请正常退出并重新打开自己的实例，再核对执行器状态。</p>}
    </div>}
    {pending && <div role="status"><p>同意请求的结果尚待核对，不会自动再发。</p><button type="button" disabled={busy} onClick={() => void reconcile()}>查询原同意结果</button></div>}
    {receipt && <p role="status">试用同意已记录。请正常退出并重新打开自己的实例；启动时会重新核对身份和策略，当前任务没有自动开始。</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>
}
