/**
 * The deterministic matcher: (explicit project facts, current public configuration, task kind,
 * explicit selection) → draft | needs_input | unsupported.
 *
 * Invariants this module is built to keep:
 *  - same input gives the same bytes and the same `revision`; nothing reads the clock, environment,
 *    filesystem or network;
 *  - every reference in a `draft` (project, scope paths, profile, criteria ids, check refs) already
 *    exists in the configuration or in the caller's explicit selection — nothing is invented from
 *    repository text;
 *  - a suggestion never widens scope, never adds an external action and never selects another agent
 *    or fixture as a fallback;
 *  - an unknown or missing input becomes `needs_input`/`unsupported`, never a silent default.
 */
import {
  ApplicationConfigurationSchema,
  CONFIGURATION_PROTOCOL,
  type ApplicationConfiguration,
  type ConfiguredProjectView,
  type Criterion,
  type Scope,
} from '@personal-agent/contracts'
import type { Json } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import {
  RECIPE_CATALOG,
  RECIPE_CATALOG_ID,
  RECIPE_CATALOG_VERSION,
  isRecipeKind,
  type RecipeKind,
  type RecipeTemplate,
} from './catalog.ts'
import {
  RECIPE_DRAFT_PROTOCOL,
  draftRevision,
  type ProjectRecipeDraft,
  type RecipeIssue,
  type RecipeIssueCode,
  type RecipeIssueField,
  type RecipeProvenance,
} from './draft.ts'
import { PROJECT_FACTS_PROTOCOL, ProjectFactsSchema, type ProjectFacts } from './facts.ts'

/** Default freshness budget for injected facts: older observations need an explicit refresh. */
export const DEFAULT_MAX_FACTS_AGE_MS = 60 * 60 * 1000

export interface RecipeSelection {
  readonly profileId?: string
  readonly paths?: readonly string[]
  readonly excludedPaths?: readonly string[]
  readonly criteriaIds?: readonly string[]
}

export interface RecipeMatchInput {
  /** Observed facts for one configured project. Schema-invalid facts are refused, not guessed. */
  readonly facts: unknown
  /** The current public `ApplicationConfiguration` projection. */
  readonly configuration: unknown
  /** One catalog kind; an unknown kind is a caller error, not a product outcome. */
  readonly kind: string
  /** Explicit user preference. An empty selection is valid and may itself produce `needs_input`. */
  readonly selection?: RecipeSelection
  /** ISO instant supplied by the caller so freshness stays deterministic. */
  readonly now: string
  /** Facts older than this are `needs_input: facts_stale`. */
  readonly maxFactsAgeMs?: number
}

export type RecipeInputErrorCode = 'invalid_facts' | 'unknown_kind' | 'invalid_clock'

export class RecipeInputError extends Error {
  readonly code: RecipeInputErrorCode
  constructor(code: RecipeInputErrorCode, message: string) {
    super(message)
    this.name = 'RecipeInputError'
    this.code = code
  }
}

const issue = (code: RecipeIssueCode, field: RecipeIssueField, message: string): RecipeIssue => ({ code, field, message })

const sortedUnique = (values: readonly string[] | undefined): readonly string[] | undefined =>
  values === undefined ? undefined : Object.freeze([...new Set(values)].sort())

const isRelativePath = (value: string): boolean =>
  value.length > 0 && value.length <= 1024 && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) &&
  !value.includes('\\') && !value.includes('\0') && !value.split('/').includes('..') && value.split('/').every((segment) => segment !== '')

/** True when `candidate` is the allowed path itself or lies strictly inside it. */
export function pathWithin(candidate: string, allowed: string): boolean {
  if (candidate === allowed) return true
  const base = allowed.replace(/\/+$/, '')
  return base.length > 0 && candidate.startsWith(`${base}/`)
}

