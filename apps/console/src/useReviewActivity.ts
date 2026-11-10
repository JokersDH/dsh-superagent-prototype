import { useEffect, useRef } from 'react'
import type { CandidateRef } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

/** Only visible, focused candidate detail is sampled. Failed telemetry never blocks acceptance. */
export function useReviewActivity(transport: ConsoleTransport, candidate: CandidateRef | undefined, enabled: boolean) {
  const flush = useRef<() => Promise<void>>(async () => {})
  const key = candidate ? JSON.stringify(candidate) : ''
  useEffect(() => {
    if (!enabled || !candidate || !transport.reviewActivity) { flush.current = async () => {}; return }
    const subject = structuredClone(candidate), sessionId = `review-session-${crypto.randomUUID()}`
    const pending = new Set<Promise<unknown>>()
    let started: number | undefined
    const active = () => document.visibilityState === 'visible' && document.hasFocus()
    const send = () => {
      const ended = Date.now()
      if (started !== undefined && ended > started && ended - started <= 15000) {
        const request = transport.reviewActivity!({ protocol: 'review-activity/1', commandId: `review-activity-${crypto.randomUUID()}`,
          sessionId, candidate: subject, startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(), source: 'ui_visibility_proxy' })
          .catch(() => undefined)
        pending.add(request); void request.finally(() => pending.delete(request))
      }
      started = active() ? ended : undefined
    }
    const update = () => { if (started !== undefined) send(); else if (active()) started = Date.now() }
    if (active()) started = Date.now()
    const timer = setInterval(update, 5000)
    for (const event of ['focus', 'blur']) window.addEventListener(event, update)
    document.addEventListener('visibilitychange', update)
    flush.current = async () => { send(); await Promise.allSettled([...pending]) }
    return () => {
      clearInterval(timer); send(); flush.current = async () => {}
      for (const event of ['focus', 'blur']) window.removeEventListener(event, update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [transport, key, enabled])
  return flush
}
