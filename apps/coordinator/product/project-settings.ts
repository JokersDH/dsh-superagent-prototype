import { z } from 'zod'
import { CommandReceiptSchema, ContractRevisionSchema, JsonSchema, ProjectSettingsCommandSchema, ProjectSettingsPageSchema, TrustedActorSchema } from '@personal-agent/contracts'
import type { CommandReceipt, ContractRevision, ProjectSettingsCommand, ProjectSettingsPage, ProjectSettingsVersion, TrustedActor } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { canonicalDigest, WorkflowConflict } from '@personal-agent/storage'
import type { ProductStore, ProjectVersion } from '@personal-agent/storage'
import type { CheckDefinition, CheckRegistry } from '@personal-agent/verification'
import type { NativeProductConfiguration } from './native-config.ts'
import { NativeProjectRegistry } from './project-registry.ts'
import type { RegisteredProject } from './project-registry.ts'

type NativeProject = NativeProductConfiguration['projects'][number]
const SnapshotSchema = z.strictObject({
  protocol: z.literal('project-settings-snapshot/1'),
  project: z.strictObject({ id: z.string(), path: z.string(), displayName: z.string(), check: z.enum(['node_test', 'pnpm_test', 'npm_test']),
    environment: z.discriminatedUnion('policy', [z.strictObject({ policy: z.literal('existing_only') }), z.strictObject({ policy: z.literal('offline_install'), storeDir: z.string() })]).optional() }),
  check: z.strictObject({ id: z.string(), revision: z.number(), title: z.string().optional(), executable: z.string(), argv: z.array(z.string()),
    allowedEnvironment: z.array(z.string()).optional(), deadlineMs: z.number(), outputLimitBytes: z.number() }),
  environment: z.strictObject({ policy: z.enum(['existing_only', 'offline_install']), storeDir: z.string().optional(), managerCommand: z.string().optional() }).optional(),
})
type Snapshot = z.infer<typeof SnapshotSchema>
const checkOf = (snapshot: Snapshot): CheckDefinition => {
  const { title, allowedEnvironment, ...check } = snapshot.check
  return { ...check, ...(title !== undefined ? { title } : {}), ...(allowedEnvironment ? { allowedEnvironment } : {}) }
}
const nativeOf = (snapshot: Snapshot): NativeProject => ({ id: snapshot.project.id, path: snapshot.project.path, check: checkOf(snapshot),
  ...(snapshot.environment ? { environment: { policy: snapshot.environment.policy,
    ...(snapshot.environment.storeDir ? { storeDir: snapshot.environment.storeDir } : {}),
    ...(snapshot.environment.managerCommand ? { managerCommand: snapshot.environment.managerCommand } : {}) } } : {}) })
const digest = (value: unknown) => canonicalDigest(JsonSchema.parse(value))