const lockFamilies = (facts: ProjectFacts): ReadonlySet<'pnpm' | 'npm'> => {
  const families = new Set<'pnpm' | 'npm'>()
  for (const lock of facts.locks) {
    if (lock.name === 'pnpm-lock.yaml') families.add('pnpm')
    if (lock.name === 'package-lock.json' || lock.name === 'npm-shrinkwrap.json') families.add('npm')
  }
  return families
}

let cachedCatalogDigest: string | undefined
/** Digest of the frozen catalog content, independent of call order and clock. */
export function catalogDigest(): string {
  if (cachedCatalogDigest === undefined) {
    const entries = (Object.keys(RECIPE_CATALOG) as RecipeKind[]).sort().map((kind) => {
      const entry = RECIPE_CATALOG[kind]
      return { id: entry.id, version: entry.version, title: entry.title, summary: entry.summary, scope: entry.scope, criteria: entry.criteria, goal: entry.goal('project') }
    })
    cachedCatalogDigest = canonicalDigest({ id: RECIPE_CATALOG_ID, version: RECIPE_CATALOG_VERSION, entries } as unknown as Json)
  }
  return cachedCatalogDigest
}

const provenanceFor = (
  facts: ProjectFacts,
  configuration: { protocol: string; revision: string | null },
  kind: RecipeKind,
  selection: RecipeSelection,
): RecipeProvenance => {
  const normalized = {
    ...(selection.profileId === undefined ? {} : { profileId: selection.profileId }),
    ...(sortedUnique(selection.paths) === undefined ? {} : { paths: sortedUnique(selection.paths) }),
    ...(sortedUnique(selection.excludedPaths) === undefined ? {} : { excludedPaths: sortedUnique(selection.excludedPaths) }),
    ...(sortedUnique(selection.criteriaIds) === undefined ? {} : { criteriaIds: sortedUnique(selection.criteriaIds) }),
  }
  const factsDigest = canonicalDigest(facts as unknown as Json)
  const selectionDigest = canonicalDigest(normalized as unknown as Json)
  return {
    catalog: { id: RECIPE_CATALOG_ID, version: RECIPE_CATALOG_VERSION, digest: catalogDigest() },
    configuration: { protocol: configuration.protocol, revision: configuration.revision, projectId: facts.projectId },
    facts: {
      protocol: PROJECT_FACTS_PROTOCOL,
      digest: factsDigest,
      observedAt: facts.observedAt,
      provider: facts.provenance.provider,
      source: facts.provenance.source,
    },
    selection: { digest: selectionDigest, ...normalized },
    input: canonicalDigest({
      facts: factsDigest,
      configuration: configuration.revision,
      kind,
      selection: selectionDigest,
    } as unknown as Json),
  }
}

const envelope = (
  facts: ProjectFacts,
  template: RecipeTemplate,
  kind: RecipeKind,
  provenance: RecipeProvenance,
  notes: readonly string[],
) => ({
  protocol: RECIPE_DRAFT_PROTOCOL,
  projectId: facts.projectId,
  recipe: { id: kind, version: template.version, title: template.title, summary: template.summary },
  provenance,
  authorization: 'none' as const,
  notes: [...notes],
})

/** Seal a status-specific body with its content-addressed revision. */
const emit = (body: object): ProjectRecipeDraft =>
  ({ ...body, revision: draftRevision(body) }) as unknown as ProjectRecipeDraft

/** One cause may be reached from two checks; report it once, in the order it was first seen. */
const dedupe = (items: readonly RecipeIssue[]): RecipeIssue[] =>
  items.filter((item, index) => items.findIndex((other) => other.code === item.code && other.field === item.field && other.message === item.message) === index)

