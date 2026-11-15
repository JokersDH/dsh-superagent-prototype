import { useCallback, useEffect, useRef, useState } from 'react'
import type { UsageObservation } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

/** Observation identity includes the selected scope. A late reply can never become another project's data. */
export function useUsageObservation(transport: ConsoleTransport, options: {
  enabled: boolean; identity: string; projectId: string | undefined
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const key = JSON.stringify([options.identity, options.projectId ?? null, timezone])
  const [state, setState] = useState<{ key: string; data?: UsageObservation; error?: string }>({ key })
  const [attempt, setAttempt] = useState(0)
  const client = useRef(transport); client.current = transport
  const available = transport.usageObservation !== undefined
  const reload = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    if (!options.enabled || !available) return
    const current = client.current, controller = new AbortController()
    setState(previous => previous.key === key && previous.data ? { key, data: previous.data } : { key })
    void current.usageObservation!({ ...(options.projectId ? { projectId: options.projectId } : {}), days: 7, timezone }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setState(data ? { key, data } : { key }) })
      .catch(() => {
        if (!controller.signal.aborted) setState(previous => ({ key,
          ...(previous.key === key && previous.data ? { data: previous.data } : {}),
          error: '使用观察暂时无法读取，请重新读取。' }))
      })
    return () => controller.abort()
  }, [options.enabled, options.projectId, available, key, timezone, attempt])
  const visible = state.key === key && available ? state : undefined
  return { data: visible?.data, error: visible?.error, reload }
}
