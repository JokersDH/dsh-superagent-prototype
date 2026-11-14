/**
 * Bounded readonly probe for GET /v1/readiness through the existing ConsoleTransport. It performs one
 * attempt per load/reload, keeps the last valid observation while refreshing, discards late responses
 * from an older attempt and never retries, sends a command or starts an agent on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrialReadiness } from '@personal-agent/contracts'
import type { ConsoleTransport } from '../transport.ts'

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

export function useTrialReadiness(transport: Pick<ConsoleTransport, 'readiness'> | undefined, enabled = true): TrialReadinessProbe {
  const [readiness, setReadiness] = useState<TrialReadiness>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [unavailable, setUnavailable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => setAttempt(value => value + 1), [])
  // A stable capability flag keeps an inline prop object from re-triggering the probe every render.
  const available = transport?.readiness !== undefined
  const current = useRef(transport)
  current.current = transport

  useEffect(() => {
    if (!enabled) return
    const client = current.current
    const read = client?.readiness
    if (!read) {
      setLoading(false)
      setUnavailable(true)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(undefined)
    void read.call(client).then(value => {
      if (cancelled) return
      setReadiness(value)
      setUnavailable(value === undefined)
    }).catch((cause: unknown) => {
      if (cancelled) return
      setError(trialProbeError(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    // Cleanup runs on reload and unmount, so a late response from this attempt is ignored.
    return () => { cancelled = true }
  }, [enabled, attempt, available])

  return {
    loading,
    reload,
    ...(readiness === undefined ? {} : { readiness }),
    ...(error === undefined ? {} : { error }),
    ...(unavailable ? { unavailable: true } : {}),
  }
}
