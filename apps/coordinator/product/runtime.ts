import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { ApplicationConversations, ApplicationFault, createProductApplication } from '@personal-agent/application'
import type { ApplicationOptions } from '@personal-agent/application'
import { sharedAttentionRanker } from '@personal-agent/routing'
import { recoveryTargetInventory } from '@personal-agent/storage'
import type { AssistantContextBindings, AssistantContextHistory, AssistantContextPrepare, AssistantContextSend, AssistantReplyResults, AttentionRanker, ContextPreviewInput, ConversationCommand, DecisionCommand, DecisionPrepare, NativeQuestionBinding, ProjectSettingsCommand, ProposalCommand, ProposalPrepare, RecoveryActivationCommit, RecoveryPrepare, RecoveryTargetInventoryReader, RecoveryTargetMaterial, RecoveryTargetMaterializer, RecoveryTargetPrepareInput, ReviewActivity, Scope, TrustedActor } from '@personal-agent/contracts'
import { ExecutionProfileViewSchema, ExecutionUnavailableReasonSchema, WorkEvidenceSchema } from '@personal-agent/contracts'
import type { AgentProfile, ExecutionUnavailableReason, RecoverySourcePrepare, RecoverySourceConfirm, RecoveryTargetAuthorize } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import type { Ticket } from '@personal-agent/orchestrator-core'
import { CheckRegistry } from '@personal-agent/verification'
import { WorkspaceManager } from '@personal-agent/workspaces'
import { scopeWithin } from '@personal-agent/questions'
import type { LocalHttpOptions } from '../http/app.ts'
import { ProductCompletion } from './completion.ts'
import { FIXTURE_PROFILES, ProductExecution } from './execution.ts'
import { applicationConfiguration } from './configuration.ts'
import { handleAssistantReplies } from './assistant-replies.ts'
import type { PrivateModelProvider } from './model-provider.ts'
import { ModelProviderError } from './model-provider.ts'
import { AssistantStreams } from './assistant-streams.ts'
import type { NativeProductConfiguration, ProductExecutorConfiguration } from './native-config.ts'
import { executorProfiles, executorProfileRef, executorAdmissionCurrent } from './executor-profiles.ts'
import type { NativeRunnerLinkFactory } from './native-attempt.ts'
import type { NativeProjectRegistry } from './project-registry.ts'
import { ProductEnvironments } from './environments.ts'
import { ProductProjectSettings } from './project-settings.ts'
import { ProductReviewTiming } from './review-timing.ts'
import { ProductAttention } from './attention.ts'
import { ProductDecisions } from './decisions.ts'
import { projectAcceptedOutcome } from './accepted-outcomes.ts'
import { ProductRecovery } from './recovery.ts'
import { ProductRecoverySource } from './recovery-source-confirmation.ts'
import { ProductProposals } from './proposals.ts'
import { readRecoveryActivationRecord } from './recovery-intents.ts'
import { ProductEvidenceHistory } from './evidence-history.ts'
import { ProductCompletionHistory } from './completion-history.ts'
import { ProductContextPreview } from './context-preview.ts'
import { ProductAssistantContext } from './assistant-context-use.ts'
import { ProductRecoveryTargets } from './recovery-target-service.ts'
import { initializeRecoveryTarget } from './recovery-target-initializer.ts'
import { ProductRecoveryTargetAuthorization } from './recovery-target-authorization.ts'
import { localRecoveryMaterializer } from './recovery-materializer.ts'
import { admittedNativeProfile } from './native-startup.ts'
import { ProductExecutorTrials } from './executor-trial.ts'
import type { NativeExecutorInspection } from './native-inspection.ts'
import { CompletedAssistantReplies } from './assistant-reply-results.ts'
import { ProductContextRecords } from './context-records.ts'
import { createDiscussionEffects } from './discussion-effects.ts'
import type { ExecutionConsumer } from './discussion-effects.ts'
import { ProductUsageObservation } from './usage-observation.ts'
import { ProductProjectRecipes } from './project-recipes.ts'

