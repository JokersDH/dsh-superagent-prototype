/**
 * TEST HARNESS for the trial workspace. It mounts the real component with schema-validated fixture
 * props, or with the real HttpTransport against an isolated local product demo. It is not part of the
 * application bundle: main mounts TrialWorkspace from src/trial in App.tsx. The banner and controls
 * around the component exist only so screenshots cannot be mistaken for a product pass.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { ApplicationConfiguration, ContextHistory, TrialReadiness, TrialNavigationAction } from '@personal-agent/contracts'
import { HttpTransport } from '../../src/transport.ts'
import { TrialWorkspace } from '../../src/trial/TrialWorkspace.tsx'
import { TrialModelConnectionForm } from '../../src/trial/ModelConnectionForm.tsx'
import { HistorySourcePanel } from '../../src/trial/HistorySourcePanel.tsx'
import { trialHistoryMerge } from '../../src/trial/history-source.ts'
import { useTrialReadiness } from '../../src/trial/useTrialReadiness.ts'
import type { TrialHarnessState } from './fixtures.ts'
import { trialHarnessProps, trialProbePair, trialStates } from './fixtures.ts'
import '../../src/styles.css'
import '../../src/workbench.css'
import './harness.css'

declare global {
  interface Window {
    __TRIAL_ACTIONS__?: string[]
    __TRIAL_RELOADS__?: number
    __TRIAL_REQUESTS__?: string[]
    __TRIAL_BOOTSTRAP__?: string
    __TRIAL_BOOTSTRAP_ERROR__?: string
    __TRIAL_A_READS__?: number
    __TRIAL_B_READS__?: number
    __TRIAL_INLINE_READS__?: number
    __TRIAL_DISABLED_READS__?: number
    __TRIAL_AUTH_READS__?: number
    __TRIAL_RECIPES__?: string[]
    __TRIAL_RECIPE_SELECTION__?: unknown
    __TRIAL_WINDOWS__?: number[]
    __TRIAL_EXPORTS__?: number
    __TRIAL_RECIPE_RELOADS__?: number
    __TRIAL_SAME_READS__?: number
    __TRIAL_MODEL_CALLS__?: { endpoint: string; model: string; apiKey: string }[]
  }
}

const actions: string[] = []
const requests: string[] = []
window.__TRIAL_ACTIONS__ = actions
window.__TRIAL_RELOADS__ = 0
window.__TRIAL_REQUESTS__ = requests
window.__TRIAL_A_READS__ = 0
window.__TRIAL_B_READS__ = 0
window.__TRIAL_INLINE_READS__ = 0
window.__TRIAL_DISABLED_READS__ = 0
window.__TRIAL_RECIPES__ = []
window.__TRIAL_WINDOWS__ = []
window.__TRIAL_EXPORTS__ = 0
window.__TRIAL_RECIPE_RELOADS__ = 0
window.__TRIAL_MODEL_CALLS__ = []
const nativeFetch = window.fetch.bind(window)
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  requests.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  return nativeFetch(input as RequestInfo, init)
}) as typeof window.fetch

const writeLog = (text: string) => {
  const element = document.querySelector('[data-harness-log]')
  if (element) element.textContent = text
}
const record = (action: TrialNavigationAction) => {
  actions.push(action)
  window.dispatchEvent(new CustomEvent('trial-action', { detail: action }))
  writeLog(`callback: ${actions.join(', ')}`)
}

function HarnessFrame({ children, controls }: { readonly children: ReactNode; readonly controls?: ReactNode }) {
  return (
    <div className="harness-app">
      <div className="harness-banner" role="note">测试装置 · 受控样例，不是产品界面或发布证明</div>
      <div className="harness-column">{children}</div>
      {controls !== undefined && <div className="harness-controls">{controls}</div>}
      <div className="harness-log" data-harness-log aria-label="测试记录">idle</div>
    </div>
  )
}

function PropsHarness({ state }: { readonly state: TrialHarnessState }) {
  const props = useMemo(() => trialHarnessProps(state), [state])
  const [reloads, setReloads] = useState(0)
  return (
    <HarnessFrame>
      <TrialWorkspace
        readiness={props.readiness}
        configuration={props.configuration}
        loading={props.loading}
        error={props.error}
        unavailable={props.unavailable}
        activeProjectId={props.activeProjectId}
        activeConversationTitle={props.activeConversationTitle}
        insights={props.insights}
        recipes={props.recipes}
        recipesLoading={props.recipesLoading}
        recipesError={props.recipesError}
        onReloadRecipes={() => { window.__TRIAL_RECIPE_RELOADS__ = (window.__TRIAL_RECIPE_RELOADS__ ?? 0) + 1 }}
        insightWindow={props.insightWindow}
        insightsLoading={props.insightsLoading}
        insightsError={props.insightsError}
        insightsDownloading={props.insightsDownloading}
        insightsDownloadError={props.insightsDownloadError}
        onDownloadInsights={props.noExport ? undefined : () => { window.__TRIAL_EXPORTS__ = (window.__TRIAL_EXPORTS__ ?? 0) + 1 }}
        support={props.support}
        onSelectInsightWindow={props.insightWindow === undefined ? undefined : days => { window.__TRIAL_WINDOWS__?.push(days) }}
        onOpenRecipe={selection => {
          window.__TRIAL_RECIPES__?.push(selection.suggestionId)
          window.__TRIAL_RECIPE_SELECTION__ = selection
          writeLog(`recipe: ${selection.suggestionId}`)
        }}
        onAction={record}
        onReload={() => {
          const next = reloads + 1
          setReloads(next)
          window.__TRIAL_RELOADS__ = next
          writeLog(`reload: ${next}`)
        }}
      />
    </HarnessFrame>
  )
}

function HttpHarness() {
  const transport = useMemo(() => new HttpTransport(), [])
  const [phase, setPhase] = useState<'boot' | 'ready' | 'error'>('boot')
  const [configuration, setConfiguration] = useState<ApplicationConfiguration>()
  const [mounted, setMounted] = useState(true)
  useEffect(() => {
    const token = window.__TRIAL_BOOTSTRAP__
    if (token === undefined || !/^[a-f0-9]{64}$/.test(token)) {
      window.__TRIAL_BOOTSTRAP_ERROR__ = 'missing bootstrap token'
      setPhase('error')
      return
    }
    let active = true
    void transport.bootstrap(token).then(() => {
      if (active) setPhase('ready')
    }).catch((error: unknown) => {
      if (active) {
        window.__TRIAL_BOOTSTRAP_ERROR__ = error instanceof Error ? error.message : 'bootstrap failed'
        setPhase('error')
      }
    })
    return () => { active = false }
  }, [transport])
  const probe = useTrialReadiness(phase === 'ready' ? transport : undefined, phase === 'ready')
  useEffect(() => {
    if (phase !== 'ready') return
    let active = true
    void transport.configuration().then(value => {
      if (active && value !== undefined) setConfiguration(value)
    }).catch(() => undefined)
    return () => { active = false }
  }, [phase, transport])
  return (
    <HarnessFrame controls={(
      <>
        <span data-harness-phase>{phase}</span>
        <button type="button" data-harness="unmount" onClick={() => setMounted(false)}>卸载组件</button>
      </>
    )}>
      {mounted ? (
        <TrialWorkspace
          readiness={probe.readiness}
          loading={probe.loading}
          error={probe.error}
          unavailable={probe.unavailable}
          configuration={configuration}
          activeProjectId={configuration?.projects[0]?.id}
          onAction={record}
          onReload={probe.reload}
        />
      ) : <p data-unmounted="true">unmounted</p>}
    </HarnessFrame>
  )
}

function StaleHarness() {
  const pair = useMemo(() => trialProbePair(), [])
  const pending = useRef<((value: TrialReadiness | undefined) => void)[]>([])
  const calls = useRef(0)
  const transport = useMemo(() => ({
    readiness: () => {
      calls.current += 1
      if (calls.current === 1) return new Promise<TrialReadiness | undefined>(resolve => { pending.current.push(resolve) })
      return Promise.resolve(pair.second)
    },
  }), [pair])
  const probe = useTrialReadiness(transport, true)
  return (
    <HarnessFrame controls={(
      <>
        <button type="button" data-harness="reload" onClick={probe.reload}>重新读取</button>
        <button type="button" data-harness="resolve-first" onClick={() => {
          for (const resolve of pending.current.splice(0)) resolve(pair.first)
        }}>让旧请求晚到</button>
        <span data-harness-calls>{calls.current}</span>
      </>
    )}>
      <TrialWorkspace readiness={probe.readiness} loading={probe.loading} error={probe.error}
        configuration={pair.configuration} onAction={record} onReload={probe.reload} />
    </HarnessFrame>
  )
}

function UnmountProbe({ transport }: { readonly transport: { readiness: () => Promise<TrialReadiness | undefined> } }) {
  const probe = useTrialReadiness(transport, true)
  return <TrialWorkspace readiness={probe.readiness} loading={probe.loading} error={probe.error} onAction={record} onReload={probe.reload} />
}

function UnmountHarness() {
  const pending = useRef<((value: TrialReadiness | undefined) => void)[]>([])
  const [mounted, setMounted] = useState(true)
  const transport = useMemo(() => ({
    readiness: () => new Promise<TrialReadiness | undefined>(resolve => { pending.current.push(resolve) }),
  }), [])
  return (
    <HarnessFrame controls={(
      <>
        <button type="button" data-harness="unmount" onClick={() => setMounted(false)}>卸载组件</button>
        <button type="button" data-harness="resolve" onClick={() => {
          for (const resolve of pending.current.splice(0)) resolve(undefined)
        }}>让请求晚到</button>
      </>
    )}>
      {mounted ? <UnmountProbe transport={transport} /> : <p data-unmounted="true">unmounted</p>}
    </HarnessFrame>
  )
}

function IdentityHarness() {
  const pair = useMemo(() => trialProbePair(), [])
  const pendingA = useRef<((value: TrialReadiness | undefined) => void)[]>([])
  const transportA = useMemo(() => ({
    readiness: () => {
      window.__TRIAL_A_READS__ = (window.__TRIAL_A_READS__ ?? 0) + 1
      return new Promise<TrialReadiness | undefined>(resolve => { pendingA.current.push(resolve) })
    },
  }), [])
  const transportB = useMemo(() => ({
    readiness: () => {
      window.__TRIAL_B_READS__ = (window.__TRIAL_B_READS__ ?? 0) + 1
      return Promise.resolve(pair.second)
    },
  }), [pair])
  const [identity, setIdentity] = useState<'a' | 'b'>('a')
  const probe = useTrialReadiness(identity === 'a' ? transportA : transportB, { identity })
  return (
    <HarnessFrame controls={(
      <>
        <span data-harness-identity>{identity}</span>
        <button type="button" data-harness="switch-b" onClick={() => setIdentity('b')}>切换到 B</button>
        <button type="button" data-harness="switch-a" onClick={() => setIdentity('a')}>切换到 A</button>
        <button type="button" data-harness="resolve-a" onClick={() => {
          for (const resolve of pendingA.current.splice(0)) resolve(pair.first)
        }}>让 A 晚到</button>
        <button type="button" data-harness="reload" onClick={probe.reload}>重新读取</button>
        <span data-harness-reads-a>{window.__TRIAL_A_READS__ ?? 0}</span>
        <span data-harness-reads-b>{window.__TRIAL_B_READS__ ?? 0}</span>
      </>
    )}>
      <TrialWorkspace readiness={probe.readiness} loading={probe.loading} error={probe.error} unavailable={probe.unavailable}
        configuration={pair.configuration} onAction={record} onReload={probe.reload} />
    </HarnessFrame>
  )
}

function SameTransportIdentityHarness() {
  const pair = useMemo(() => trialProbePair(), [])
  const pending = useRef<((value: TrialReadiness | undefined) => void)[]>([])
  const calls = useRef(0)
  const transport = useMemo(() => ({
    readiness: () => {
      calls.current += 1
      window.__TRIAL_SAME_READS__ = calls.current
      return new Promise<TrialReadiness | undefined>(resolve => { pending.current.push(resolve) })
    },
  }), [])
  const [identity, setIdentity] = useState<'a' | 'b'>('a')
  const probe = useTrialReadiness(transport, { identity })
  return (
    <HarnessFrame controls={(
      <>
        <span data-harness-identity>{identity}</span>
        <button type="button" data-harness="switch-b" onClick={() => setIdentity('b')}>切换身份</button>
        <button type="button" data-harness="resolve-first" onClick={() => {
          const resolve = pending.current.shift()
          if (resolve) resolve(pair.first)
        }}>完成第一次</button>
        <button type="button" data-harness="resolve-second" onClick={() => {
          const resolve = pending.current.shift()
          if (resolve) resolve(pair.second)
        }}>完成第二次</button>
        <span data-harness-same-reads>{calls.current}</span>
      </>
    )}>
      <TrialWorkspace readiness={probe.readiness} loading={probe.loading} error={probe.error}
        configuration={pair.configuration} onAction={record} onReload={probe.reload} />
    </HarnessFrame>
  )
}

function InlineHarness() {
  const pair = useMemo(() => trialProbePair(), [])
  const [tick, setTick] = useState(0)
  // Deliberately a fresh object every render; identity is omitted so the hook must not loop.
  const transport = {
    readiness: () => {
      window.__TRIAL_INLINE_READS__ = (window.__TRIAL_INLINE_READS__ ?? 0) + 1
      return Promise.resolve(pair.second)
    },
  }
  const probe = useTrialReadiness(transport, true)
  return (
    <HarnessFrame controls={(
      <>
        <button type="button" data-harness="rerender" onClick={() => setTick(value => value + 1)}>重新渲染</button>
        <span data-harness-tick>{tick}</span>
        <span data-harness-inline-reads>{window.__TRIAL_INLINE_READS__ ?? 0}</span>
      </>
    )}>
      <TrialWorkspace readiness={probe.readiness} loading={probe.loading} error={probe.error}
        configuration={pair.configuration} onAction={record} onReload={probe.reload} />
    </HarnessFrame>
  )
}

function DisabledHarness() {
  const pair = useMemo(() => trialProbePair(), [])
  const pending = useRef<((value: TrialReadiness | undefined) => void)[]>([])
  const transport = useMemo(() => ({
    readiness: () => {
      window.__TRIAL_DISABLED_READS__ = (window.__TRIAL_DISABLED_READS__ ?? 0) + 1
      return new Promise<TrialReadiness | undefined>(resolve => { pending.current.push(resolve) })
    },
  }), [])
  const [enabled, setEnabled] = useState(false)
  const probe = useTrialReadiness(transport, { enabled })
  return (
    <HarnessFrame controls={(
      <>
        <span data-harness-enabled>{String(enabled)}</span>
        <button type="button" data-harness="enable" onClick={() => setEnabled(true)}>启用</button>
        <button type="button" data-harness="disable" onClick={() => setEnabled(false)}>禁用</button>
        <button type="button" data-harness="resolve" onClick={() => {
          for (const resolve of pending.current.splice(0)) resolve(pair.second)
        }}>完成读取</button>
        <span data-harness-disabled-reads>{window.__TRIAL_DISABLED_READS__ ?? 0}</span>
      </>
    )}>
      <TrialWorkspace readiness={probe.readiness} loading={probe.loading} error={probe.error}
        configuration={pair.configuration} onAction={record} onReload={probe.reload} />
    </HarnessFrame>
  )
}

function AuthExpiryHarness() {
  const pair = useMemo(() => trialProbePair(), [])
  const calls = useRef(0)
  const transport = useMemo(() => ({
    readiness: () => {
      calls.current += 1
      window.__TRIAL_AUTH_READS__ = calls.current
      if (calls.current === 1) return Promise.resolve(pair.second)
      return Promise.reject(Object.assign(new Error('raw /Users/secret token=abc'), { code: 'auth_required' }))
    },
  }), [pair])
  const probe = useTrialReadiness(transport, { identity: 'auth-session' })
  return (
    <HarnessFrame controls={(
      <>
        <button type="button" data-harness="reload" onClick={probe.reload}>重新读取</button>
        <span data-harness-auth-reads>{calls.current}</span>
      </>
    )}>
      <TrialWorkspace readiness={probe.readiness} loading={probe.loading} error={probe.error}
        configuration={pair.configuration} onAction={record} onReload={probe.reload} />
    </HarnessFrame>
  )
}

function ModelFormHarness() {
  const params = new URLSearchParams(window.location.search)
  const outcome = params.get('outcome') ?? 'connected'
  const [identity, setIdentity] = useState<'a' | 'b'>('a')
  const [mounted, setMounted] = useState(true)
  return (
    <HarnessFrame controls={(
      <>
        <span data-harness-identity>{identity}</span>
        <button type="button" data-harness="switch" onClick={() => setIdentity(value => value === 'a' ? 'b' : 'a')}>切换身份</button>
        <button type="button" data-harness="unmount" onClick={() => setMounted(false)}>卸载表单</button>
      </>
    )}>
      {mounted ? <TrialModelConnectionForm identity={identity} availability={outcome === 'unavailable' ? { enabled: false, reason: '当前设置未提供模型连接' } : { enabled: true }}
        onCancel={() => writeLog('cancel')}
        onConnect={async draft => {
          window.__TRIAL_MODEL_CALLS__?.push({ ...draft })
          if (outcome === 'slow') await new Promise(resolve => setTimeout(resolve, 1200))
          if (outcome === 'leak') return { status: 'failed', message: `provider rejected ${draft.apiKey} at /Users/private/key` }
          if (outcome === 'failed') return { status: 'failed', message: '端点拒绝连接，请检查密钥。' }
          return { status: 'connected', message: '连接已由主程序确认。' }
        }} /> : <p data-unmounted="true">unmounted</p>}
    </HarnessFrame>
  )
}

function HistoryHarness() {
  const params = new URLSearchParams(window.location.search)
  const scenario = params.get('scenario') ?? 'verified'
  const [selected, setSelected] = useState('msg-1')
  const [more, setMore] = useState(false)
  const [page, setPage] = useState<ContextHistory>({
    protocol: 'context-history/1' as const, projectId: scenario === 'foreign' ? 'project-beta' : 'project-atlas',
    conversationId: 'conv-alpha', observedAt: '2026-11-16T00:10:00.000Z',
    entries: [
      { messageId: 'msg-1', projectId: scenario === 'foreign' ? 'project-beta' : 'project-atlas', conversationId: 'conv-alpha',
        confirmedAt: '2026-11-16T00:01:00.000Z', expiresAt: '2026-11-16T00:06:00.000Z', selections: ['work'] as const,
        sourceCount: 2, message: { state: 'available' as const, text: '为项目补充回归检查，并保留原范围。', truncated: false } },
      { messageId: 'msg-2', projectId: scenario === 'foreign' ? 'project-beta' : 'project-atlas', conversationId: 'conv-alpha',
        confirmedAt: '2026-11-16T00:02:00.000Z', expiresAt: '2026-11-16T00:07:00.000Z', selections: ['work'] as const,
        sourceCount: 1, message: { state: 'missing' as const, truncated: false } },
    ],
    hasMore: !more, ...(more ? {} : { nextCursor: 'cursor-1' }),
  } as ContextHistory)
  const baseState = scenario === 'missing' ? 'missing' : scenario === 'scopechanged' ? 'scope_changed' : 'verified'
  const sourceState = selected === 'msg-2' && baseState === 'verified' ? 'missing' : baseState
  const sources = sourceState === 'verified' ? {
    protocol: 'context-sources/1', observedAt: '2026-11-16T00:11:00.000Z', state: 'verified',
    binding: { protocol: 'assistant-context-binding/1', commandId: 'cmd-1', messageId: selected, requestId: 'req-1',
      projectId: 'project-atlas', conversationId: 'conv-alpha', userTextDigest: 'a'.repeat(64),
      principal: { userId: 'user-1', authorityRef: 'auth-1' }, purpose: 'conversation_discussion',
      scope: { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      selections: ['work'], bundleRef: 'bundle-1', bundleDigest: 'b'.repeat(64),
      sources: [{ sourceId: 'source-1', kind: 'work', sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), truncated: false }],
      confirmedAt: '2026-11-16T00:01:00.000Z', expiresAt: '2026-11-16T00:06:00.000Z' },
    sources: [{ sourceId: 'source-1', kind: 'work', title: '工作合同摘要', path: 'work.json', content: JSON.stringify({ work: { title: '补充回归检查' }, criteria: [{ description: '现有检查通过' }] }),
      sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), bytes: 2048, estimatedTokens: 300, truncated: false }],
    omitted: [], injectionFlags: [], scopeReview: { protocol: 'context-scope-review/1', reasons: ['selection_narrowed'], partial: false, withheldSourceCount: 0, authorization: 'none' },
  } as unknown as import('@personal-agent/contracts').ContextSources : {
    protocol: 'context-sources/1', observedAt: '2026-11-16T00:11:00.000Z', state: sourceState,
    binding: { protocol: 'assistant-context-binding/1', commandId: 'cmd-1', messageId: selected, requestId: 'req-1',
      projectId: 'project-atlas', conversationId: 'conv-alpha', userTextDigest: 'a'.repeat(64),
      principal: { userId: 'user-1', authorityRef: 'auth-1' }, purpose: 'conversation_discussion',
      scope: { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      selections: ['work'], bundleRef: 'bundle-1', bundleDigest: 'b'.repeat(64),
      sources: [{ sourceId: 'source-1', kind: 'work', sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), truncated: false }],
      confirmedAt: '2026-11-16T00:01:00.000Z', expiresAt: '2026-11-16T00:06:00.000Z' },
    sources: [], omitted: [], injectionFlags: [], scopeReview: { protocol: 'context-scope-review/1', reasons: [], partial: true, withheldSourceCount: 1, authorization: 'none' },
  } as unknown as import('@personal-agent/contracts').ContextSources
  return (
    <HarnessFrame controls={(
      <>
        <button type="button" data-harness="load-more" onClick={() => {
          const next = { ...page, entries: [...page.entries, { messageId: 'msg-3', projectId: page.projectId, conversationId: 'conv-alpha',
            confirmedAt: '2026-11-16T00:03:00.000Z', expiresAt: '2026-11-16T00:08:00.000Z', selections: ['work'] as const,
            sourceCount: 1, message: { state: 'available' as const, text: '第三条历史记录', truncated: false } }], hasMore: false }
          setPage(next)
          setMore(true)
        }}>读取更多</button>
        <button type="button" data-harness="select-second" onClick={() => setSelected('msg-2')}>选择第二条</button>
      </>
    )}>
      <HistorySourcePanel history={page} scope={{ projectId: 'project-atlas', conversationId: 'conv-alpha' }}
        selectedMessageId={selected} sources={sources} onSelect={entry => setSelected(entry.messageId)} onLoadMore={() => {
          // Exercise the pure merge guard through the same state update the real handler uses.
          const previous = { entries: page.entries, hasMore: page.hasMore, observedAt: page.observedAt, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
          const merged = trialHistoryMerge(previous, {
            protocol: page.protocol, projectId: page.projectId, conversationId: page.conversationId, observedAt: page.observedAt,
            entries: [{ messageId: 'msg-3', projectId: page.projectId, conversationId: 'conv-alpha',
              confirmedAt: '2026-11-16T00:03:00.000Z', expiresAt: '2026-11-16T00:08:00.000Z', selections: ['work'] as const,
              sourceCount: 1, message: { state: 'available' as const, text: '第三条历史记录', truncated: false } }], hasMore: false,
          })
          if (merged.ok) {
            const { nextCursor: omitted, ...rest } = page
            void omitted
            setPage({ ...rest, entries: merged.page.entries, hasMore: merged.page.hasMore })
          }
        }} onOpenConversation={() => writeLog('open-conversation')} />
    </HarnessFrame>
  )
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode') ?? 'props'
  const requested = params.get('state') ?? 'configured'
  const state = (trialStates as readonly string[]).includes(requested) ? requested as TrialHarnessState : 'configured'
  if (mode === 'http') return <HttpHarness />
  if (mode === 'stale') return <StaleHarness />
  if (mode === 'unmount') return <UnmountHarness />
  if (mode === 'identity') return <IdentityHarness />
  if (mode === 'inline') return <InlineHarness />
  if (mode === 'identity-same') return <SameTransportIdentityHarness />
  if (mode === 'disabled') return <DisabledHarness />
  if (mode === 'auth-expiry') return <AuthExpiryHarness />
  if (mode === 'model-form') return <ModelFormHarness />
  if (mode === 'history') return <HistoryHarness />
  return <PropsHarness state={state} />
}

createRoot(document.getElementById('root')!).render(<App />)
