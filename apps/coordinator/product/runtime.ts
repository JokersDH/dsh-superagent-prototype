import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { ApplicationConversations, ApplicationFault, createProductApplication } from '@personal-agent/application'
import type { ApplicationOptions } from '@personal-agent/application'
import type { ConversationCommand, NativeQuestionBinding, ProjectSettingsCommand, Scope, TrustedActor } from '@personal-agent/contracts'
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
import type { NativeProductConfiguration } from './native-config.ts'
import type { NativeProjectRegistry } from './project-registry.ts'
import { ProductEnvironments } from './environments.ts'
import { ProductProjectSettings } from './project-settings.ts'

export const FIXTURE_CHECK = 'check-fixture-output'
/** Operator-selected fixed executable/argv; contract or user text can only reference its registered ID. */
export function createProductRuntime(
  options: Omit<ApplicationOptions, 'completion' | 'nativeFence' | 'profileIds' | 'registeredChecks'> & {
    stateRoot: string
    scratchProject: string
    assistantProvider?: PrivateModelProvider
    native?: NativeProductConfiguration
    projectRegistry?: NativeProjectRegistry
    workspaceRoot?: string
  },
) {
  options = {
    ...options,
    principal: structuredClone(options.principal),
    projects: options.projects.map((project) => {
      if (options.native?.projects.some((native) => native.id === project.id)) return structuredClone(project)
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
  const nativeProjects = [...(options.native?.projects ?? [])]
  options = {
    ...options,
    projects: configuredProjects,
    ...(options.native ? { native: { ...options.native, projects: nativeProjects } } : {}),
  }
  const environments = new ProductEnvironments(options.store, options.stateRoot)
  const workspaces = new WorkspaceManager(options.workspaceRoot ?? join(options.stateRoot, 'workspaces'), { environment: environments })
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
  for (const project of options.native?.projects ?? []) if (!versionedProjectIds.has(project.id)) checks.register(project.check)
  const projectSettings = options.native && options.projectRegistry
    ? new ProductProjectSettings(options.store, options.projectRegistry, checks, options.principal, options.native.profile.id) : undefined
  if (projectSettings) for (const record of options.projectRegistry!.list())
    projectSettings.register(record, nativeProjects.find(project => project.id === record.id))
  const completion = new ProductCompletion(options.store, workspaces, checks, {
    environment: attemptId => {
      const binding = options.store.bindings.binding(attemptId)
      return binding ? environments.checkEnvironment(binding) : undefined
    },
  })
  let execution: ProductExecution | undefined
  const application = createProductApplication({
    ...options,
    profileIds: [...(options.native ? [options.native.profile.id] : []), ...FIXTURE_PROFILES],
    registeredChecks: checks.ids(),
    registeredCheck: id => !!checks.latest(id),
    projectGrant: input => projectSettings?.authorize(input.projectId, input.profileId, input.criteria, input.newWork),
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
  execution = new ProductExecution(
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
  )
  const { store } = options
  const conversations = new ApplicationConversations(store, options.principal, () => configuredProjects.map(project => project.id), options.actionSecret)
  const assistantStreams = new AssistantStreams()
  if (options.assistantProvider)
    handleAssistantReplies(execution.effects, store, options.assistantProvider, assistantStreams, {
      nativeExecution: !!options.native,
    })
  const read: NonNullable<LocalHttpOptions['read']> = {
    ...(projectSettings ? { projectSettings: async (projectId: string) => projectSettings.read(projectId) } : {}),
    conversations: async query => conversations.list(query),
    conversation: async id => conversations.get(id),
    workVerification: async (workId) => {
      const work = (await application.inspect({ workId })).works[0]
      if (!work) throw new ApplicationFault('invalid_request', 'Unknown work')
      return execution!.verificationStatus(work)
    },
    ...(options.native && options.projectRegistry
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
              if (!projectSettings) checks.register(check)
              application.registerProject(project, [check.id])
              configuredProjects.unshift(project)
              nativeProjects.unshift({ id: record.id, path: record.path, check,
                ...(record.environment ? { environment: options.projectRegistry!.environment(record)! } : {}) })
              projectSettings?.register(record, nativeProjects[0])
            }
            return await read.configuration!()
          },
        }
      : {}),
    workLocation: async (workId) => {
      const view = (await application.inspect({ workId })).works[0]
      if (!view) throw new ApplicationFault('invalid_request', 'Unknown work')
      const projectPath =
        options.native?.projects.find((project) => project.id === view.work.projectId)?.path ?? options.scratchProject
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
        : options.native?.projects.find(project => project.id === view.work.projectId))?.environment?.policy
      const link = view.links.find(link => link.role === 'primary' && link.contract.revision === view.contract.revision)
      const binding = link && options.store.bindings.current(link.ticketId)
      const status = policy ? binding ? environments.status(binding) : { status: 'waiting' as const } : { status: 'not_configured' as const }
      const visible = status.status === 'preparing' && binding?.state !== 'active'
        ? { status: 'blocked' as const, code: 'preparation_interrupted' } : status
      return { protocol: 'work-environment/1' as const, workId, ...visible, ...(policy ? { policy } : {}) }
    },
    guide: async () => readFileSync(new URL('../../../docs/ASSISTANT-GUIDE.zh-CN.md', import.meta.url), 'utf8'),
    ...(options.assistantProvider
      ? {
          assistant: async () => options.assistantProvider!.status(),
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
        }
      : {}),
    configuration: async () => {
      const currentNative = nativeProjects.map(project => projectSettings?.has(project.id) ? projectSettings.latest(project.id) : project)
      const configuration = applicationConfiguration({
        projects: options.projects.map((project) => ({
          ...project,
          ...(projectSettings?.has(project.id) ? { displayName: projectSettings.displayName(project.id) } : {}),
          settingsAvailable: projectSettings?.has(project.id) ?? false,
          ...(projectSettings?.has(project.id) && projectSettings.archived(project.id) ? { blockedReason: 'conflict' as const } : {}),
          profileIds: options.native?.projects.some((native) => native.id === project.id)
            ? [options.native.profile.id]
            : FIXTURE_PROFILES,
          defaultCriteria: options.native?.projects.some((native) => native.id === project.id)
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
          ...(options.native
            ? [
                {
                  id: options.native.profile.id,
                  revision: options.native.profile.revision,
                  displayName: 'Codex · 本机开发',
                  driverId: 'codex-native',
                  kind: 'native' as const,
                  readiness: 'native_test_passed' as const,
                },
              ]
            : []),
          ...FIXTURE_PROFILES.map((id) => ({
            id,
            revision: 1,
            displayName: `受控验证 · ${{ question: '权限提问', pass: '检查通过', fail: '检查失败', slow: '延时任务' }[id.slice('profile-fixture-'.length)] ?? id}`,
            driverId: 'controlled-product-fixture',
            kind: 'controlled_fixture' as const,
            readiness: 'fixture_ready' as const,
          })),
        ],
        checks: [...new Set([FIXTURE_CHECK, ...currentNative.map(project => project.check.id)])]
          .map((id) => ({ id, revision: checks.require(id).revision, displayName: checks.require(id).title ?? id })),
        enabledProfileIds: [...(options.native ? [options.native.profile.id] : []), ...FIXTURE_PROFILES],
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
  return {
    application,
    execution,
    completion,
    workspaces,
    checks,
    read,
    projectSettings,
    operations: { retryVerification: application.retryVerification.bind(application), conversation: async (command: ConversationCommand, actor: TrustedActor) => conversations.dispatch(command, actor),
      ...(projectSettings ? { projectSettings: (command: ProjectSettingsCommand, actor: TrustedActor) => projectSettings.dispatch(command, actor) } : {}) },
    start: () => execution!.start(),
    close: () => {
      assistantStreams.close()
      return execution!.close()
    },
  }
}
export const createControlledProduct = createProductRuntime