export const FIXTURE_CHECK = 'check-fixture-output'
/** Operator-selected fixed executable/argv; contract or user text can only reference its registered ID. */
export function createProductRuntime(
  options: Omit<ApplicationOptions, 'completion' | 'nativeFence' | 'profileIds' | 'registeredChecks' | 'executionEnabled'> & {
    stateRoot: string
    scratchProject: string
    assistantProvider?: PrivateModelProvider
    native?: NativeProductConfiguration
    /** Trusted installed adapters; a request cannot register implementations or policy functions. */
    executors?: readonly ProductExecutorConfiguration[]
    /** Trusted in-process test/host port; never read from configuration or HTTP. */
    nativeRunnerLinkFactory?: NativeRunnerLinkFactory
    /** Trusted local composition capacity; the original queue/bindings remain the only owners. */
    maxActiveAttempts?: 2 | 4
    executionUnavailable?: ExecutionUnavailableReason
    /** Trusted local probe only. This port cannot be selected or supplied by an HTTP request. */
    inspectExecutor?: (profileId?: string) => Promise<NativeExecutorInspection>
    inspectedProfiles?: readonly import('@personal-agent/contracts').ExecutionProfileView[]
    projectRegistry?: NativeProjectRegistry
    workspaceRoot?: string
    startupMode?: 'normal' | 'recovery_readonly'
    attentionRanker?: AttentionRanker
    assistantContextBindings?: AssistantContextBindings
    assistantReplyResults?: AssistantReplyResults
    contextHistory?: AssistantContextHistory
    recoveryExecutor?: () => AgentProfile
    recoveryTargets?: {
      materializer: RecoveryTargetMaterializer
      inventory?: RecoveryTargetInventoryReader
      revalidateSource(commit: RecoveryActivationCommit): void
      initialize?(material: RecoveryTargetMaterial): Promise<void>
    }
  },
) {
  const unavailable = options.executionUnavailable === undefined ? undefined : ExecutionUnavailableReasonSchema.parse(options.executionUnavailable)
  const executors = executorProfiles(options.native, options.executors)
  const hasNative = executors.length > 0
  if (unavailable && hasNative) throw new TypeError('Unavailable execution cannot contain an admitted native runtime')
  for (const input of options.inspectedProfiles ?? []) {
    const view = ExecutionProfileViewSchema.parse(input)
    if (view.kind !== 'native' || view.dispatchAllowed) throw new TypeError('Diagnostic profiles never authorize a runtime')
  }
  if (options.native?.profileView) {
    const view = ExecutionProfileViewSchema.parse(options.native.profileView), profile = options.native.profile
    if (view.id !== profile.id || view.revision !== profile.revision || view.driverId !== profile.driverId || view.kind !== 'native' || !view.dispatchAllowed)
      throw new TypeError('The native public projection must match the trusted admitted runtime profile')
    if (view.trialAdmission && !options.native.admissionCurrent)
      throw new TypeError('Trial runtime admission requires a trusted fresh identity and receipt check')
  }
  // A real native runtime never offers the fixed scratch executors as a selectable alternative.
  const fixtureProfiles = unavailable || hasNative ? [] : FIXTURE_PROFILES
  options = {
    ...options,
    principal: structuredClone(options.principal),
    projects: options.projects.map((project) => {
      if (unavailable || project.discussionOnly || options.startupMode === 'recovery_readonly' || executors.some(entry => entry.projects.some(native => native.id === project.id))) return structuredClone(project)
      const grant = structuredClone(project.scope)
      const scope: Scope = {
        projectId: project.id,
        allowedPaths: ['src/'],
        excludedPaths: [],
        externalActions: [],
        ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
      }
      if (!scopeWithin(scope, grant))
        throw new TypeError('Controlled fixture projects require the fixed src/ scratch grant')
      return { ...project, scope }
    }),
  }
  const configuredProjects = [...options.projects]
  const nativeProjects = [...new Map(executors.flatMap(entry => entry.projects).map(project => [project.id, project])).values()]
  const projectProfiles = new Map(nativeProjects.map(project => [project.id,
    executors.filter(entry => entry.projects.some(item => item.id === project.id)).map(entry => entry.profile.id)]))
  options = {
    ...options,
    projects: configuredProjects,
  }
  const environments = new ProductEnvironments(options.store, options.stateRoot)
  const workspaceRoot = options.workspaceRoot && (!unavailable || existsSync(options.workspaceRoot))
    ? options.workspaceRoot : join(options.stateRoot, 'workspaces')
  const workspaces = new WorkspaceManager(workspaceRoot, { environment: environments })
  const checks = new CheckRegistry()
  checks.register({
    id: FIXTURE_CHECK,
    revision: 1,
    executable: process.execPath,
    argv: [
      '--input-type=module',
      '-e',
      "import {readFileSync} from 'node:fs';process.exit(readFileSync('src/product-output.txt','utf8')==='approved product output\\n'?0:1)",
    ],
    deadlineMs: 2000,
    outputLimitBytes: 64 * 1024,
  })
  const versionedProjectIds = new Set(options.projectRegistry?.list().map(project => project.id) ?? [])
  for (const entry of executors) for (const project of entry.projects) if (!versionedProjectIds.has(project.id)) checks.register(project.check)
  const projectSettings = hasNative && options.projectRegistry
    ? new ProductProjectSettings(options.store, options.projectRegistry, checks, options.principal, executors.map(entry => entry.profile.id)) : undefined
  if (projectSettings) for (const record of options.projectRegistry!.list())
    projectSettings.register(record, nativeProjects.find(project => project.id === record.id))
  const completion = new ProductCompletion(options.store, workspaces, checks, {
    environment: attemptId => {
      const binding = options.store.bindings.binding(attemptId)
      return binding ? environments.checkEnvironment(binding) : undefined
    },
  })
  let execution: ExecutionConsumer | undefined
  const application = createProductApplication({
    ...options,
    profileIds: [...executors.map(entry => entry.profile.id), ...fixtureProfiles],
    executionProfile: id => { const entry = executors.find(entry => entry.profile.id === id); return entry && executorProfileRef(entry) },
    canSupplement: ticketId => execution instanceof ProductExecution && execution.canSupplement(ticketId),
    executionEnabled: !unavailable,
    registeredChecks: checks.ids(),
    registeredCheck: id => !!checks.latest(id),
    projectGrant: input => {
      const executor = executors.find(entry => entry.profile.id === input.profileId)
      if (executor && (!projectProfiles.get(input.projectId)?.includes(input.profileId) || input.newWork && !executorAdmissionCurrent(executor)))
        throw new ApplicationFault('unsupported_capability', '执行器身份或策略已变化，请正常重开并重新核对；原工作保留。', 'user_action')
      return projectSettings?.authorize(input.projectId, input.profileId, input.criteria, input.newWork)
    },
    completion,
    verificationRecovery: {
      blocked: candidate => execution?.verificationBlocked(candidate) ?? false,
      retry: (candidate, blockedId) => {
        if (!execution) throw new ApplicationFault('unsupported_capability', 'Verification recovery is not ready')
        execution.retryVerification(candidate, blockedId)
      },
    },
    assistantReplies: options.assistantProvider !== undefined,
    projectPreflight: async (projectId) => {
      if (projectSettings?.has(projectId)) { projectSettings.preflight(projectId); return }
      const record = options.projectRegistry?.list().find((project) => project.id === projectId)
      if (record)
        options.projectRegistry!.prepare({ path: record.path, displayName: record.displayName, check: record.check,
          ...(record.environment ? { environment: record.environment } : {}) })
    },
    nativeFence: (target: NativeQuestionBinding) => execution?.nativeFence(target) ?? 'unknown',
  })
  execution = unavailable ? createDiscussionEffects(options.store) : new ProductExecution(
    options.store,
    application,
    workspaces,
    completion,
    options.scratchProject,
    options.stateRoot,
    options.principal,
    options.native,
    environments,
    projectSettings ? contract => projectSettings.has(contract.scope.projectId) ? projectSettings.forContract(contract)
      : nativeProjects.find(project => project.id === contract.scope.projectId) : undefined,
    options.nativeRunnerLinkFactory,
    options.maxActiveAttempts,
    options.executors,
  )
  const { store } = options
  const executorTrials = options.startupMode !== 'recovery_readonly' && options.inspectExecutor
    ? new ProductExecutorTrials({ store, principal: options.principal, inspect: options.inspectExecutor }) : undefined
  const replyResults = options.assistantReplyResults ??
    (store.workflows.assistant as typeof store.workflows.assistant & { replyResults?: AssistantReplyResults }).replyResults
  const completedReplies = replyResults ? new CompletedAssistantReplies(store, replyResults, options.principal,
    () => configuredProjects.map(project => project.id)) : undefined
  let assistantContext: ProductAssistantContext | undefined
  let contextRecords: ProductContextRecords | undefined
  const reviewTiming = new ProductReviewTiming(store, application, completion, options.principal, () => configuredProjects.map(project => project.id))
  completion.onAccepted = (candidate, actor, at) => {
    const eventSeq = reviewTiming.accepted(candidate, actor, at)
    const result = projectAcceptedOutcome(store, eventSeq, candidate)
    if (result.status === 'conflict') throw new ApplicationFault('verification_failed', 'Accepted outcome source identity conflicts')
  }
  const conversations = new ApplicationConversations(store, options.principal, () => configuredProjects.map(project => project.id), options.actionSecret)
  const decisions = new ProductDecisions(store, options.principal, () => configuredProjects, options.actionSecret, options.now)
  const proposals = new ProductProposals(store, application, decisions, options.principal, () => configuredProjects, options.actionSecret, options.now, completedReplies)
  const recovery = new ProductRecovery(store, { stateRoot: options.stateRoot, startupMode: options.startupMode ?? 'normal',
    principal: options.principal, projects: () => configuredProjects, ...(options.now ? { now: options.now } : {}),
    ...(options.recoveryExecutor ? { executor: options.recoveryExecutor } : {}) })
  const recoverySource = new ProductRecoverySource(store, recovery, { stateRoot: options.stateRoot,
    startupMode: options.startupMode ?? 'normal', principal: options.principal, secret: options.actionSecret,
    ...(options.now ? { now: options.now } : {}) })
  const defaultTargets = options.startupMode === 'recovery_readonly' && !options.recoveryTargets
  const revalidateSource = (commit: RecoveryActivationCommit) => recoverySource.revalidateCommitted(commit)
  const targetPorts = options.recoveryTargets ?? (defaultTargets ? { materializer: localRecoveryMaterializer(), revalidateSource } : undefined)
  const targetAuthorizer = defaultTargets ? new ProductRecoveryTargetAuthorization({ principal: options.principal,
    executor: options.recoveryExecutor ?? admittedNativeProfile,
    revalidateSource: (commit, configuration) => recoverySource.revalidateCommitted(commit, configuration),
    ...(options.now ? { now: options.now } : {}) }) : undefined
  const recoveryTargets = targetPorts ? new ProductRecoveryTargets({ store, principal: options.principal, stateRoot: options.stateRoot,
    materializer: targetPorts.materializer, inventory: options.recoveryTargets?.inventory ?? recoveryTargetInventory,
    revalidateSource: targetPorts.revalidateSource, initialize: options.recoveryTargets?.initialize ?? initializeRecoveryTarget,
    ...(targetAuthorizer ? { authorizer: targetAuthorizer } : {}), ...(options.now ? { now: options.now } : {}) }) : undefined
  const attention = new ProductAttention(store, application, completion, {
    projectIds: () => configuredProjects.map(project => project.id), verification: work => execution!.verificationStatus(work),
    ranker: options.attentionRanker ?? sharedAttentionRanker, ...(options.now ? { now: options.now } : {}),
  })
  const assistantStreams = new AssistantStreams()
  const evidenceHistory = new ProductEvidenceHistory(store, application, () => configuredProjects.map(project => project.id), options.actionSecret, options.now)
  const completionHistory = new ProductCompletionHistory(store, application, () => ({ principal: options.principal,
    projects: configuredProjects.map(project => ({ id: project.id, scope: projectSettings?.has(project.id)
      ? projectSettings.read(project.id).current : project.scope })) }), options.actionSecret, options.now)
  if (options.assistantProvider)
    handleAssistantReplies(execution.effects, store, options.assistantProvider, assistantStreams, {
      nativeExecution: hasNative,
      executionUnavailable: !!unavailable,
      canReply: message => configuredProjects.some(project => project.id === message.projectId),
      proposalScope: projectId => configuredProjects.find(project => project.id === projectId)?.scope,
      ...(completedReplies ? { completed: completedReplies } : {}),
      context: message => assistantContext?.forMessage(message) ?? Promise.resolve(undefined),
    })
  const usage = new ProductUsageObservation({ projectIds: () => configuredProjects.map(project => project.id),
    cursor: () => store.events.cursor(), listWorks: (projectIds, limit) => store.workflows.index.listWorks({ projectIds, limit }),
    workEvidence: workId => read.workEvidence!(workId) }, options.now)
  const read: NonNullable<LocalHttpOptions['read']> = {
    projectRecipePreview: input => recipes.preview(input),
    usageObservation: query => usage.read(query),
    usageObservationDownload: query => usage.download(query),
    usageSupportDownload: query => usage.support(query),
    recovery: async () => recovery.inspect(),
    ...(executorTrials ? { executorTrialInspection: (profileId?: string) => executorTrials.read(profileId),
      executorTrialReceipt: async (id: string) => executorTrials.receipt(id) } : {}),
    recoveryActivation: async activationId => readRecoveryActivationRecord(store, activationId, options.principal),
    ...(completedReplies ? { replyCandidates: async (messageId: string) => proposals.replyCandidates(messageId) } : {}),
    ...(recoveryTargets ? { recoveryTarget: (id: string) => recoveryTargets.read(id),
      recoveryTargetAuthorization: (id: string) => recoveryTargets.authorization(id) } : {}),
    assistantContext: async messageId => assistantContext?.audit(messageId),
    contextHistory: async query => {
      if (!contextRecords) throw new ApplicationFault('unsupported_capability', 'Context history is not connected')
      return contextRecords.history(query)
    },
    contextSources: async (messageId, query) => contextRecords?.sources(messageId, query),
    workEvidenceHistory: (workId, query) => evidenceHistory.read(workId, query),
    workCompletionHistory: (workId, query) => completionHistory.read(workId, query),
    workEvidence: async workId => {
      const work = (await application.inspect({ workId })).works[0]
      if (!work) throw new ApplicationFault('forbidden', 'Work evidence is outside the configured scope', 'none')
      const timeline = store.workflows.index.timeline({ workId, projectIds: configuredProjects.map(project => project.id), limit: 500 })
      if (!timeline) throw new ApplicationFault('forbidden', 'Work timeline is outside the configured scope', 'none')
      const outcomes = timeline.entries.filter(entry => entry.kind === 'execution.outcome').map(entry => {
        const value = store.workflows.routingEvidence.outcomes.get(entry.sourceRef)
        if (!value || value.projectId !== work.work.projectId || value.attempt.contract.workId !== workId)
          throw new ApplicationFault('storage_unavailable', 'Outcome source identity mismatch', 'none')
        return value
      })
      const current = outcomes.some(value => value.acceptance === 'accepted' && value.attempt.contract.revision === work.contract.revision &&
        value.attempt.contract.digest === work.contract.digest && value.verificationRef === work.actions.currentVerificationId)
      return WorkEvidenceSchema.parse({ protocol: 'work-evidence/1', workId, entries: timeline.entries, outcomes, truncated: timeline.truncated,
        projection: current ? 'recorded' : work.phase === 'delivered' ? timeline.truncated ? 'not_in_window' : 'source_missing' : 'not_accepted' })
    },
    decisions: async query => decisions.list(query),
    attention: query => attention.read(query),
    ...(projectSettings ? { projectSettings: async (projectId: string) => projectSettings.read(projectId) } : {}),
    conversations: async query => conversations.list(query),
    conversation: async id => conversations.get(id),
    workVerification: async (workId) => {
      const work = (await application.inspect({ workId })).works[0]
      if (!work) throw new ApplicationFault('invalid_request', 'Unknown work')
      return execution!.verificationStatus(work)
    },
    ...((hasNative || unavailable) && options.projectRegistry
      ? {
          registerProject: async (input) => {
            const record = options.projectRegistry!.prepare(input)
            const check = options.projectRegistry!.check(record)
            const project = {
              id: record.id,
              displayName: record.displayName,
              scope: options.projectRegistry!.scope(record),
            }
            const existing = configuredProjects.find((item) => item.id === project.id)
            if (!existing) {
              options.projectRegistry!.save(record)
              if (!projectSettings && !unavailable) checks.register(check)
              application.registerProject(project, [check.id])
              configuredProjects.unshift(project)
              if (!unavailable) nativeProjects.unshift({ id: record.id, path: record.path, check,
                ...(record.environment ? { environment: options.projectRegistry!.environment(record)! } : {}) })
              if (!unavailable) projectProfiles.set(record.id, executors.map(entry => entry.profile.id))
              projectSettings?.register(record, nativeProjects[0])
            }
            return await read.configuration!()
          },
        }
      : {}),
    workExecution: async workId => {
      const work = (await application.inspect({ workId })).works[0]
      if (!work) throw new ApplicationFault('invalid_request', 'Unknown work')
      if (!(execution instanceof ProductExecution)) throw new ApplicationFault('unsupported_capability', 'Execution inspection is unavailable')
      return execution.workExecution(work)
    },
    workLocation: async (workId) => {
      const view = (await application.inspect({ workId })).works[0]
      if (!view) throw new ApplicationFault('invalid_request', 'Unknown work')
      const projectPath =
        nativeProjects.find((project) => project.id === view.work.projectId)?.path ??
        options.projectRegistry?.list().find(project => project.id === view.work.projectId)?.path ?? options.scratchProject
      const link = view.links.find(
        (link) => link.role === 'primary' && link.contract.revision === view.contract.revision,
      )
      const binding = link && options.store.bindings.current(link.ticketId)
      if (!binding) return { projectPath, workspacePath: null, baseCommit: null }
      try {
        const location = workspaces.location({ attemptId: binding.attemptId })
        return { projectPath: location.projectPath, workspacePath: location.path, baseCommit: location.baseCommit }
      } catch {
        return { projectPath, workspacePath: null, baseCommit: null }
      }
    },
    workEnvironment: async (workId) => {
      const view = (await application.inspect({ workId })).works[0]
      if (!view) throw new ApplicationFault('invalid_request', 'Unknown work')
      const policy = (projectSettings?.has(view.work.projectId) ? projectSettings.forContract(view.contract)
        : nativeProjects.find(project => project.id === view.work.projectId))?.environment?.policy
      const link = view.links.find(link => link.role === 'primary' && link.contract.revision === view.contract.revision)
      const binding = link && options.store.bindings.current(link.ticketId)
      const status = policy ? binding ? environments.status(binding) : { status: 'waiting' as const } : { status: 'not_configured' as const }
      const visible = status.status === 'preparing' && binding?.state !== 'active'
        ? { status: 'blocked' as const, code: 'preparation_interrupted' } : status
      return { protocol: 'work-environment/1' as const, workId, ...visible, ...(policy ? { policy } : {}) }
    },
    guide: async () => {
      const sourceGuide = new URL('../../../docs/ASSISTANT-GUIDE.zh-CN.md', import.meta.url)
      return readFileSync(existsSync(sourceGuide) ? sourceGuide : new URL('./assistant-guide.zh-CN.md', import.meta.url), 'utf8')
    },
    ...(options.assistantProvider
      ? {
          assistant: async () => options.assistantProvider!.status(),
          ...(typeof options.assistantProvider.configure === 'function' ? { configureAssistant: async (input: import('@personal-agent/contracts').AssistantConnectionInput) => {
            try { return options.assistantProvider!.configure(input) }
            catch (error) { throw new ApplicationFault('storage_unavailable', error instanceof ModelProviderError ? error.message : '模型配置未能保存，请刷新核对。', 'none') }
          } } : {}),
          assistantStream: (conversationId: string, signal: AbortSignal) =>
            assistantStreams.changes(conversationId, signal),
          selectModel: async (model: string) => {
            try {
              return options.assistantProvider!.selectModel(model)
            } catch (error) {
              if (error instanceof ModelProviderError)
                throw new ApplicationFault(
                  error.code === 'unsupported_model' ? 'unsupported_capability' : 'storage_unavailable',
                  error.message,
                )
              throw error
            }
          },
          ...(typeof options.assistantProvider.setSuggestionsEnabled === 'function' ? { setAssistantSuggestions: async (enabled: boolean) => {
            try { return options.assistantProvider!.setSuggestionsEnabled(enabled) }
            catch (error) { throw new ApplicationFault('storage_unavailable', error instanceof ModelProviderError ? error.message : '提案建议设置未能保存。') }
          } } : {}),
        }
      : {}),
    configuration: async () => {
      const currentExecutors = executors.filter(executorAdmissionCurrent)
      const currentUnavailable = unavailable ?? (hasNative && !currentExecutors.length ? 'not_admitted' : undefined)
      const currentNative = nativeProjects.map(project => projectSettings?.has(project.id) ? projectSettings.latest(project.id) : project)
      const configuration = applicationConfiguration({
        projects: options.projects.map((project) => ({
          ...project,
          ...(projectSettings?.has(project.id) ? { displayName: projectSettings.displayName(project.id) } : {}),
          settingsAvailable: projectSettings?.has(project.id) ?? false,
          ...(projectSettings?.has(project.id) && projectSettings.archived(project.id) ? { blockedReason: 'conflict' as const } : {}),
          profileIds: currentUnavailable || project.discussionOnly ? [] : projectProfiles.get(project.id) ?? fixtureProfiles,
          defaultCriteria: currentUnavailable || project.discussionOnly
            ? [{ id: 'review-output', kind: 'human' as const, required: true, description: '审阅讨论内容' }]
            : nativeProjects.some((native) => native.id === project.id)
            ? [
                {
                  id: 'project-tests',
                  kind: 'machine' as const,
                  required: true,
                  description: '项目注册的检查通过',
                  checkDefinitionRef: currentNative.find((native) => native.id === project.id)!.check.id,
                },
                { id: 'review-output', kind: 'human' as const, required: true, description: '审阅并接受当前变更' },
              ]
            : [
                {
                  id: 'fixed-output',
                  kind: 'machine',
                  required: true,
                  description: 'Output matches the registered check',
                  checkDefinitionRef: FIXTURE_CHECK,
                },
                { id: 'review-output', kind: 'human', required: true, description: 'Review the frozen output' },
              ],
        })),
        profiles: [
          ...(unavailable ? options.inspectedProfiles ?? [{ id: 'profile-codex-native', revision: 1, driverId: 'codex-native', kind: 'native' as const,
            displayName: `Codex · ${{ not_installed: '未安装', incompatible_version: '版本未准入', unsupported_platform: '平台未准入', probe_failed: '检测未完成', not_admitted: '尚未准入', needs_auth: '尚未登录', operator_disabled: '未启用', recovery_readonly: '恢复只读' }[unavailable]}`,
            readiness: currentUnavailable === 'not_installed' ? 'missing' as const : currentUnavailable === 'needs_auth' ? 'needs_auth' as const : currentUnavailable === 'incompatible_version' || currentUnavailable === 'unsupported_platform' ? 'incompatible' as const : 'needs_setup' as const }] : []),
          ...executors.map(entry => entry.profileView),
          ...(!unavailable ? (options.inspectedProfiles ?? []).filter(view => !executors.some(entry => entry.profile.id === view.id)) : []),
          ...fixtureProfiles.map((id) => ({
            id,
            revision: 1,
            displayName: `受控验证 · ${{ question: '权限提问', pass: '检查通过', fail: '检查失败', slow: '延时任务' }[id.slice('profile-fixture-'.length)] ?? id}`,
            driverId: 'controlled-product-fixture',
            kind: 'controlled_fixture' as const,
            readiness: 'fixture_ready' as const,
          })),
        ],
        checks: (currentUnavailable ? [] : [...new Set([...(fixtureProfiles.length ? [FIXTURE_CHECK] : []), ...currentNative.map(project => project.check.id)])])
          .map((id) => ({ id, revision: checks.require(id).revision, displayName: checks.require(id).title ?? id })),
        enabledProfileIds: options.startupMode === 'recovery_readonly' || currentUnavailable ? [] : [...currentExecutors.map(entry => entry.profile.id), ...fixtureProfiles],
        executionAvailability: options.startupMode === 'recovery_readonly' ? { state: 'unavailable', reason: 'recovery_readonly' }
          : currentUnavailable ? { state: 'unavailable', reason: currentUnavailable } : { state: 'available', kind: hasNative ? 'native' : 'controlled_fixture' },
        reviewActivityAvailable: options.startupMode !== 'recovery_readonly',
        decisionsAvailable: options.startupMode !== 'recovery_readonly',
        proposalsAvailable: options.startupMode !== 'recovery_readonly',
        contextPreviewAvailable: options.startupMode !== 'recovery_readonly',
        assistantContextAvailable: !!assistantContext && !!options.assistantProvider?.status().configured && options.startupMode !== 'recovery_readonly',
        contextHistoryAvailable: !!contextRecords?.historyAvailable,
        contextSourcesAvailable: !!contextRecords,
        replyCandidatesAvailable: !!completedReplies,
      })
      return configuration
    },
    deliveries: async (id) => application.questions.currentDeliveries(id),
    verification: async (id) => {
      for (const ticket of store.domain.tickets.list<Ticket>()) {
        const candidate = ticket.completion?.candidate ?? ticket.completion?.confirmed?.proposal
        const review = candidate && store.uow.atomic(() => completion.current(candidate))
        if (review?.verification.id === id) return review.verification
      }
      return undefined
    },
    artifact: async (id) => {
      // Only artifact IDs explicitly published by the trusted product review are downloadable.
      const visible = options.projects.some((project) =>
        store.product.works
          .listByProject(project.id, { limit: 200 })
          .some((work) => !!store.commands.get(key('product-artifact', id, work.id))),
      )
      if (!visible) return undefined
      const artifact = store.artifacts.read(id)
      if (!artifact) return undefined
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(artifact.data)
            controller.close()
          },
        }),
        contentType: 'text/plain; charset=utf-8',
      }
    },
  }
  const recipes = new ProductProjectRecipes({ configuration: () => read.configuration!(),
    rootFor: projectId => configuredProjects.some(project => project.id === projectId)
      ? options.projectRegistry?.list().find(project => project.id === projectId)?.path : undefined }, options.now)
  const contextPreview = new ProductContextPreview(store, application, options.principal,
    () => configuredProjects.map(project => ({ ...project,
      ...(projectSettings?.has(project.id) ? { displayName: projectSettings.displayName(project.id) } : {}) })),
    { verification: read.verification!, workEvidence: read.workEvidence! }, options.now)
  const contextBindings = options.assistantContextBindings ??
    (store.workflows.assistant as typeof store.workflows.assistant & { contextBindings?: AssistantContextBindings }).contextBindings
  if (contextBindings) contextRecords = new ProductContextRecords({
    store, bindings: contextBindings, principal: options.principal, projects: () => configuredProjects,
    secret: options.actionSecret, history: options.contextHistory ?? store.workflows.assistant.contextHistory,
    ...(options.now ? { now: options.now } : {}),
  })
  if (contextBindings) assistantContext = new ProductAssistantContext({
    store, application, principal: options.principal, preview: contextPreview, bindings: contextBindings,
    projects: () => configuredProjects, secret: options.actionSecret, ...(options.now ? { now: options.now } : {}),
    beforeNewSend: () => {
      if (!options.assistantProvider?.status().configured)
        throw new ApplicationFault('unsupported_capability', 'A configured discussion provider is required for a new context message', 'none')
    },
  })
  const selectedContext = () => {
    if (options.startupMode === 'recovery_readonly' || !assistantContext)
      throw new ApplicationFault('unsupported_capability', 'Selected-context discussion is not available in this instance', 'none')
    return assistantContext
  }
  return {
    application,
    execution,
    completion,
    workspaces,
    checks,
    read,
    projectSettings,
    operations: { retryVerification: application.retryVerification.bind(application), conversation: async (command: ConversationCommand, actor: TrustedActor) => conversations.dispatch(command, actor),
      recoveryPrepare: async (input: RecoveryPrepare, actor: TrustedActor) => recovery.prepare(input, actor),
      recoverySourcePrepare: async (input: RecoverySourcePrepare, actor: TrustedActor) => recoverySource.prepare(input, actor),
      recoverySourceConfirm: async (input: RecoverySourceConfirm, actor: TrustedActor) => recoverySource.confirm(input, actor),
      ...(executorTrials ? { executorTrialConfirm: (input: import('@personal-agent/contracts').ExecutorTrialCommand, actor: TrustedActor) => executorTrials.confirm(input, actor) } : {}),
      ...(recoveryTargets ? { recoveryTargetPrepare: (input: RecoveryTargetPrepareInput, actor: TrustedActor) => {
        if (options.startupMode !== 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Target preparation requires restored read-only startup', 'none')
        return recoveryTargets.prepare(input, actor)
      }, recoveryTargetAuthorize: (input: RecoveryTargetAuthorize, actor: TrustedActor) => {
        if (options.startupMode !== 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Target authorization requires restored read-only startup', 'none')
        return recoveryTargets.authorize(input, actor)
      } } : {}),
      prepareDecision: async (input: DecisionPrepare, actor: TrustedActor) => decisions.prepare(input, actor),
      prepareProposal: (input: ProposalPrepare, actor: TrustedActor) => proposals.prepare(input, actor),
      ...(completedReplies ? { prepareReplyCandidate: proposals.prepareReplyCandidate.bind(proposals) } : {}),
      proposal: (command: ProposalCommand, actor: TrustedActor) => proposals.dispatch(command, actor),
      contextPreview: (input: ContextPreviewInput, actor: TrustedActor) => {
        if (options.startupMode === 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Context preview requires a normal local instance', 'none')
        return contextPreview.prepare(input, actor)
      },
      assistantContextPrepare: (input: AssistantContextPrepare, actor: TrustedActor) => selectedContext().prepare(input, actor),
      assistantContextSend: (input: AssistantContextSend, actor: TrustedActor) => selectedContext().dispatch(input, actor),
      decision: async (command: DecisionCommand, actor: TrustedActor) => decisions.dispatch(command, actor),
      reviewActivity: async (activity: ReviewActivity, actor: TrustedActor) => reviewTiming.record(activity, actor),
      ...(projectSettings ? { projectSettings: (command: ProjectSettingsCommand, actor: TrustedActor) => projectSettings.dispatch(command, actor) } : {}) },
    start: () => {
      if (options.startupMode === 'recovery_readonly')
        throw new ApplicationFault('unsupported_capability', 'Recovery read-only cannot start business effects', 'none')
      execution!.start()
    },
    close: () => {
      assistantStreams.close()
      return execution!.close()
    },
  }
}
export const createControlledProduct = createProductRuntime