/** Project versions own immutable check/environment snapshots; existing contracts keep their exact check reference. */
export class ProductProjectSettings {
  private readonly store: ProductStore
  private readonly registry: NativeProjectRegistry
  private readonly checks: CheckRegistry
  private readonly principal: { userId: string; authorityRef: string }
  private readonly profileId: string
  private readonly known = new Map<string, RegisteredProject>()
  constructor(store: ProductStore, registry: NativeProjectRegistry, checks: CheckRegistry,
    principal: { userId: string; authorityRef: string }, profileId: string) {
    this.store = store; this.registry = registry; this.checks = checks
    this.principal = structuredClone(principal); this.profileId = profileId
  }
  register(record: RegisteredProject, initial?: NativeProject): void {
    this.known.set(record.id, structuredClone(record))
    if (!this.store.workflows.projects.current(record.id)) {
      const snapshot = SnapshotSchema.parse({ protocol: 'project-settings-snapshot/1', project: record,
        check: initial?.check ?? this.registry.check(record),
        ...((initial?.environment ?? this.registry.environment(record)) ? { environment: initial?.environment ?? this.registry.environment(record) } : {}) })
      this.store.uow.atomic(() => this.append(snapshot, 0))
    }
    for (const version of this.store.workflows.projects.history(record.id, { limit: 100 })) this.checks.register(checkOf(this.snapshot(version)))
  }
  private require(id: string) {
    if (!this.known.has(id)) throw new ApplicationFault('forbidden', 'Project settings are not configured for this project', 'none')
    const current = this.store.workflows.projects.current(id)
    if (!current) throw new ApplicationFault('storage_unavailable', 'Project settings are missing', 'none')
    return current
  }
  private snapshot(version: ProjectVersion): Snapshot {
    const artifact = this.store.artifacts.read(version.settings.sourceRef)
    if (!artifact) throw new ApplicationFault('storage_unavailable', 'Project settings snapshot is unavailable', 'none')
    const snapshot = SnapshotSchema.parse(JSON.parse(Buffer.from(artifact.data).toString('utf8')))
    if (snapshot.project.id !== version.projectId || digest(snapshot.project.path) !== version.settings.pathDigest ||
      this.known.get(version.projectId)?.path !== snapshot.project.path || snapshot.project.check !== version.settings.check ||
      snapshot.project.displayName !== version.settings.displayName || digest(snapshot.project.environment ?? null) !== digest(version.settings.environment ?? null))
      throw new ApplicationFault('verification_failed', 'Project settings identity changed', 'none')
    return snapshot
  }
  private append(snapshot: Snapshot, expectedRevision: number) {
    const bytes = this.store.artifacts.write(Buffer.from(JSON.stringify(snapshot)))
    this.store.artifacts.insert(bytes)
    return this.store.workflows.projects.append({ projectId: snapshot.project.id, expectedRevision, settings: {
      displayName: snapshot.project.displayName, pathDigest: digest(snapshot.project.path), check: snapshot.project.check,
      sourceRef: bytes.id, ...(snapshot.project.environment ? { environment: snapshot.project.environment } : {}) } }).current
  }
  private view(version: ProjectVersion): ProjectSettingsVersion {
    const snapshot = this.snapshot(version)
    return { projectId: version.projectId, revision: version.revision, digest: version.digest, createdAt: version.createdAt,
      displayName: snapshot.project.displayName, check: snapshot.project.check,
      environment: snapshot.project.environment ?? { policy: 'existing_only' }, checkDefinitionRef: snapshot.check.id }
  }
  read(projectId: string): ProjectSettingsPage {
    return this.store.uow.atomic(() => {
      const current = this.require(projectId)
      return ProjectSettingsPageSchema.parse({ protocol: 'project-settings/1',
        current: { ...this.view(current), archived: !!current.archivedAt, archiveRevision: current.archiveRevision },
        history: this.store.workflows.projects.history(projectId, { limit: 100 }).map(version => this.view(version)) })
    })
  }
  latest(projectId: string): NativeProject {
    const snapshot = this.snapshot(this.require(projectId))
    return nativeOf(snapshot)
  }
  displayName(projectId: string): string { return this.snapshot(this.require(projectId)).project.displayName }
  has(projectId: string): boolean { return this.known.has(projectId) }
  archived(projectId: string): boolean { return !!this.require(projectId).archivedAt }
  forContract(input: ContractRevision): NativeProject | undefined {
    const contract = ContractRevisionSchema.parse(input)
    if (!this.has(contract.scope.projectId)) return undefined
    const refs = contract.criteria.filter(criterion => criterion.kind === 'machine' && criterion.required).map(criterion => criterion.checkDefinitionRef)
    const versions = this.store.workflows.projects.history(contract.scope.projectId, { limit: 100 })
    const matches = versions.map(version => this.snapshot(version)).filter(snapshot => refs.includes(snapshot.check.id))
    if (matches.length !== 1 || refs.length !== 1) throw new ApplicationFault('unsupported_capability', 'Contract must name one registered project settings check')
    const snapshot = matches[0]!
    return nativeOf(snapshot)
  }
  authorize(projectId: string, profileId: string, criteria: ContractRevision['criteria'], newWork: boolean): void {
    if (!this.has(projectId)) return
    const current = this.require(projectId)
    if (current.archivedAt) throw new ApplicationFault('conflict', 'Project is archived; restore it before authorizing new work')
    if (profileId !== this.profileId) throw new ApplicationFault('unsupported_capability', 'This project requires its registered native executor')
    const refs = criteria.filter(criterion => criterion.kind === 'machine' && criterion.required).map(criterion => criterion.checkDefinitionRef)
    const allowed = newWork ? [this.snapshot(current).check.id]
      : this.store.workflows.projects.history(projectId, { limit: 100 }).map(version => this.snapshot(version).check.id)
    if (refs.length !== 1 || !allowed.includes(refs[0]!)) throw new ApplicationFault('conflict', 'Project settings changed; reload the project defaults')
  }
  preflight(projectId: string): void {
    if (!this.has(projectId)) return
    const snapshot = this.snapshot(this.require(projectId))
    const { id: _, environment, ...input } = snapshot.project
    this.registry.prepare({ ...input, ...(environment ? { environment } : {}) }, { allowSettingsChange: true })
  }
  async dispatch(input: ProjectSettingsCommand, inputActor: TrustedActor): Promise<CommandReceipt> {
    const command = ProjectSettingsCommandSchema.parse(input), actor = TrustedActorSchema.parse(inputActor)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source === 'explicit_rule')
      throw new ApplicationFault('forbidden', 'Caller is not the configured local principal', 'none')
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Project settings own the outer command transaction')
    const payloadDigest = digest({ command, actor })
    const prior = this.store.commands.get(command.commandId)
    if (prior) {
      if (prior.payloadDigest !== payloadDigest) throw new ApplicationFault('conflict', 'Command ID already names another immutable request')
      return CommandReceiptSchema.parse({ ...(prior.result as object), commandId: command.commandId, seq: prior.seq })
    }
    let snapshot: Snapshot | undefined, preparationError: ApplicationFault | undefined
    try {
      const current = this.require(command.projectId)
      if (command.kind === 'update_project_settings') {
        if (current.revision !== command.expectedRevision || current.archivedAt) throw new ApplicationFault('conflict', 'Project settings changed or are archived')
        const original = this.known.get(command.projectId)!
        const record = this.registry.prepare({ path: original.path, displayName: command.displayName, check: command.check,
          environment: command.environment }, { allowSettingsChange: true })
        try {
          const check = { ...this.registry.check(record), id: `check-${record.id}.s${current.revision + 1}` }
          snapshot = SnapshotSchema.parse({ protocol: 'project-settings-snapshot/1', project: record, check, environment: this.registry.environment(record) })
        } catch {
          throw new ApplicationFault('unsupported_capability', '所选检查工具不可用，请核对本机 Node/npm/pnpm 环境。')
        }
      }
    } catch (error) {
      if (error instanceof ApplicationFault) preparationError = error
      else throw error
    }
    return this.store.uow.atomic(() => {
      let result: { status: 'recorded' } | { status: 'rejected'; error: ApplicationFault['error'] }
      try {
        result = this.store.uow.atomic(() => {
          if (preparationError) throw preparationError
          const current = this.require(command.projectId)
          if (command.kind === 'update_project_settings') {
            if (current.revision !== command.expectedRevision || current.archivedAt) throw new ApplicationFault('conflict', 'Project settings changed or are archived')
            this.append(snapshot!, current.revision)
            this.store.uow.afterCommit(() => this.checks.register(checkOf(snapshot!)))
          } else this.store.workflows.projects.setArchived(command.projectId, command.expectedArchiveRevision, command.archived)
          this.store.events.append({ topic: 'application.project.settings.changed', entityRef: command.projectId, payload: { projectId: command.projectId } })
          return { status: 'recorded' as const }
        })
      } catch (error) {
        if (error instanceof ApplicationFault) result = { status: 'rejected', error: error.error }
        else if (error instanceof WorkflowConflict) result = { status: 'rejected', error: { code: 'conflict', message: 'Project settings changed; reload and retry', retry: 'user_action' } }
        else throw error
      }
      const receipt = this.store.commands.record(command.commandId, payloadDigest, () => result, result.status)
      return CommandReceiptSchema.parse({ ...receipt.result, commandId: command.commandId, seq: receipt.seq })
    })
  }
}
