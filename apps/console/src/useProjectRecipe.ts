import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectRecipePreview, ProjectRecipePreviewInput } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

/** Prefill data is local form state. Every explicit creation re-reads the same current inputs. */
export function useProjectRecipe(transport: Pick<ConsoleTransport, 'previewProjectRecipe'> | undefined,
  input: ProjectRecipePreviewInput | undefined, configurationRevision: string | undefined) {
  const key = JSON.stringify([configurationRevision, input ?? null])
  const [observation, setObservation] = useState<{ key: string; preview?: ProjectRecipePreview; error?: string }>({ key })
  const [applied, setApplied] = useState<{ key: string; preview: ProjectRecipePreview }>()
  const [busy, setBusy] = useState<string>()
  const sequence = useRef(0), controller = useRef<AbortController>()
  useEffect(() => { sequence.current++; controller.current?.abort(); return () => { sequence.current++; controller.current?.abort() } }, [key, transport])
  const read = useCallback(async (): Promise<ProjectRecipePreview | undefined> => {
    if (!input || !transport?.previewProjectRecipe) return undefined
    const ticket = ++sequence.current
    controller.current?.abort(); controller.current = new AbortController()
    setBusy(key); setObservation({ key })
    try {
      const preview = await transport.previewProjectRecipe(input, controller.current.signal)
      if (sequence.current !== ticket) return undefined
      if (!preview) { setObservation({ key, error: '当前服务未提供项目模板，请使用手动委托。' }); return undefined }
      if (preview.configurationRevision !== configurationRevision || JSON.stringify(preview.input) !== JSON.stringify(input)) {
        setObservation({ key, error: '项目配置已变化，请刷新配置后重新预览。' }); return undefined
      }
      setObservation({ key, preview }); return preview
    } catch {
      if (sequence.current === ticket) setObservation({ key, error: '项目模板暂时无法读取，请重试。' })
      return undefined
    } finally { if (sequence.current === ticket) setBusy(undefined) }
  }, [key, input, transport, configurationRevision])
  const visible = observation.key === key ? observation : undefined
  const apply = () => { if (visible?.preview?.status === 'draft') {
    setApplied({ key, preview: visible.preview }); setObservation({ key, preview: visible.preview })
  } }
  const clear = () => { sequence.current++; controller.current?.abort(); setApplied(undefined); setObservation({ key }); setBusy(undefined) }
  const revalidate = async () => {
    if (!applied || applied.key !== key) return false
    const fresh = await read(), original = applied.preview
    if (!fresh || fresh.status !== 'draft') return false
    if (fresh.configurationRevision !== original.configurationRevision || fresh.factsDigest !== original.factsDigest ||
      fresh.catalogDigest !== original.catalogDigest || JSON.stringify(fresh.fields) !== JSON.stringify(original.fields)) {
      setObservation({ key, preview: fresh, error: '项目事实或配置已变化，请重新应用草稿。' }); return false
    }
    return true
  }
  const validApplied = applied?.key === key && visible?.preview?.status === 'draft' && !visible.error &&
    applied.preview.factsDigest === visible.preview.factsDigest && applied.preview.catalogDigest === visible.preview.catalogDigest &&
    JSON.stringify(applied.preview.fields) === JSON.stringify(visible.preview.fields)
  return { preview: visible?.preview, error: visible?.error, loading: busy === key, validApplied,
    applied: applied?.key === key ? applied.preview : undefined, stale: applied !== undefined && applied.key !== key,
    read, apply, clear, revalidate }
}
