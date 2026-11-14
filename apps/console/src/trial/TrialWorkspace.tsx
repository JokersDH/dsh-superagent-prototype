/**
 * Trial workspace: a display-only view over the published TrialReadiness projection. It receives data
 * through props, renders the real states and hands the four navigation names back to main. It never
 * fetches on its own, never sends a command and never creates a second authorization or execution path.
 */
import { useId, useRef } from 'react'
import {
  Activity, ArrowUpRight, Bot, ClipboardList, FolderCheck, FolderPlus, Gauge, Info, LockKeyhole, MessageSquare,
  RefreshCw, Settings2, TriangleAlert,
} from 'lucide-react'
import type { ApplicationConfiguration, TrialNavigationAction, TrialReadiness } from '@personal-agent/contracts'
import type { TrialInsightsLayer, TrialInsightsView } from './insights.ts'
import { trialInsightsAdmission, trialInsightsCount } from './insights.ts'
import type { TrialRecipeSuggestion } from './recipes.ts'
import { trialRecipeContext, trialRecipeOutcome, trialRecipeSuggestionsForProject } from './recipes.ts'
import type { TrialStatusValue, TrialTone } from './trial-view.ts'
import { formatObservedAt, shortRevision, trialActions, trialHeadline, trialProjectValue, trialStrip } from './trial-view.ts'
import './trial.css'

export interface TrialWorkspaceProps {
  readonly readiness?: TrialReadiness | undefined
  readonly loading?: boolean | undefined
  readonly error?: string | undefined
  readonly unavailable?: boolean | undefined
  readonly configuration?: ApplicationConfiguration | undefined
  readonly activeProjectId?: string | undefined
  readonly activeConversationTitle?: string | undefined
  readonly insights?: TrialInsightsView | undefined
  readonly recipes?: readonly TrialRecipeSuggestion[] | undefined
  readonly recipesLoading?: boolean | undefined
  readonly recipesError?: string | undefined
  readonly onPrepareRecipe?: ((suggestion: TrialRecipeSuggestion) => void) | undefined
  readonly onAction: (action: TrialNavigationAction) => void
  readonly onReload?: (() => void) | undefined
  readonly headingLevel?: 2 | 3 | undefined
  readonly className?: string | undefined
}

const actionIcon = {
  configure_model: Settings2,
  import_project: FolderPlus,
  inspect_executor: Bot,
  open_conversation: MessageSquare,
} as const

function StatusValue({ value }: { readonly value: TrialStatusValue }) {
  return (
    <dd className="trial-value">
      <span className={`trial-dot tone-${value.tone}`} aria-hidden="true" />
      <span className="trial-value-text">
        <strong>{value.label}</strong>
        {value.detail !== undefined && <small>{value.detail}</small>}
      </span>
    </dd>
  )
}

const placeholderValue = (label: string, detail: string, tone: TrialTone): TrialStatusValue => ({ label, detail, tone })

const layerLabel: Record<TrialInsightsLayer, string> = {
  observed: '界面观察', controlled: '受控流程', native: '原生执行', operator: '人工输入', unknown: '来源未知',
}

function CapabilityRow({ label, available }: { readonly label: string; readonly available: boolean | undefined }) {
  const tone: TrialTone = available === true ? 'ok' : 'neutral'
  return (
    <div className="trial-fact">
      <dt>{label}</dt>
      <dd>
        <span className={`trial-dot tone-${tone}`} aria-hidden="true" />
        {available === undefined ? '未观察' : available ? '已提供' : '未提供'}
      </dd>
    </div>
  )
}

function CountRow({ label, value, detail }: { readonly label: string; readonly value: string; readonly detail?: string }) {
  return (
    <div className="trial-fact">
      <dt>{label}</dt>
      <dd><span>{value}</span>{detail !== undefined && <small>{detail}</small>}</dd>
    </div>
  )
}

