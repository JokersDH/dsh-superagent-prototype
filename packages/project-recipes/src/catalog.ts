/**
 * Versioned recipe catalog.
 *
 * A recipe is a fixed, reviewable declaration of *what kind of work* the caller is asked to draft:
 * a goal sentence, whether the suggestion must narrow the project scope, and which existing
 * criteria it may reuse. Entries contain no executable, argv, shell text, install step or approval
 * token. Changing an entry's meaning requires a new `version`, so a draft records exactly which
 * revision it was produced from.
 */

export const RECIPE_CATALOG_ID = 'project-recipes' as const
/** Catalog protocol version. A draft carries this number plus the catalog digest. */
export const RECIPE_CATALOG_VERSION = 1 as const

/** The three practical task kinds this product ships. */
export const RECIPE_KINDS = ['regression_fix', 'scoped_change', 'verification_followup'] as const
export type RecipeKind = (typeof RECIPE_KINDS)[number]

export type RecipeId = RecipeKind

export interface RecipeTemplate {
  readonly id: RecipeId
  readonly version: number
  readonly title: string
  readonly summary: string
  /**
   * `narrowed` requires explicit project-relative paths from the caller: an unbounded change is not
   * a bounded suggestion. `project` may reuse the configured project scope as-is.
   */
  readonly scope: 'narrowed' | 'project'
  /** `all` reuses every configured default criterion; `machine` reuses only registered machine checks. */
  readonly criteria: 'all' | 'machine'
  /** Deterministic goal sentence built only from trusted configuration text. */
  readonly goal: (projectDisplayName: string) => string
}

export const RECIPE_CATALOG: Readonly<Record<RecipeKind, RecipeTemplate>> = Object.freeze({
  regression_fix: Object.freeze({
    id: 'regression_fix',
    version: 1,
    title: '缺陷回归修复',
    summary: '针对已报告的缺陷做最小修复，并用项目已有的登记检查证明没有回归。',
    scope: 'narrowed',
    criteria: 'all',
    goal: (displayName: string) => `修复「${displayName}」中已报告的缺陷，在改动范围内补充可复现的回归证据，并让已登记检查重新通过。`,
  }),
  scoped_change: Object.freeze({
    id: 'scoped_change',
    version: 1,
    title: '有限范围变更',
    summary: '在明确列出的项目相对路径内实现有限变更，不扩大到未授权路径。',
    scope: 'narrowed',
    criteria: 'all',
    goal: (displayName: string) => `在「${displayName}」的明确授权范围内完成本次有限变更，改动不得外溢到列出范围之外的路径。`,
  }),
  verification_followup: Object.freeze({
    id: 'verification_followup',
    version: 1,
    title: '既有检查验证跟进',
    summary: '不新增执行能力：只跟进项目已登记检查的结果，处理失败项后重新验证。',
    scope: 'project',
    criteria: 'machine',
    goal: (displayName: string) => `跟进「${displayName}」已登记检查的验证结果，定位失败项并在原范围内处理后重新验证。`,
  }),
} satisfies Record<RecipeKind, RecipeTemplate>)

/** The catalog digest recorded in every draft; depends only on the frozen catalog content. */
export const recipeCatalogEntries = (): readonly RecipeTemplate[] => RECIPE_KINDS.map((kind) => RECIPE_CATALOG[kind])

export function isRecipeKind(value: unknown): value is RecipeKind {
  return typeof value === 'string' && (RECIPE_KINDS as readonly string[]).includes(value)
}
