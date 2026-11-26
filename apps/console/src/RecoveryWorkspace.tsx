import { useEffect, useState } from 'react'
import type { RecoveryInspection, RecoverySourcePrepared, RecoveryTargetStatus, RecoveryTargetAuthorization } from '@personal-agent/contracts'
import { RecoverySourcePreparedSchema, RecoveryTargetStatusSchema } from '@personal-agent/contracts'
import { z } from 'zod'
import type { ConsoleTransport } from './transport.ts'
import { TransportError } from './transport.ts'

const pendingKey = 'personal-agent:recovery-target-pending'
const PendingSchema = z.strictObject({ prepared: RecoverySourcePreparedSchema, target: RecoveryTargetStatusSchema.optional(), unknown: z.boolean() })
function remembered() {
  try { const raw = sessionStorage.getItem(pendingKey); return { value: raw ? PendingSchema.parse(JSON.parse(raw)) : undefined, damaged: false } }
  catch { return { value: undefined, damaged: true } }
}

/** Local preparation state only. Authority and progress come exclusively from the original server. */
export function RecoveryWorkspace({ transport }: { transport: ConsoleTransport }) {
  const [initial] = useState(remembered)
  const [inspection, setInspection] = useState<RecoveryInspection>(), [prepared, setPrepared] = useState<RecoverySourcePrepared | undefined>(initial.value?.prepared)
  const [target, setTarget] = useState<RecoveryTargetStatus | undefined>(initial.value?.target), [authorization, setAuthorization] = useState<RecoveryTargetAuthorization>()
  const [selected, setSelected] = useState(''), [path, setPath] = useState(''), [targetRoot, setTargetRoot] = useState('')
  const [check, setCheck] = useState<'node_test' | 'npm_test' | 'pnpm_test'>('node_test')
  const [busy, setBusy] = useState(false), [error, setError] = useState(initial.damaged ? '原恢复请求无法读取，请保留当前材料并查看诊断，避免创建重复授权。' : ''), [unknown, setUnknown] = useState(initial.value?.unknown ?? false)
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    let current = true
    transport.recoveryInspection?.().then(value => {
      if (current) { setInspection(value); setSelected(value.projects[0]?.id ?? '') }
    }).catch(() => { if (current) setError('恢复状态暂不可读，请刷新页面后核对。') })
    return () => { current = false }
  }, [transport])
  const act = async (run: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await run() }
    catch (problem) { setError(problem instanceof TransportError ? problem.message : '操作尚未完成，请保留当前恢复材料并核对。') }
    finally { setBusy(false) }
  }
  const preview = () => act(async () => {
    if (!transport.prepareRecoverySource || !transport.recoveryInspection) return
    const fresh = await transport.recoveryInspection()
    setInspection(fresh)
    const value = await transport.prepareRecoverySource({ preflight: { expectedFingerprint: fresh.inspectionFingerprint,
      bindings: [{ sourceProjectId: selected, project: { path, check } }] }, targetStateRoot: targetRoot })
    sessionStorage.setItem(pendingKey, JSON.stringify({ prepared: value, unknown: false }))
    setPrepared(value)
  })
  const prepareTarget = () => act(async () => {
    if (!prepared || !transport.confirmRecoverySource || !transport.prepareRecoveryTarget) return
    // Reuse this exact signed confirmation if its response is lost. No new source IDs are minted.
    const source = await transport.confirmRecoverySource({ token: prepared.token })
    if (JSON.stringify(source.committed.intent) !== JSON.stringify(prepared.intent)) throw new Error('恢复来源确认身份不一致。')
    const value = await transport.prepareRecoveryTarget({ activationId: source.committed.intent.activationId, configuration: prepared.configuration })
    sessionStorage.setItem(pendingKey, JSON.stringify({ prepared, target: value, unknown: false }))
    setTarget(value)
  })
  const authorize = () => act(async () => {
    if (!prepared || !target?.material || !target.authorizationCommandId || !transport.authorizeRecoveryTarget) return
    sessionStorage.setItem(pendingKey, JSON.stringify({ prepared, target, unknown: true }))
    setUnknown(true)
    const result = await transport.authorizeRecoveryTarget({ activationId: target.activationId, commandId: target.authorizationCommandId,
      configuration: prepared.configuration, expectedManifestDigest: target.material.manifestDigest, confirmNewExecution: true })
    sessionStorage.setItem(pendingKey, JSON.stringify({ prepared, target, unknown: true }))
    setAuthorization(result); setUnknown(false)
  })
  const reconcile = () => act(async () => {
    if (!target || !transport.recoveryAuthorization) return
    const result = await transport.recoveryAuthorization(target.activationId)
    if (result) { setAuthorization(result); setUnknown(false) }
    else setError('尚未查到原授权回执。请保留当前请求与目标，不重新创建另一份授权。')
  })
  const editable = !prepared && !busy
  const ready = target?.step === 'inventory_complete' && target.blockers.length === 0 && !!target.authorizationCommandId
  return <section className="recovery-workspace" aria-label="恢复后新授权" aria-busy={busy}>
    <header><h2>在新工作区继续使用</h2><p>历史记录保持只读。重新选择本机项目和检查后，明确授权新的工作区；旧任务会留在原处。</p></header>
    {!inspection ? <p role="status">正在核对恢复来源…</p> : <>
      <dl className="recovery-facts"><div><dt>历史项目</dt><dd>{inspection.projects.length} 个</dd></div><div><dt>保留的任务队列</dt><dd>{inspection.heldQueue.waiting + inspection.heldQueue.parked} 项</dd></div></dl>
      {!prepared && <form onSubmit={event => { event.preventDefault(); void preview() }}>
        <label>恢复来源项目<select value={selected} onChange={event => setSelected(event.target.value)} disabled={!editable}>
          {inspection.projects.map(project => <option key={project.id} value={project.id}>{project.displayName}</option>)}</select></label>
        <label>本机 Git 项目路径<input value={path} onChange={event => setPath(event.target.value)} disabled={!editable} required autoComplete="off" placeholder="选择已经提交、检查可运行的项目" /></label>
        <label>项目现有检查<select value={check} onChange={event => setCheck(event.target.value as typeof check)} disabled={!editable}>
          <option value="node_test">node --test</option><option value="npm_test">npm test</option><option value="pnpm_test">pnpm test</option></select></label>
        <label>新工作区路径<input value={targetRoot} onChange={event => setTargetRoot(event.target.value)} disabled={!editable} required autoComplete="off" placeholder="私有目录内尚不存在的新目录" /></label>
        <p className="muted">目标应位于已有的私有工作区目录内，与恢复来源分开；末级目录名使用字母、数字或短横线。</p>
        <button type="submit" className="primary" disabled={initial.damaged || busy || !selected || !path.trim() || !targetRoot.trim()}>{busy ? '正在核对…' : '核对项目与执行器'}</button>
      </form>}
      {prepared && <div className="recovery-prepared">
        <h3>确认新的执行范围</h3>
        <dl><dt>本机项目</dt><dd>{prepared.configuration.projects.map(project => project.registration.path).join('、')}</dd>
          <dt>新工作区</dt><dd>{prepared.intent.target.stateRoot}</dd><dt>开发执行器</dt><dd>{prepared.configuration.executor.profileId} · {prepared.plan.executor?.version}</dd></dl>
        {!target && <button type="button" disabled={busy} onClick={() => void prepareTarget()}>{busy ? '正在准备…' : '确认来源并准备新工作区'}</button>}
      </div>}
      {target && !authorization && <>
        {target.blockers.length > 0 && <ul role="status">{target.blockers.map(blocker => <li key={blocker.code}>{blocker.detail}</li>)}</ul>}
        {ready && <label className="recovery-confirm"><input type="checkbox" checked={confirmed} disabled={busy || unknown} onChange={event => setConfirmed(event.target.checked)} />我允许这个新工作区使用上述本机项目和执行器。旧任务和旧权限不迁移。</label>}
        {unknown ? <button type="button" disabled={busy} onClick={() => void reconcile()}>查询原授权结果</button>
          : <button type="button" className="primary" disabled={busy || !ready || !confirmed} onClick={() => void authorize()}>{busy ? '正在提交…' : '授予新执行授权'}</button>}
      </>}
      {authorization && <div className="recovery-result" role="status"><h3>新授权已记录</h3><p>历史工作保持原样。通过安装应用打开已授权的新工作区后，可以明确委托新的任务。</p><p>新工作区：{authorization.grant.material.stateRoot}</p><p className="muted">授权回执不表示服务或任务已经启动。</p></div>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
