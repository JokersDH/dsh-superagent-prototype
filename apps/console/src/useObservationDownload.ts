import { useEffect, useRef, useState } from 'react'
import type { ConsoleTransport } from './transport.ts'

/** Export re-reads a current authorized snapshot; changing scope cancels the old download. */
export function useObservationDownload(transport: ConsoleTransport, options: {
  enabled: boolean; identity: string; projectId: string | undefined; days: 7 | 30; configurationRevision: string | undefined
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const key = JSON.stringify([options.identity, options.projectId, options.days, timezone, options.configurationRevision])
  const currentKey = useRef(key); currentKey.current = key
  const controller = useRef<AbortController>(), [pending, setPending] = useState<string>(), [error, setError] = useState<{ key: string; message: string }>()
  useEffect(() => { controller.current?.abort(); return () => controller.current?.abort() }, [key, options.enabled])
  const download = async () => {
    if (!options.enabled || !transport.downloadUsageObservation || (controller.current && !controller.current.signal.aborted)) return
    const request = new AbortController(); controller.current = request
    setPending(key); setError(undefined)
    try {
      const result = await transport.downloadUsageObservation({ ...(options.projectId ? { projectId: options.projectId } : {}),
        days: options.days, timezone }, request.signal)
      if (request.signal.aborted || currentKey.current !== key) return
      if (!result) { setError({ key, message: '当前服务未提供观察导出。' }); return }
      const url = URL.createObjectURL(new Blob([result.text], { type: result.mediaType }))
      const link = document.createElement('a'); link.href = url; link.download = result.fileName
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch { if (!request.signal.aborted) setError({ key, message: '观察导出失败，请重新读取后重试。' }) }
    finally { request.abort(); if (controller.current === request) setPending(undefined) }
  }
  return { download, loading: options.enabled && pending === key, error: error?.key === key ? error.message : undefined }
}
