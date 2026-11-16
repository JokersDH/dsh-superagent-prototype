import { useEffect, useState } from 'react'
import { ProjectRecipePreviewSchema } from '@personal-agent/contracts'
import type { ApplicationConfiguration, ProjectRecipePreviewInput } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'
import type { TrialRecipeSuggestion } from './trial/recipes.ts'

const kinds = ['regression_fix', 'scoped_change', 'verification_followup'] as const

/** Read three bounded previews only for the explicitly selected current project. No complete fields leave this read model. */
export function useProjectRecipeSuggestions(transport: ConsoleTransport, options: {
  enabled: boolean; identity: string; configuration: ApplicationConfiguration | undefined; projectId: string | undefined
}) {
  const { configuration, projectId } = options
  const [reloadRevision, setReloadRevision] = useState(0)
  const project = configuration?.projects.find(value => value.id === projectId)
  const profileId = project?.defaultProfileId
  const key = JSON.stringify([options.identity, configuration?.revision, projectId, reloadRevision])
  const [state, setState] = useState<{ key: string; rows?: readonly TrialRecipeSuggestion[]; error?: string }>({ key })
  const [pending, setPending] = useState<string>()
  const available = transport.previewProjectRecipe !== undefined
  useEffect(() => {
    if (!options.enabled || !available || !project || !profileId || !project.dispatchAllowed || project.discussionOnly) return
    const controller = new AbortController()
    setPending(key); setState({ key })
    const inputs: ProjectRecipePreviewInput[] = kinds.map(kind => ({ projectId: project.id, kind, allowedPaths: project.scope.allowedPaths, profileId }))
    void Promise.all(inputs.map(async input => {
      const raw = await transport.previewProjectRecipe!(input, controller.signal)
      if (raw === undefined) return undefined
      const preview = ProjectRecipePreviewSchema.parse(raw)
      if (preview.configurationRevision !== configuration?.revision || JSON.stringify(preview.input) !== JSON.stringify(input))
        throw new Error('Preview belongs to another current selection')
      const fields = preview.fields
      return {
        id: input.kind, version: preview.catalogDigest ?? 'unavailable', source: 'project-recipes', projectId: input.projectId,
        title: preview.title, goalPreview: fields?.goal ?? preview.title, scopeNote: null,
        scope: fields ? { allowedPaths: fields.scope.allowedPaths, excludedPaths: fields.scope.excludedPaths, externalActions: fields.scope.externalActions } : null,
        preview: fields ? { kind: input.kind, allowedPaths: fields.scope.allowedPaths, profileId: fields.profileId } : null,
        status: preview.status === 'unavailable' ? 'unsupported' : preview.status,
        missingInputs: preview.issues.map(issue => ({ field: 'unknown', label: issue.message })),
        checks: fields ? fields.criteria.flatMap(criterion => criterion.kind === 'machine' && criterion.checkDefinitionRef
          ? [{ id: criterion.checkDefinitionRef, required: criterion.required, declared: true }] : []) : [],
        profiles: fields ? [{ id: fields.profileId, required: true }] : [],
        provenance: { manifest: null, declaredRoot: null, note: preview.observedAt }, limitations: [], authority: 'none',
      } satisfies TrialRecipeSuggestion
    })).then(rows => {
      if (!controller.signal.aborted) setState({ key, rows: rows.filter((row): row is NonNullable<typeof row> => row !== undefined) })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ key, error: '项目模板暂时无法读取，请使用原委托表单重试。' })
    }).finally(() => { if (!controller.signal.aborted) setPending(undefined) })
    return () => controller.abort()
  }, [options.enabled, available, key, project, profileId, configuration?.revision, transport])
  const visible = state.key === key && available && !!project?.dispatchAllowed ? state : undefined
  return { rows: visible?.rows, error: visible?.error, loading: options.enabled && pending === key,
    reload: () => setReloadRevision(value => value + 1) }
}
