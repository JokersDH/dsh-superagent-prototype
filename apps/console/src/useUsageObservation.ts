import { useCallback, useEffect, useRef, useState } from 'react'
import type { UsageObservation } from '@personal-agent/contracts'
import { UsageObservationSchema } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

/** Observation identity includes the selected scope. A late reply can never become another project's data. */
export function useUsageObservation(transport: ConsoleTransport, options: {
  enabled: boolean; identity: string; projectId: string | undefined; days?: 7 | 30; configurationRevision?: string | undefined
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const days = options.days ?? 7
  const key = JSON.stringify([options.identity, options.configurationRevision ?? null, options.projectId ?? null, days, timezone])
  const [state, setState] = useState<{ key: string; data?: UsageObservation; error?: string }>({ key })
  const [pending, setPending] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const client = useRef(transport); client.current = transport
  const available = transport.usageObservation !== undefined
  const reload = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    if (!options.enabled || !available) return
    const current = client.current, controller = new AbortController()
    setPending(key)
    setState(previous => previous.key === key && previous.data ? { key, data: previous.data } : { key })
    void current.usageObservation!({ ...(options.projectId ? { projectId: options.projectId } : {}), days, timezone }, controller.signal)
      .then(raw => {
        if (controller.signal.aborted) return
        const data = raw === undefined ? undefined : UsageObservationSchema.parse(raw)
        if (data && (data.days !== days || data.timezone !== timezone || (options.projectId &&
          (data.scope.projectIds.length !== 1 || data.scope.projectIds[0] !== options.projectId)))) throw new Error('Observation scope mismatch')
        setState(data ? { key, data } : { key })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(previous => ({ key,
          ...(previous.key === key && previous.data ? { data: previous.data } : {}),
          error: '使用观察暂时无法读取，请重新读取。' }))
      })
      .finally(() => { if (!controller.signal.aborted) setPending(undefined) })
    return () => controller.abort()
  }, [options.enabled, options.projectId, available, key, days, timezone, attempt])
  const visible = state.key === key && available ? state : undefined
  return { data: visible?.data, error: visible?.error, loading: options.enabled && available && (pending === key || state.key !== key), reload }
}
