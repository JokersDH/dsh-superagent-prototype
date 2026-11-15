import { ApplicationFault } from '@personal-agent/application'
import { ApplicationConfigurationSchema, ProjectRecipePreviewInputSchema, ProjectRecipePreviewSchema, ProjectRecipeFieldsSchema } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { ApplicationConfiguration, Json, ProjectRecipePreview, ProjectRecipePreviewInput } from '@personal-agent/contracts'

export interface ProjectRecipeReaders {
  configuration(): Promise<ApplicationConfiguration>
  rootFor(projectId: string): string | undefined
}
const titles = { regression_fix: '回归修复', scoped_change: '有限范围变更', verification_followup: '验证跟进' }

/** No writer, execution or arbitrary-root input: suggestions remain data for the original form. */
export class ProductProjectRecipes {
  private readonly readers: ProjectRecipeReaders
  private readonly now: () => string
  constructor(readers: ProjectRecipeReaders, now = () => new Date().toISOString()) { this.readers = readers; this.now = now }

  async preview(raw: ProjectRecipePreviewInput): Promise<ProjectRecipePreview> {
    const input = ProjectRecipePreviewInputSchema.parse(raw), config = ApplicationConfigurationSchema.parse(await this.readers.configuration())
    const project = config.projects.find(value => value.id === input.projectId)
    if (!project) throw new ApplicationFault('forbidden', 'Recipe project is outside the configured scope', 'none')
    const base = { protocol: 'project-recipe-preview/1' as const, input, configurationRevision: config.revision,
      observedAt: this.now(), factsDigest: null, catalogDigest: null, title: titles[input.kind], authorization: 'none' as const }
    const unavailable = (code: string, message: string, status: 'needs_input' | 'unavailable' = 'unavailable') =>
      ProjectRecipePreviewSchema.parse({ ...base, status, fields: null, issues: [{ code, message }] })
    const profile = config.profiles.find(value => value.id === input.profileId)
    if (!project.dispatchAllowed || project.discussionOnly || !profile?.dispatchAllowed || !project.profileIds.includes(input.profileId) ||
      config.executionAvailability?.state === 'unavailable' || (project.scope.expiresAt && Date.parse(project.scope.expiresAt) <= Date.parse(base.observedAt)))
      return unavailable('project_unavailable', '当前项目或执行器不可委托。', 'needs_input')
    if (!input.allowedPaths.every(atom => project.scope.allowedPaths.includes(atom)))
      return unavailable('scope_not_declared', '工作范围必须使用当前项目已有的路径声明。', 'needs_input')
    const root = this.readers.rootFor(input.projectId)
    if (!root) return unavailable('project_root_unavailable', '该项目尚未提供已登记的元数据根目录。')
    let api: typeof import('@personal-agent/project-recipes')
    try { api = await import('@personal-agent/project-recipes') }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(String(error.code)))
        return unavailable('module_unavailable', '当前安装尚未提供项目模板模块。')
      throw error
    }
    let facts: import('@personal-agent/project-recipes').ProjectFacts
    try { facts = api.createProjectFactsObserver({ rootFor: id => id === input.projectId ? root : undefined },
      { provider: 'coordinator-project-recipes/1' }).observe({ projectId: input.projectId, observedAt: base.observedAt }).facts }
    catch { return unavailable('metadata_unavailable', '项目元数据暂时无法读取，请检查后重新预览。') }
    const { observedAt: _, ...content } = facts
    const factsDigest = canonicalDigest(content as unknown as Json), catalogDigest = api.catalogDigest()
    const draft = api.parseProjectRecipeDraft(api.matchRecipe({ facts, configuration: config, kind: input.kind,
      selection: { paths: input.allowedPaths, profileId: input.profileId }, now: base.observedAt }))
    const current = ApplicationConfigurationSchema.parse(await this.readers.configuration())
    if (current.revision !== config.revision || this.readers.rootFor(input.projectId) !== root)
      throw new ApplicationFault('conflict', 'Recipe inputs changed during preview; read them again', 'user_action')
    const shared = { ...base, factsDigest, catalogDigest }
    if (draft.status !== 'draft') return ProjectRecipePreviewSchema.parse({ ...shared, status: draft.status, fields: null,
      issues: (draft.status === 'needs_input' ? draft.needsInput : draft.unsupported).map(issue => ({ code: issue.code, message: issue.message })) })
    const { projectId, goal, scope, criteria, profileId } = api.previewInputs(draft, { configuration: current, facts })
    const fields = ProjectRecipeFieldsSchema.parse({ projectId, goal, scope, criteria, profileId })
    return ProjectRecipePreviewSchema.parse({ ...shared, status: 'draft', fields, issues: [] })
  }
}