export function matchRecipe(input: RecipeMatchInput): ProjectRecipeDraft {
  if (!isRecipeKind(input.kind)) {
    throw new RecipeInputError('unknown_kind', `Unsupported recipe kind; the catalog has ${Object.keys(RECIPE_CATALOG).sort().join(', ')}`)
  }
  const kind: RecipeKind = input.kind
  const template = RECIPE_CATALOG[kind]
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) throw new RecipeInputError('invalid_clock', 'now must be an ISO timestamp')

  const parsedFacts = ProjectFactsSchema.safeParse(input.facts)
  if (!parsedFacts.success) {
    const first = parsedFacts.error.issues[0]
    throw new RecipeInputError('invalid_facts', `Project facts are not ${PROJECT_FACTS_PROTOCOL}: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim())
  }
  const facts = parsedFacts.data
  const selection: RecipeSelection = input.selection ?? {}
  const notes: string[] = []

  // --- configuration: supported version first, then public shape ------------
  const protocolObserved = (input.configuration as { protocol?: unknown } | null | undefined)?.protocol
  if (typeof protocolObserved === 'string' && protocolObserved !== CONFIGURATION_PROTOCOL) {
    return emit({
      ...envelope(facts, template, kind, provenanceFor(facts, { protocol: protocolObserved, revision: null }, kind, selection), ['配置版本不在支持范围内；不会按旧协议字段猜测。']),
      status: 'unsupported',
      unsupported: [issue('configuration_unsupported_version', 'configuration', `仅支持 ${CONFIGURATION_PROTOCOL}；观察到 ${protocolObserved}。`)],
    })
  }
  const parsedConfiguration = ApplicationConfigurationSchema.safeParse(input.configuration)
  if (!parsedConfiguration.success) {
    const first = parsedConfiguration.error.issues[0]
    return emit({
      ...envelope(facts, template, kind, provenanceFor(facts, { protocol: CONFIGURATION_PROTOCOL, revision: null }, kind, selection), ['配置未能通过公开 schema 校验；没有补默认值。']),
      status: 'unsupported',
      unsupported: [issue('configuration_invalid', 'configuration', `配置不是合法的 ${CONFIGURATION_PROTOCOL}：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim().slice(0, 400))],
    })
  }
  const configuration: ApplicationConfiguration = parsedConfiguration.data
  const provenance = provenanceFor(facts, { protocol: configuration.protocol, revision: configuration.revision }, kind, selection)

  const unsupported: RecipeIssue[] = []
  const needs: RecipeIssue[] = []

  // --- project identity -----------------------------------------------------
  const project: ConfiguredProjectView | undefined = configuration.projects.find((entry) => entry.id === facts.projectId)
  if (!project) {
    return emit({
      ...envelope(facts, template, kind, provenance, notes),
      status: 'unsupported',
      unsupported: [issue('project_unknown', 'project', `当前配置没有项目 ${facts.projectId}；请提供与该配置一致的项目 ID。`)],
    })
  }

  // --- stack / manager / lockfile support ----------------------------------
  if (facts.stack.kind === 'not_node') {
    unsupported.push(issue('stack_not_node', 'stack', `只支持 Node 项目；观察到非 Node 标记：${facts.stack.markers.join('、') || '无'}。`))
  } else if (facts.stack.kind === 'unknown') {
    unsupported.push(issue('stack_unknown', 'stack', `项目栈未知（${facts.stack.reason}），不能默认当作 Node。`))
  } else {
    if (facts.manager.kind === 'unsupported') unsupported.push(issue('manager_unsupported', 'manager', `只支持 pnpm/npm；观察到 ${facts.manager.name}。`))
    if (facts.manager.kind === 'unknown') needs.push(issue('manager_unknown', 'manager', '包管理器未能确定；请补充 packageManager 声明或唯一锁文件。'))
    const families = lockFamilies(facts)
    const declared = facts.manager.kind === 'pnpm' || facts.manager.kind === 'npm' ? facts.manager.kind : undefined
    if (families.size > 1) needs.push(issue('locks_ambiguous', 'lockfile', '同时观察到 pnpm 与 npm 锁文件；请只保留一个。'))
    else if (families.size === 1 && declared !== undefined && !families.has(declared))
      needs.push(issue('locks_ambiguous', 'lockfile', `声明的 ${declared} 与现有锁文件不一致；请对齐后再生成建议。`))
    if (facts.manager.kind === 'none') notes.push('未观察到 packageManager 声明或锁文件；建议只引用已登记检查，不推断任何命令。')
    if (facts.languages.includes('typescript')) notes.push('观察到 TypeScript 标记；检查与执行仍由既有配置决定。')
  }

  // --- workspace layout -----------------------------------------------------
  if (facts.workspace.declaration === 'unknown') needs.push(issue('workspace_unknown', 'workspace', '工作区布局未能观察；请显式给出根/成员范围。'))
  const monorepo = facts.workspace.declaration === 'package_json_workspaces' || facts.workspace.declaration === 'pnpm_workspace_yaml'
  const selectedPaths = sortedUnique(selection.paths)
  const memberRequired = monorepo && template.scope === 'narrowed' && (selectedPaths === undefined || selectedPaths.length === 0)
  if (memberRequired) needs.push(issue('workspace_member_required', 'workspace', '这是 workspace/monorepo 根目录；请显式列出成员内的项目相对路径。'))
  if (monorepo) notes.push('workspace/monorepo 布局：只使用显式列出的路径，不推断成员列表。')

  // --- facts freshness ------------------------------------------------------
  const maxAge = input.maxFactsAgeMs ?? DEFAULT_MAX_FACTS_AGE_MS
  if (!Number.isSafeInteger(maxAge) || maxAge < 0) throw new RecipeInputError('invalid_clock', 'maxFactsAgeMs must be a non-negative safe integer')
  const observedMs = Date.parse(facts.observedAt)
  if (!Number.isFinite(observedMs) || observedMs > nowMs) {
    needs.push(issue('facts_stale', 'facts', 'facts 的观察时间无效或晚于当前时间；请重新观察。'))
  } else if (nowMs - observedMs > maxAge) {
    const minutes = Math.floor((nowMs - observedMs) / 60_000)
    needs.push(issue('facts_stale', 'facts', `facts 已过期约 ${minutes} 分钟（上限 ${Math.floor(maxAge / 60_000)} 分钟）；请重新观察后再生成建议。`))
  }

  // --- execution availability ----------------------------------------------
  if (configuration.executionAvailability?.state === 'unavailable')
    needs.push(issue('execution_unavailable', 'execution', `当前执行不可用（${configuration.executionAvailability.reason}）；只能解释，不派工。`))
  if (project.discussionOnly) needs.push(issue('project_discussion_only', 'project', '项目处于只读讨论模式；不会生成可派工建议。'))
  if (!project.dispatchAllowed) needs.push(issue('project_dispatch_blocked', 'project', `项目当前不可派工${project.blockedReason ? `（${project.blockedReason}）` : ''}。`))

  // --- profile --------------------------------------------------------------
  const enabled = new Set(configuration.profiles.filter((profile) => profile.dispatchAllowed).map((profile) => profile.id))
  let profileId: string | undefined
  if (selection.profileId !== undefined) {
    if (project.profileIds.includes(selection.profileId) && enabled.has(selection.profileId)) profileId = selection.profileId
    else needs.push(issue('profile_not_enabled', 'profile', `profile ${selection.profileId} 不在该项目的已启用 profile 中。`))
  } else if (project.defaultProfileId !== undefined && enabled.has(project.defaultProfileId)) profileId = project.defaultProfileId
  else needs.push(issue('profile_required', 'profile', '项目没有可用的默认 profile；请显式选择一个已启用 profile。'))

  // --- criteria: reuse configured + registered only -------------------------
  const defaults: readonly Criterion[] = project.defaultCriteria
  let criteriaPool: readonly Criterion[] = defaults
  const criteriaIds = sortedUnique(selection.criteriaIds)
  if (criteriaIds !== undefined) {
    const known = new Set(defaults.map((criterion) => criterion.id))
    const unknown = criteriaIds.filter((id) => !known.has(id))
    if (unknown.length > 0) needs.push(issue('criteria_selection_unknown', 'criteria', `以下 criteria 不在项目默认 criteria 中：${unknown.slice(0, 8).join(', ')}。`))
    criteriaPool = defaults.filter((criterion) => criteriaIds.includes(criterion.id))
  }
  const criteria: readonly Criterion[] = template.criteria === 'machine' ? criteriaPool.filter((criterion) => criterion.kind === 'machine') : criteriaPool
  const registered = new Set(configuration.checks.map((check) => check.id))
  const unregisteredRefs = criteria
    .filter((criterion) => criterion.kind === 'machine' && criterion.checkDefinitionRef !== undefined && !registered.has(criterion.checkDefinitionRef))
    .map((criterion) => (criterion.kind === 'machine' ? criterion.checkDefinitionRef : undefined))
    .filter((ref): ref is string => ref !== undefined)
  if (unregisteredRefs.length > 0)
    unsupported.push(issue('criteria_check_unregistered', 'criteria', `配置引用了未登记的检查：${unregisteredRefs.slice(0, 8).join(', ')}。`))
  // A suggestion is only reviewable if some registered machine check can verify it; a purely human
  // or purely optional selection is correctable input, not a draft.
  if (!criteria.some((criterion) => criterion.kind === 'machine' && criterion.required && criterion.checkDefinitionRef !== undefined && registered.has(criterion.checkDefinitionRef)))
    needs.push(issue('criteria_machine_required', 'criteria', '所选 criteria 中没有必需的已登记机器检查；请补充检查或改用项目默认 criteria。'))
  if (template.criteria === 'machine') notes.push('只复用已登记的机器检查；人工接受仍在原确认流程中进行。')

  // --- scope ----------------------------------------------------------------
  const projectScope: Scope = project.scope
  const requested = selectedPaths ?? (template.scope === 'project' ? Object.freeze([...projectScope.allowedPaths]) : undefined)
  const excluded = sortedUnique([...projectScope.excludedPaths, ...(selection.excludedPaths ?? [])]) ?? Object.freeze([] as string[])
  const invalidScopeEntries = [...(requested ?? []), ...excluded].filter((candidate) => !isRelativePath(candidate))
  if (invalidScopeEntries.length > 0)
    needs.push(issue('scope_path_outside_allowed', 'scope', '出现了不是项目相对路径的条目（不允许绝对路径、反斜杠或 ..）。'))
  let scopePaths: readonly string[] | undefined
  if (requested === undefined || requested.length === 0) {
    if (!memberRequired) needs.push(issue('scope_paths_required', 'scope', '请显式列出本次工作涉及的项目相对路径；无边界变更不会自动生成。'))
  } else {
    const outside = requested.filter(isRelativePath).filter((candidate) => !projectScope.allowedPaths.some((allowed) => pathWithin(candidate, allowed)))
    if (outside.length > 0) needs.push(issue('scope_path_outside_allowed', 'scope', `以下路径不在项目授权范围内：${outside.slice(0, 8).join(', ')}。`))
    else scopePaths = requested
  }

  if (unsupported.length > 0) return emit({ ...envelope(facts, template, kind, provenance, notes), status: 'unsupported', unsupported: dedupe(unsupported) })
  if (needs.length > 0) return emit({ ...envelope(facts, template, kind, provenance, notes), status: 'needs_input', needsInput: dedupe(needs) })

  const scope: Scope = {
    projectId: project.id,
    allowedPaths: [...(scopePaths ?? [])],
    excludedPaths: [...excluded],
    externalActions: [],
    ...(projectScope.expiresAt === undefined ? {} : { expiresAt: projectScope.expiresAt }),
  }
  return emit({
    ...envelope(facts, template, kind, provenance, notes),
    status: 'draft',
    goal: template.goal(project.displayName),
    scope,
    criteria: [...criteria],
    profileId: profileId as string,
  })
}