export function TrialWorkspace({
  readiness, loading = false, error, unavailable = false, configuration, activeProjectId,
  activeConversationTitle, insights, recipes, recipesLoading = false, recipesError, onPrepareRecipe,
  onAction, onReload, headingLevel = 2, className,
}: TrialWorkspaceProps) {
  const base = useId()
  const titleId = `${base}-title`
  const nextId = `${base}-next`
  const projectsId = `${base}-projects`
  const executorsId = `${base}-executors`
  const insightsId = `${base}-insights`
  const recipesId = `${base}-recipes`
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const strip = readiness === undefined ? undefined : trialStrip(readiness)
  const actions = trialActions({
    ...(readiness === undefined ? {} : { readiness }),
    ...(configuration === undefined ? {} : { configuration }),
    ...(unavailable ? { unavailable } : {}),
  })
  const lastAction = useRef<{ action: TrialNavigationAction; at: number } | undefined>(undefined)
  const run = (action: TrialNavigationAction) => {
    const now = Date.now()
    // A double click is one navigation, not two: ignore the same callback within 300ms.
    if (lastAction.current !== undefined && lastAction.current.action === action && now - lastAction.current.at < 300) return
    lastAction.current = { action, at: now }
    onAction(action)
  }
  const phase = readiness !== undefined ? 'observed' : loading ? 'loading' : error !== undefined ? 'error' : unavailable ? 'unavailable' : 'idle'
  const observed = readiness === undefined ? undefined : formatObservedAt(readiness.observedAt)
  const capabilities = readiness?.capabilities
  const insightAdmission = insights === undefined ? undefined : trialInsightsAdmission(insights, activeProjectId)
  const activeProjectLabel = activeProjectId === undefined
    ? '全部项目'
    : configuration?.projects.find(project => project.id === activeProjectId)?.displayName ?? '当前项目（名称未读取）'
  const recipeList = recipes === undefined ? undefined : trialRecipeSuggestionsForProject(recipes, activeProjectId)
  const recipeContext = trialRecipeContext(configuration, activeProjectId)
  const recipeRows = recipeList?.slice(0, 6).map(suggestion => ({ suggestion, outcome: trialRecipeOutcome(suggestion, recipeContext) }))
  const lastRecipe = useRef<{ id: string; at: number } | undefined>(undefined)
  const prepareRecipe = (suggestion: TrialRecipeSuggestion) => {
    if (onPrepareRecipe === undefined) return
    const now = Date.now()
    if (lastRecipe.current !== undefined && lastRecipe.current.id === suggestion.id && now - lastRecipe.current.at < 300) return
    lastRecipe.current = { id: suggestion.id, at: now }
    onPrepareRecipe(suggestion)
  }

  return (
    <section
      className={`workspace-view trial-view${className === undefined ? '' : ` ${className}`}`}
      aria-labelledby={titleId}
      aria-busy={loading}
      data-trial-state={phase}
    >
      <header className="view-header trial-header">
        <div className="trial-heading">
          <Heading className="view-title" id={titleId}>试用准备</Heading>
          <p className="view-description">配置与入口的只读观察 · 不授予执行</p>
        </div>
        <div className="trial-header-meta">
          {loading && readiness !== undefined && <span className="trial-refreshing" role="status">正在刷新…</span>}
          {observed !== undefined && <span className="trial-observed">观测于 {observed}</span>}
          {onReload !== undefined && (
            <button
              type="button"
              className="icon-button"
              title="重新读取试用状态"
              aria-label="重新读取试用状态"
              aria-disabled={loading || undefined}
              onClick={() => { if (!loading) onReload() }}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      <div className="view-content trial-content">
        {error !== undefined && (
          <div className="trial-banner trial-banner-danger" role="alert">
            <TriangleAlert size={17} aria-hidden="true" />
            <p>
              <strong>无法读取试用状态</strong>
              <span>{error}{observed === undefined ? '' : ` 以下仍是上次读取结果（${observed}）。`}</span>
            </p>
            {onReload !== undefined && (
              <button type="button" className="quiet" aria-disabled={loading || undefined} onClick={() => { if (!loading) onReload() }}>重试</button>
            )}
          </div>
        )}
        {unavailable && (
          <div className="trial-banner" role="status">
            <Info size={17} aria-hidden="true" />
            <p>
              <strong>当前服务未提供试用状态接口</strong>
              <span>{observed === undefined ? '既有视图仍可继续使用。' : `以下为上次读取结果（${observed}），本次刷新没有取得新状态。`}</span>
            </p>
          </div>
        )}
        {readiness === undefined && loading && (
          <p className="trial-loading" role="status">正在读取试用状态…</p>
        )}

        <dl className="trial-strip" aria-label="准备状态">
          <div className="trial-cell">
            <dt>运行模式</dt>
            <StatusValue value={strip?.mode ?? placeholderValue('未观察', readiness === undefined ? '等待读取' : '—', 'neutral')} />
          </div>
          <div className="trial-cell">
            <dt>对话模型</dt>
            <StatusValue value={strip?.discussion ?? placeholderValue('未观察', readiness === undefined ? '等待读取' : '—', 'neutral')} />
          </div>
          <div className="trial-cell">
            <dt>开发执行</dt>
            <StatusValue value={strip?.development ?? placeholderValue('未观察', readiness === undefined ? '等待读取' : '—', 'neutral')} />
          </div>
        </dl>

        <section className="trial-next" aria-labelledby={nextId}>
          <div className="trial-next-text">
            <h3 id={nextId} className="trial-section-title">下一步</h3>
            <p className="trial-sentence">{trialHeadline({
              ...(readiness === undefined ? {} : { readiness }),
              ...(configuration === undefined ? {} : { configuration }),
              ...(unavailable ? { unavailable } : {}),
            })}</p>
          </div>
          <div className="trial-actions" role="group" aria-label="可执行的下一步">
            {actions.map(({ action, label, primary }) => {
              const Icon = actionIcon[action]
              return (
                <button
                  key={action}
                  type="button"
                  className={primary ? 'trial-primary' : 'quiet'}
                  data-trial-action={action}
                  onClick={() => run(action)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                  {primary && <ArrowUpRight size={14} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        </section>

        <div className="trial-details">
          <section className="trial-panel" aria-labelledby={projectsId}>
            <div className="trial-panel-head">
              <h3 id={projectsId} className="trial-section-title"><FolderCheck size={15} aria-hidden="true" />项目</h3>
              <span className="trial-panel-meta">
                {readiness === undefined
                  ? (configuration === undefined ? '项目明细未读取' : `共 ${configuration.projects.length} 个项目 · 派工状态待读取`)
                  : `开发 ${readiness.projects.development} · 讨论 ${readiness.projects.discussion} · 可派工 ${readiness.projects.dispatchable}`}
              </span>
            </div>
            {configuration === undefined
              ? <p className="trial-muted">项目明细尚未读取。</p>
              : configuration.projects.length === 0
                ? <p className="trial-muted">还没有项目。导入后即可在对话中明确委托开发。</p>
                : (
                  <ul className="trial-projects" aria-label="已配置项目">
                    {configuration.projects.map(project => {
                      const value = trialProjectValue(project, activeProjectId)
                      return (
                        <li key={project.id} className="trial-project" aria-current={value.active ? 'true' : undefined}>
                          <span className={`trial-dot tone-${value.tone}`} aria-hidden="true" />
                          <span className="trial-project-body">
                            <span className="trial-project-name" title={project.displayName}>{value.label}</span>
                            <span className="trial-project-detail">{value.detail}</span>
                          </span>
                          {value.active && <span className="trial-current">当前</span>}
                        </li>
                      )
                    })}
                  </ul>
                )}
          </section>

          <section className="trial-panel trial-panel-side" aria-labelledby={executorsId}>
            <div className="trial-panel-head">
              <h3 id={executorsId} className="trial-section-title"><Gauge size={15} aria-hidden="true" />执行器与能力</h3>
              {readiness?.startupMode === 'recovery_readonly' && <span className="trial-panel-meta trial-readonly-mark"><LockKeyhole size={12} aria-hidden="true" />只读</span>}
            </div>
            <dl className="trial-facts">
              <CountRow label="当前项目" value={activeProjectLabel} />
              <CountRow label="当前对话" value={activeConversationTitle ?? '主对话'} />
              <CountRow
                label="原生执行器"
                value={readiness === undefined ? '未观察' : `${readiness.profiles.native} 个`}
                {...(readiness === undefined ? {} : { detail: `已准入 ${readiness.profiles.admittedNative}` })}
              />
              <CountRow
                label="固定流程"
                value={readiness === undefined ? '未观察' : `${readiness.profiles.controlled} 个`}
                {...(readiness === undefined ? {} : { detail: `已准入 ${readiness.profiles.admittedControlled}` })}
              />
              <CapabilityRow label="上下文历史" available={capabilities?.contextHistory} />
              <CapabilityRow label="来源审阅" available={capabilities?.contextSources} />
              <CapabilityRow label="项目决定" available={capabilities?.decisions} />
              <CapabilityRow label="提案" available={capabilities?.proposals} />
            </dl>
            <p className="trial-note">功能入口来自当前配置，不代表已实际运行或通过验收。</p>
          </section>
        </div>

        {(recipes !== undefined || recipesLoading || recipesError !== undefined) && (
          <section className="trial-recipes" aria-labelledby={recipesId}>
            <div className="trial-panel-head">
              <h3 id={recipesId} className="trial-section-title"><ClipboardList size={15} aria-hidden="true" />配方草案</h3>
              <span className="trial-panel-meta">只读声明 · 不执行</span>
            </div>
            {recipesError !== undefined && <p className="trial-muted" role="alert">配方草案暂时无法读取；原委托表单仍可使用。</p>}
            {recipesLoading && <p className="trial-muted" role="status">正在读取项目声明…</p>}
            {!recipesLoading && recipesError === undefined && recipeList !== undefined && recipeList.length === 0 && (
              <p className="trial-muted">该项目没有可用的声明草案。</p>
            )}
            {recipeRows !== undefined && recipeRows.length > 0 && (
              <ul className="trial-recipe-list" aria-label="项目声明草案">
                {recipeRows.map(({ suggestion, outcome }) => (
                  <li key={suggestion.id} className="trial-recipe">
                    <div className="trial-recipe-head">
                      <strong className="trial-recipe-title">{suggestion.title}</strong>
                      <span className={`trial-recipe-status status-${suggestion.status}`}>{outcome.statusLabel}</span>
                    </div>
                    {outcome.goalPreview.length > 0 && <p className="trial-recipe-goal">{outcome.goalPreview}</p>}
                    <p className="trial-recipe-meta">
                      {suggestion.projectId === null ? '项目未声明' : '项目已声明'}
                      {' · '}检查 {outcome.checks.filter(check => check.state === 'available').length}/{outcome.checks.length}
                      {' · '}执行器 {outcome.profiles.filter(profile => profile.state === 'available').length}/{outcome.profiles.length}
                      {suggestion.scopeNote === null ? '' : ` · ${suggestion.scopeNote}`}
                    </p>
                    {outcome.reasons.length > 0 && (
                      <ul className="trial-recipe-reasons">
                        {outcome.reasons.map(reason => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                    {onPrepareRecipe !== undefined && (
                      <button type="button" className="quiet trial-recipe-prepare" disabled={!outcome.applicable}
                        onClick={() => { if (outcome.applicable) prepareRecipe(suggestion) }}>
                        准备草案
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {recipeList !== undefined && recipeList.length > 6 && (
              <p className="trial-note">另有 {recipeList.length - 6} 条草案未显示。</p>
            )}
            <p className="trial-note">选择只会把草案数据交回原委托表单；创建、检查与执行仍由你在原确认页决定。</p>
          </section>
        )}

        {insights !== undefined && insightAdmission !== undefined && (
          <section className="trial-insights" aria-labelledby={insightsId}>
            <div className="trial-panel-head">
              <h3 id={insightsId} className="trial-section-title"><Activity size={15} aria-hidden="true" />使用观察</h3>
              <span className="trial-panel-meta">
                {trialInsightsCount(insights)}
                {' · '}{insights.windowLabel ?? '窗口未声明'}
                {' · '}{insights.coverage ?? '覆盖未声明'}
              </span>
            </div>
            <dl className="trial-insight-scope">
              <div className="trial-fact">
                <dt>观测范围</dt>
                <dd>{insightAdmission.scopeLabel ?? '未声明'}</dd>
              </div>
              <div className="trial-fact">
                <dt>来源与未知</dt>
                <dd>
                  {insights.scope?.aggregation === 'declared_multi_project' ? '声明多项目'
                    : insights.scope?.aggregation === 'cross_project' ? '跨项目聚合'
                      : insights.scope?.aggregation === 'single_project' ? '单项目' : '聚合未声明'}
                  {' · '}
                  {insights.sources !== undefined
                    ? `来源已知 ${insights.sources.known ?? '未知'} · 未知 ${insights.sources.unknown ?? '未知'}`
                    : insights.unknownCount === undefined || insights.unknownCount === null ? '未知数未声明' : `${insights.unknownCount} 个未知`}
                </dd>
              </div>
            </dl>
            {insightAdmission.rows.length === 0
              ? <p className="trial-muted" role="status">{insightAdmission.message ?? '暂不展示指标。'}</p>
              : (
                <dl className="trial-insight-rows">
                  {insightAdmission.rows.map(metric => (
                    <div key={metric.id} className="trial-insight-row">
                      <dt>{metric.label}</dt>
                      <dd className={metric.value === null ? 'trial-unknown' : undefined}>
                        {metric.value ?? '未知'}
                        {metric.unit !== undefined && <small>{metric.unit}</small>}
                        {metric.currency !== undefined && <small>{metric.currency}</small>}
                        {metric.layer !== undefined && <small>{layerLabel[metric.layer]}</small>}
                        {metric.sampleCount !== undefined && <small>{metric.sampleCount === null ? '样本未知' : `${metric.sampleCount} 个样本`}</small>}
                        {metric.detail !== undefined && <small>{metric.detail}</small>}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            {insights.limitations.length > 0 && (
              <ul className="trial-limits">
                {insights.limitations.map(limit => <li key={limit}>{limit}</li>)}
              </ul>
            )}
          </section>
        )}

        <footer className="trial-boundary">
          <span>只读配置观察</span>
          <span>未授予执行权限</span>
          <span>不含项目路径、凭据或模型端点</span>
          {readiness !== undefined && <span className="trial-mono">配置 {shortRevision(readiness.configurationRevision)}</span>}
        </footer>
      </div>
    </section>
  )
}
