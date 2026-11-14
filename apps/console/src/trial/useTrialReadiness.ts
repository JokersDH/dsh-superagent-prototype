/**
 * Bounded readonly probe for GET /v1/readiness through the existing ConsoleTransport. It performs one
 * attempt per load/reload, keeps the last valid observation while refreshing, discards late responses
 * from an older attempt or an older transport identity, and never retries, sends a command or starts
 * an agent on its own.
 *
 * Identity contract: the hook cannot see which backend a transport instance talks to. A caller that
 * may swap transports passes a stable `identity` (for example an auth-session generation or the API
 * base). When it changes, prior data is hidden immediately, the old request is cancelled and the new
 * backend is read once. Without an identity the transport must stay stable for the mounted lifetime;
 * replacing it requires a remount (React key) so state cannot be attributed to the wrong service.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrialReadiness } from '@personal-agent/contracts'
import type { ConsoleTransport } from '../transport.ts'

/** Stable, comparable identity of the backend/session behind the transport. */
export type TrialReadinessIdentity = string | number

export interface TrialReadinessOptions {
  readonly enabled?: boolean
  /** Stable identity; a change hides prior observations and re-reads the new service once. */
  readonly identity?: TrialReadinessIdentity | undefined
}

export interface TrialReadinessProbe {
  readonly readiness?: TrialReadiness
  readonly loading: boolean
  readonly error?: string
  /** The running service answered that this optional capability is not published. */
  readonly unavailable?: boolean
  readonly reload: () => void
}

/** User-facing wording only; transport stacks, paths and credentials never reach the page. */
export function trialProbeError(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code?: unknown }).code) : ''
  switch (code) {
    case 'auth_required': return '会话已失效；请重新建立本地会话后再读取。'
    case 'storage_unavailable': return '无法连接本地服务，或本地状态暂时不可用；请确认工作台仍在运行后重试。'
    case 'invalid_request': return '试用状态的请求被拒绝；刷新页面后再试。'
    case 'schema_mismatch': return '试用状态格式与当前工作台不一致；请更新工作台后再试。'
    case 'unsupported_capability': return '当前服务未提供试用状态接口；既有视图仍可继续使用。'
    default: return '试用状态暂时无法读取；请重试。'
  }
}

interface Observation {
  readonly identity: TrialReadinessIdentity | undefined
  readonly readiness?: TrialReadiness | undefined
  readonly error?: string | undefined
  readonly unavailable: boolean
}

const normalize = (options: boolean | TrialReadinessOptions): { enabled: boolean; identity: TrialReadinessIdentity | undefined } =>
  typeof options === 'boolean'
    ? { enabled: options, identity: undefined }
    : { enabled: options.enabled ?? true, identity: options.identity }

export function useTrialReadiness(
  transport: Pick<ConsoleTransport, 'readiness'> | undefined,
  options: boolean | TrialReadinessOptions = true,
): TrialReadinessProbe {
  const { enabled, identity } = normalize(options)
  const [observation, setObservation] = useState<Observation>({ identity, unavailable: false })
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => setAttempt(value => value + 1), [])
  // A stable capability flag keeps an inline prop object from re-triggering the probe every render.
  const available = transport?.readiness !== undefined
  const current = useRef(transport)
  current.current = transport
  // Only the observation that belongs to the current identity may be shown.
  const visible: Observation = observation.identity === identity ? observation : { identity, unavailable: false }

  useEffect(() => {
    if (!enabled) {
      // A disabled view must not keep a permanent loading state from a cancelled attempt.
      setLoading(false)
      return
    }
    const client = current.current
    const read = client?.readiness
    if (!read) {
      setLoading(false)
      // A transport that no longer exposes readiness cannot keep another service's observation.
      setObservation({ identity, unavailable: true })
      return
    }
    let cancelled = false
    setLoading(true)
    setObservation(previous => previous.identity === identity
      ? { ...previous, error: undefined }
      : { identity, unavailable: false })
    void read.call(client).then(value => {
      if (cancelled) return
      setObservation(value === undefined
        ? { identity, unavailable: true }
        : { identity, readiness: value, unavailable: false })
    }).catch((cause: unknown) => {
      if (cancelled) return
      setObservation(previous => previous.identity === identity
        ? { ...previous, error: trialProbeError(cause), unavailable: false }
        : { identity, error: trialProbeError(cause), unavailable: false })
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    // Cleanup runs on reload, identity change, disable and unmount: a late response is ignored.
    return () => { cancelled = true }
  }, [enabled, attempt, available, identity])

  return {
    loading,
    reload,
    ...(visible.readiness === undefined ? {} : { readiness: visible.readiness }),
    ...(visible.error === undefined ? {} : { error: visible.error }),
    ...(visible.unavailable ? { unavailable: true } : {}),
  }
}
