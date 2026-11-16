/**
 * Workflow records (wave-03 A): durable conversation catalog/search/archive, versioned project
 * settings, explicit UserDecision versions, and a bounded read index over existing work/checks/
 * deliveries. Every write joins the shared UnitOfWork; this module never creates a second writer,
 * never changes the core execution lifecycle, and never infers a user decision.
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { CompletionProposalSchema, ConversationMessageSchema, IdSchema, UserDecisionSchema, VerificationSchema } from '@personal-agent/contracts'
import type {
  ContractRef, ContractRevision, ConversationMessage, Json, Scope, TicketLink, UserDecision, WorkRecord,
} from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { ArtifactStore, type ArtifactRecord } from './artifacts.ts'
import { AssistantState } from './assistant-state.ts'
import { RoutingEvidence, type RoutingEvidenceSources } from './routing-evidence.ts'
import { AcceptanceOutcomeProjection } from './acceptance-outcome.ts'
import { RecoveryIntents } from './recovery-intents.ts'
import { RecoveryActivations } from './recovery-activations.ts'
import { RecoverySourceStore } from './recovery-source.ts'

import { WorkflowConflict } from './workflow-errors.ts'
export { WorkflowConflict } from './workflow-errors.ts'


type Row = Record<string, unknown>
const limitOf = (value: number | undefined, fallback: number, max: number): number =>
  Math.max(1, Math.min(max, Math.trunc(value ?? fallback)))
const text = (value: unknown): string => String(value ?? '')
const optionalText = (value: unknown): string | undefined => value === null || value === undefined ? undefined : String(value)
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)) as Json)
const id = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value))
    throw new WorkflowConflict(`${field} must be a stable identity (1-256 safe characters)`)
  return value
}
const nonEmpty = (value: unknown, field: string, max = 512): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new WorkflowConflict(`${field} must be 1-${max} characters`)
  return value.trim()
}
const cursorOf = (entry: { updatedAt?: string; createdAt?: string; id?: string }): string | undefined => {
  const at = entry.updatedAt ?? entry.createdAt
  return at && entry.id ? `${at}\u0000${entry.id}` : undefined
}
const parseCursor = (cursor: string | undefined): { at: string; id: string } | undefined => {
  if (!cursor) return undefined
  const [at, ...rest] = cursor.split('\u0000')
  if (!at || !rest.length) throw new WorkflowConflict('Invalid pagination cursor')
  return { at, id: rest.join('\u0000') }
}

export interface Conversation {
  id: string
  projectId?: string
  /** Full persisted membership; a conversation may be referenced by multiple projects. */
  projectIds: readonly string[]
  title: string
  titleRevision: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
  archiveRevision: number
  messageCount: number
  lastSequence: number
  workCount: number
  openQuestionCount: number
  attention: boolean
}

export interface ConversationPage {
  conversations: readonly Conversation[]
  nextCursor?: string
  hasMore: boolean
}

export interface ConversationSearchHit {
  conversation: Conversation
  /** Bounded excerpt from the matched title or message, not an execution fact. */
  excerpt: string
}

export interface ConversationSearchPage {
  hits: readonly ConversationSearchHit[]
  nextCursor?: string
  hasMore: boolean
}

const conversationSelect = `
  SELECT c.*,
    (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS message_count,
    (SELECT COALESCE(MAX(m.sequence), 0) FROM conversation_messages m WHERE m.conversation_id = c.id) AS last_sequence,
    (SELECT COUNT(*) FROM works w WHERE w.conversation_id = c.id) AS work_count,
    (SELECT COUNT(*) FROM works w JOIN user_questions q ON q.work_id = w.id
      WHERE w.conversation_id = c.id AND q.validity = 'open') AS open_question_count,
    (SELECT json_group_array(m.project_id) FROM conversation_members m
      WHERE m.conversation_id = c.id) AS project_ids
  FROM conversations c`

const conversationOf = (row: Row): Conversation => {
  const openQuestionCount = Number(row.open_question_count)
  let projectIds: string[] = []
  try { projectIds = json<string[]>(row.project_ids) } catch { projectIds = [] }
  return {
    id: text(row.id),
    ...(row.project_id === null ? {} : { projectId: text(row.project_id) }),
    projectIds,
    title: text(row.title),
    titleRevision: Number(row.title_revision),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    ...(row.archived_at === null ? {} : { archivedAt: text(row.archived_at) }),
    archiveRevision: Number(row.archive_revision),
    messageCount: Number(row.message_count),
    lastSequence: Number(row.last_sequence),
    workCount: Number(row.work_count),
    openQuestionCount,
    attention: openQuestionCount > 0,
  }
}

/**
 * Durable conversation directory and bounded search. A conversation identity is never derived from
 * UI state; messages keep their existing IDs/sequence. Archive changes only catalog visibility.
 */
export class ProductConversations {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  create(input: { id: string; projectId?: string; title: string; createdAt?: string }): { created: boolean; conversation: Conversation } {
    const conversationId = id(input.id, 'conversation id')
    const title = nonEmpty(input.title, 'conversation title')
    const projectId = input.projectId === undefined ? undefined : id(input.projectId, 'project id')
    const at = input.createdAt ?? new Date().toISOString()
    return this.uow.atomic(() => {
      const existing = this.db.prepare(`${conversationSelect} WHERE c.id = ?`).get(conversationId) as Row | undefined
      if (existing) {
        const current = conversationOf(existing)
        if (current.title !== title || current.projectId !== projectId)
          throw new WorkflowConflict(`Conversation ${conversationId} already exists with a different identity/title`)
        return { created: false, conversation: current }
      }
      this.db.prepare(`INSERT INTO conversations
        (id, project_id, title, title_revision, created_at, updated_at, archived_at, archive_revision)
        VALUES (?, ?, ?, 1, ?, ?, NULL, 0)`).run(conversationId, projectId ?? null, title, at, at)
      if (projectId) this.db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, project_id) VALUES (?, ?)')
        .run(conversationId, projectId)
      this.indexTitle(conversationId, title)
      return { created: true, conversation: this.get(conversationId)! }
    })
  }

  /** Creates a conversation for a message if needed and advances its update time. */
  ensureForMessage(input: { conversationId: string; projectId?: string; text: string; createdAt: string }): Conversation {
    return this.uow.atomic(() => {
      const existing = this.db.prepare('SELECT id, project_id, title, title_revision FROM conversations WHERE id = ?')
        .get(input.conversationId) as Row | undefined
      if (!existing) {
        const title = nonEmpty(input.text.slice(0, 120) || 'Conversation', 'conversation title')
        this.db.prepare(`INSERT INTO conversations
          (id, project_id, title, title_revision, created_at, updated_at, archived_at, archive_revision)
          VALUES (?, ?, ?, 1, ?, ?, NULL, 0)`).run(
          input.conversationId, input.projectId ?? null, title, input.createdAt, input.createdAt,
        )
        if (input.projectId) this.db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, project_id) VALUES (?, ?)')
          .run(input.conversationId, input.projectId)
        this.indexTitle(input.conversationId, title)
      } else {
        const projectId = existing.project_id === null ? input.projectId ?? null : String(existing.project_id)
        this.db.prepare('UPDATE conversations SET project_id = ?, updated_at = MAX(updated_at, ?) WHERE id = ?')
          .run(projectId, input.createdAt, input.conversationId)
        if (input.projectId) this.db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, project_id) VALUES (?, ?)')
          .run(input.conversationId, input.projectId)
        if (!this.db.prepare("SELECT 1 FROM conversation_search WHERE conversation_id = ? AND message_id = ''").get(input.conversationId))
          this.indexTitle(input.conversationId, String(existing.title))
      }
      return this.get(input.conversationId)!
    })
  }

  /** Indexes a newly inserted message; replay is handled by ProductMessages before this call. */
  indexMessage(message: ConversationMessage): void {
    const valid = ConversationMessageSchema.parse(message)
    this.db.prepare('INSERT INTO conversation_search (conversation_id, message_id, title, text) VALUES (?, ?, ?, ?)')
      .run(valid.conversationId, valid.id, '', valid.text)
  }

  get(conversationId: string): Conversation | undefined {
    const row = this.db.prepare(`${conversationSelect} WHERE c.id = ?`).get(id(conversationId, 'conversation id')) as Row | undefined
    return row ? conversationOf(row) : undefined
  }

  /** CAS title update; messages and archive state are untouched. */
  rename(conversationId: string, expectedTitleRevision: number, title: string): Conversation {
    const validTitle = nonEmpty(title, 'conversation title')
    return this.uow.atomic(() => {
      const result = this.db.prepare(`UPDATE conversations SET title = ?, title_revision = title_revision + 1,
        updated_at = ? WHERE id = ? AND title_revision = ?`).run(
        validTitle, new Date().toISOString(), id(conversationId, 'conversation id'), expectedTitleRevision,
      )
      if (Number(result.changes) !== 1) throw new WorkflowConflict(`Conversation ${conversationId} title revision is stale`)
      const current = this.get(conversationId)!
      this.indexTitle(conversationId, validTitle)
      return current
    })
  }

  /**
   * CAS archive visibility. Archived conversations stay fully readable; unresolved questions remain
   * visible through `attention` and are never hidden or stopped by this operation.
   */
  setArchived(conversationId: string, expectedArchiveRevision: number, archived: boolean): Conversation {
    return this.uow.atomic(() => {
      const row = this.db.prepare('SELECT archive_revision, archived_at FROM conversations WHERE id = ?')
        .get(id(conversationId, 'conversation id')) as Row | undefined
      if (!row) throw new WorkflowConflict(`Unknown conversation ${conversationId}`)
      if (Number(row.archive_revision) !== expectedArchiveRevision)
        throw new WorkflowConflict(`Conversation ${conversationId} archive revision is stale`)
      const already = row.archived_at !== null
      if (already === archived) return this.get(conversationId)!
      this.db.prepare('UPDATE conversations SET archived_at = ?, archive_revision = archive_revision + 1 WHERE id = ?')
        .run(archived ? new Date().toISOString() : null, conversationId)
      return this.get(conversationId)!
    })
  }

  /** Bounded catalog, newest update first. An empty project scope is explicitly empty. */
  list(input: { projectIds: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string }): ConversationPage {
    return this.page(true, input)
  }

  /** Explicit all-discovery used only by a trusted composition that still filters each row. */
  discoverPage(input: { includeArchived?: boolean; limit?: number; cursor?: string } = {}): ConversationPage {
    return this.page(false, input)
  }

  private page(scoped: boolean, input: { projectIds?: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string }): ConversationPage {
    const limit = limitOf(input.limit, 30, 100)
    const cursor = parseCursor(input.cursor)
    const projects = scoped ? (input.projectIds ?? []).map(project => id(project, 'project id')) : []
    if (scoped && !projects.length) return { conversations: [], hasMore: false }
    const clauses: string[] = []
    const args: unknown[] = []
    if (!input.includeArchived) clauses.push('c.archived_at IS NULL')
    if (projects.length) {
      clauses.push(`EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id
        AND m.project_id IN (${projects.map(() => '?').join(', ')}))`)
      args.push(...projects)
    }
    if (cursor) {
      clauses.push('(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))')
      args.push(cursor.at, cursor.at, cursor.id)
    }
    const rows = this.db.prepare(`${conversationSelect}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const visible = rows.slice(0, limit).map(conversationOf)
    const last = visible.at(-1)
    return {
      conversations: visible,
      ...(rows.length > limit && last ? { nextCursor: cursorOf(last)! } : {}),
      hasMore: rows.length > limit,
    }
  }

  /**
   * Bounded substring search over titles and message text. FTS5 trigram is used for queries of at
   * least three characters; shorter/unsupported queries fall back to parameterized LIKE. The public
   * scoped search accepts only an explicit non-empty project membership scope.
   */
  search(input: { query: string; projectIds: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string }): ConversationSearchPage {
    return this.searchPage(true, input)
  }

  /** Explicit all-discovery search; the caller remains responsible for per-row visibility. */
  discoverSearch(input: { query: string; includeArchived?: boolean; limit?: number; cursor?: string }): ConversationSearchPage {
    return this.searchPage(false, input)
  }

  private searchPage(scoped: boolean, input: { query: string; projectIds?: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string }): ConversationSearchPage {
    const query = nonEmpty(input.query, 'search query', 200)
    const limit = limitOf(input.limit, 20, 50)
    const cursor = parseCursor(input.cursor)
    const projects = scoped ? (input.projectIds ?? []).map(project => id(project, 'project id')) : []
    if (scoped && !projects.length) return { hits: [], hasMore: false }
    const where: string[] = []
    const args: unknown[] = []
    if (!input.includeArchived) where.push('c.archived_at IS NULL')
    if (projects.length) {
      where.push(`EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id
        AND m.project_id IN (${projects.map(() => '?').join(', ')}))`)
      args.push(...projects)
    }
    if (cursor) {
      where.push('(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))')
      args.push(cursor.at, cursor.at, cursor.id)
    }
    let ids: string[]
    if ([...query].length >= 3) {
      const match = `"${query.replaceAll('"', '""')}"`
      const rows = this.db.prepare(`SELECT c.id FROM conversation_search s JOIN conversations c ON c.id = s.conversation_id
        WHERE conversation_search MATCH ? ${where.length ? `AND ${where.join(' AND ')}` : ''}
        GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`).all(match, ...args, limit + 1) as Row[]
      ids = rows.map(row => text(row.id))
    } else {
      const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
      const pattern = `%${escaped}%`
      const rows = this.db.prepare(`SELECT c.id FROM conversations c
        WHERE (c.title LIKE ? ESCAPE '\\' OR EXISTS (
          SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id AND
          json_extract(m.value, '$.text') LIKE ? ESCAPE '\\'))
        ${where.length ? `AND ${where.join(' AND ')}` : ''}
        ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`).all(pattern, pattern, ...args, limit + 1) as Row[]
      ids = rows.map(row => text(row.id))
    }
    const hasMore = ids.length > limit
    const selected = ids.slice(0, limit)
    const hits = selected.map(conversationId => {
      const conversation = this.get(conversationId)!
      return { conversation, excerpt: this.excerpt(conversationId, query) }
    })
    const last = hits.at(-1)?.conversation
    return {
      hits,
      ...(hasMore && last ? { nextCursor: cursorOf(last)! } : {}),
      hasMore,
    }
  }

  private excerpt(conversationId: string, query: string): string {
    const row = this.db.prepare(`SELECT message_id, title, text FROM conversation_search
      WHERE conversation_id = ? AND (text LIKE ? OR title LIKE ?) ORDER BY rowid LIMIT 1`)
      .get(conversationId, `%${query}%`, `%${query}%`) as Row | undefined
    const source = row ? `${text(row.title)} ${text(row.text)}`.trim() : this.get(conversationId)?.title ?? ''
    const index = source.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    const start = Math.max(0, index - 40)
    return source.slice(start, start + 160)
  }

  private indexTitle(conversationId: string, title: string): void {
    this.db.prepare("DELETE FROM conversation_search WHERE conversation_id = ? AND message_id = ''").run(conversationId)
    this.db.prepare("INSERT INTO conversation_search (conversation_id, message_id, title, text) VALUES (?, '', ?, '')")
      .run(conversationId, title)
  }
}

export type ProjectCheck = 'node_test' | 'pnpm_test' | 'npm_test'
export type ProjectEnvironment =
  | { policy: 'existing_only' }
  | { policy: 'offline_install'; storeDir: string }

export interface ProjectSettings {
  pathDigest: string
  check: ProjectCheck
  sourceRef: string
  displayName?: string
  environment?: ProjectEnvironment
}

export interface ProjectVersion {
  projectId: string
  revision: number
  settings: ProjectSettings
  digest: string
  createdAt: string
}

export interface ProjectCurrent extends ProjectVersion {
  archivedAt?: string
  archiveRevision: number
}

const validateSettings = (value: ProjectSettings): ProjectSettings => {
  if (!value || typeof value !== 'object') throw new WorkflowConflict('Project settings must be an object')
  const pathDigest = nonEmpty(value.pathDigest, 'project pathDigest', 256)
  const sourceRef = nonEmpty(value.sourceRef, 'project sourceRef', 512)
  if (!['node_test', 'pnpm_test', 'npm_test'].includes(value.check)) throw new WorkflowConflict('Unknown project check')
  const displayName = value.displayName === undefined ? undefined : nonEmpty(value.displayName, 'project displayName', 160)
  let environment: ProjectEnvironment | undefined
  if (value.environment !== undefined) {
    if (value.environment.policy === 'existing_only') environment = { policy: 'existing_only' }
    else if (value.environment.policy === 'offline_install') {
      if (typeof value.environment.storeDir !== 'string' || !value.environment.storeDir.startsWith('/'))
        throw new WorkflowConflict('offline_install project settings require an absolute storeDir')
      environment = { policy: 'offline_install', storeDir: value.environment.storeDir }
    } else throw new WorkflowConflict('Unknown project environment policy')
  }
  return {
    pathDigest, check: value.check, sourceRef,
    ...(displayName ? { displayName } : {}),
    ...(environment ? { environment } : {}),
  }
}
const projectVersionOf = (row: Row): ProjectVersion => ({
  projectId: text(row.project_id),
  revision: Number(row.revision),
  settings: json<ProjectSettings>(row.value),
  digest: text(row.digest),
  createdAt: text(row.created_at),
})
const projectCurrentOf = (row: Row): ProjectCurrent => ({
  ...projectVersionOf(row),
  ...(row.archived_at === null ? {} : { archivedAt: text(row.archived_at) }),
  archiveRevision: Number(row.archive_revision),
})

/** Append-only project settings with a CAS current pointer and archive visibility. */
export class ProductProjects {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  append(input: { projectId: string; expectedRevision: number; settings: ProjectSettings; createdAt?: string }): { created: boolean; current: ProjectCurrent } {
    const projectId = id(input.projectId, 'project id')
    const settings = validateSettings(input.settings)
    const createdAt = input.createdAt ?? new Date().toISOString()
    const versionDigest = digest(settings)
    return this.uow.atomic(() => {
      const current = this.current(projectId)
      if (current?.archivedAt) throw new WorkflowConflict(`Project ${projectId} is archived; unarchive it before new settings`)
      const revision = current?.revision ?? 0
      if (revision !== input.expectedRevision) {
        // Exact replay after a successful append is stable, not a second version.
        const replay = this.db.prepare(`SELECT v.* FROM project_settings_versions v JOIN project_settings_current c
          ON c.project_id = v.project_id AND c.revision = v.revision
          WHERE v.project_id = ? AND v.revision = ?`).get(projectId, input.expectedRevision + 1) as Row | undefined
        if (replay && text(replay.digest) === versionDigest) return { created: false, current: projectCurrentOf({ ...replay, archive_revision: current?.archiveRevision ?? 0, archived_at: current?.archivedAt ?? null }) }
        throw new WorkflowConflict(`Project ${projectId} is at revision ${revision}, not ${input.expectedRevision}`)
      }
      const next = revision + 1
      this.db.prepare(`INSERT INTO project_settings_versions
        (project_id, revision, display_name, path_digest, check_kind, environment, source_ref, value, digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        projectId, next, settings.displayName ?? null, settings.pathDigest, settings.check,
        settings.environment ? JSON.stringify(settings.environment) : null, settings.sourceRef,
        JSON.stringify(settings), versionDigest, createdAt,
      )
      this.db.prepare(`INSERT INTO project_settings_current (project_id, revision, archived_at, archive_revision)
        VALUES (?, ?, NULL, 0) ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, archived_at = NULL`)
        .run(projectId, next)
      return { created: true, current: this.current(projectId)! }
    })
  }

  current(projectId: string): ProjectCurrent | undefined {
    const row = this.db.prepare(`SELECT v.*, c.archived_at, c.archive_revision FROM project_settings_current c
      JOIN project_settings_versions v ON v.project_id = c.project_id AND v.revision = c.revision
      WHERE c.project_id = ?`).get(id(projectId, 'project id')) as Row | undefined
    return row ? projectCurrentOf(row) : undefined
  }

  history(projectId: string, options: { limit?: number } = {}): ProjectVersion[] {
    const limit = limitOf(options.limit, 50, 100)
    const rows = this.db.prepare('SELECT * FROM project_settings_versions WHERE project_id = ? ORDER BY revision DESC LIMIT ?')
      .all(id(projectId, 'project id'), limit) as Row[]
    return rows.map(projectVersionOf)
  }

  /** CAS archive/unarchive; old settings and the project identity remain readable. */
  setArchived(projectId: string, expectedArchiveRevision: number, archived: boolean): ProjectCurrent {
    return this.uow.atomic(() => {
      const current = this.current(projectId)
      if (!current) throw new WorkflowConflict(`Unknown project ${projectId}`)
      if (current.archiveRevision !== expectedArchiveRevision)
        throw new WorkflowConflict(`Project ${projectId} archive revision is stale`)
      if ((current.archivedAt !== undefined) === archived) return current
      this.db.prepare('UPDATE project_settings_current SET archived_at = ?, archive_revision = archive_revision + 1 WHERE project_id = ?')
        .run(archived ? new Date().toISOString() : null, projectId)
      return this.current(projectId)!
    })
  }
}

export interface DecisionRecord {
  decision: UserDecision
  digest: string
  createdAt: string
}

const decisionOf = (row: Row): DecisionRecord => ({
  decision: json<UserDecision>(row.value),
  digest: text(row.digest),
  createdAt: text(row.created_at),
})

/** Append-only explicit decisions. No rule inference, no execution authority, no automatic learning. */
export class ProductDecisions {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  append(decision: UserDecision, options: { expectedVersion?: number; createdAt?: string } = {}): { created: boolean; record: DecisionRecord } {
    let valid: UserDecision
    try { valid = UserDecisionSchema.parse(decision) } catch (error) {
      throw new WorkflowConflict(`UserDecision failed contract validation: ${String(error)}`)
    }
    const valueDigest = digest(valid)
    const createdAt = options.createdAt ?? new Date().toISOString()
    return this.uow.atomic(() => {
      const existing = this.db.prepare('SELECT * FROM user_decision_versions WHERE id = ? AND version = ?')
        .get(valid.id, valid.version) as Row | undefined
      if (existing) {
        if (text(existing.digest) !== valueDigest) throw new WorkflowConflict(`Decision ${valid.id}@${valid.version} already exists with a different body`)
        return { created: false, record: decisionOf(existing) }
      }
      if (options.expectedVersion !== undefined && options.expectedVersion !== valid.version - 1)
        throw new WorkflowConflict(`Decision ${valid.id} version is not the expected successor`)
      if (valid.version > 1) {
        const previous = this.db.prepare('SELECT 1 FROM user_decision_versions WHERE id = ? AND version = ?').get(valid.id, valid.version - 1)
        if (!previous) throw new WorkflowConflict(`Decision ${valid.id}@${valid.version} requires its previous version`)
      } else if (this.db.prepare('SELECT 1 FROM user_decision_versions WHERE id = ? LIMIT 1').get(valid.id)) {
        throw new WorkflowConflict(`Decision ${valid.id} already exists; append a higher version`)
      }
      this.db.prepare(`INSERT INTO user_decision_versions
        (id, version, project_id, content, authority_ref, supersedes, revoked_at, value, digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        valid.id, valid.version, valid.scope.projectId, valid.content, valid.authorityRef,
        valid.supersedes ?? null, valid.revokedAt ?? null, JSON.stringify(valid), valueDigest, createdAt,
      )
      return { created: true, record: { decision: valid, digest: valueDigest, createdAt } }
    })
  }

  revoke(input: { id: string; expectedVersion: number; revokedAt?: string; createdAt?: string }): { created: boolean; record: DecisionRecord } {
    return this.uow.atomic(() => {
      const current = this.current(input.id)
      if (!current) throw new WorkflowConflict(`Unknown decision ${input.id}`)
      if (current.decision.version !== input.expectedVersion) throw new WorkflowConflict(`Decision ${input.id} is at version ${current.decision.version}, not ${input.expectedVersion}`)
      if (current.decision.revokedAt) return { created: false, record: current }
      return this.append({
        ...current.decision,
        version: current.decision.version + 1,
        revokedAt: input.revokedAt ?? new Date().toISOString(),
      }, { expectedVersion: current.decision.version, ...(input.createdAt ? { createdAt: input.createdAt } : {}) })
    })
  }

  current(decisionId: string): DecisionRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM user_decision_versions WHERE id = ?
      ORDER BY version DESC LIMIT 1`).get(id(decisionId, 'decision id')) as Row | undefined
    return row ? decisionOf(row) : undefined
  }

  history(decisionId: string, options: { limit?: number } = {}): DecisionRecord[] {
    const limit = limitOf(options.limit, 50, 200)
    const rows = this.db.prepare('SELECT * FROM user_decision_versions WHERE id = ? ORDER BY version DESC LIMIT ?')
      .all(id(decisionId, 'decision id'), limit) as Row[]
    return rows.map(decisionOf)
  }

  /** Current decision versions in an explicit project scope; revoked versions are opt-in. */
  list(input: { projectIds: readonly string[]; includeRevoked?: boolean; limit?: number; cursor?: string }): { records: readonly DecisionRecord[]; nextCursor?: string; hasMore: boolean } {
    const limit = limitOf(input.limit, 50, 200)
    const projects = input.projectIds.map(project => id(project, 'project id'))
    if (!projects.length) return { records: [], hasMore: false }
    const cursor = parseCursor(input.cursor)
    const args: unknown[] = [...projects]
    const where = [`d.project_id IN (${projects.map(() => '?').join(', ')})`,
      'd.version = (SELECT MAX(x.version) FROM user_decision_versions x WHERE x.id = d.id)']
    if (!input.includeRevoked) where.push('d.revoked_at IS NULL')
    if (cursor) {
      where.push('(d.created_at < ? OR (d.created_at = ? AND d.id < ?))')
      args.push(cursor.at, cursor.at, cursor.id)
    }
    const rows = this.db.prepare(`SELECT d.* FROM user_decision_versions d WHERE ${where.join(' AND ')}
      ORDER BY d.created_at DESC, d.id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const records = rows.slice(0, limit).map(decisionOf)
    const last = records.at(-1)
    return {
      records,
      ...(rows.length > limit && last ? { nextCursor: cursorOf({ createdAt: last.createdAt, id: last.decision.id })! } : {}),
      hasMore: rows.length > limit,
    }
  }
}

export interface SourceMessageMetadata {
  id: string
  conversationId: string
  projectId?: string
  sequence: number
  role: 'user' | 'assistant' | 'system'
  provenance: string
  textDigest: string
  textLength: number
  createdAt: string
}

export interface EvidencePage {
  entries: readonly TimelineEntry[]
  hasMore: boolean
  nextCursor?: string
  window: 'complete' | 'caller_limit' | 'storage_cap'
  /** Present when window=storage_cap: the per-source scan hit its bound. */
  sourcesCapped?: readonly string[]
}

export interface TimelineEntry {
  at: string
  kind: string
  sourceRef: string
  detail: unknown
}

export interface WorkflowStateFacts {
  protocol: 'workflow-state/1'
  productSchema: number | null
  writerClaim: { nonce: string; pid: number; startedAt: string } | null
  instanceCount: number
  queue: { waiting: number; parked: number }
  artifacts: number
  openQuestions: number
  pendingProposals: number
  observedAt: string
}

export interface CompletionReviewFact {
  commandId: string; payloadDigest: string; seq: number; recordedAt: string
  proposal: Record<string, unknown>; verification: Record<string, unknown>
  artifactIds: readonly string[]; attemptId: string
  /** The original attempt's historical binding state; historical validity is not current eligibility. */
  bindingState: string
  /** Whether the ticket's current pointer still names this review's attempt. Data link only. */
  currentLink: 'current_attempt' | 'historical_attempt'
}
export interface CompletionVerificationFact {
  id: string; ticketId: string; assignmentId: string; candidateGeneration: number
  artifactDigest: string; criteriaDigest: string; environmentRef: string; verifierIdentityRef: string
  results: unknown; createdAt: string
}
export interface CompletionAcceptanceFact {
  id: string; ticketId: string; assignmentId: string; candidateGeneration: number
  artifactDigest: string; criterionIds: readonly string[]; actorRef: string; acceptedAt: string
}
export interface UnclassifiedReviewFact { commandId: string; reason: string }
export interface CompletionFacts {
  /** Exact canonical ProductCompletion review receipts; never inferred from a loose ticket id alone. */
  reviews: readonly CompletionReviewFact[]
  /** Receipts that looked like reviews but failed strict canonical/Work/contract/binding validation. */
  unclassifiedReviews: readonly UnclassifiedReviewFact[]
  verifications: readonly CompletionVerificationFact[]
  acceptances: readonly CompletionAcceptanceFact[]
  /** Per-ticket read bound; `truncated` means more historical rows exist than returned. */
  coverage: { reviews: 'complete' | 'truncated'; verifications: 'complete' | 'truncated'; acceptances: 'complete' | 'truncated' }
  /** Source-side availability per ticket; returned arrays may be smaller when coverage is truncated. */
  available: { reviewCandidates: number; verifications: number; acceptances: number }
  limits: { perTicket: 50 }
}
/** Exact public orchestrator-core `key('product-review', canonicalDigest(candidate))` algorithm. */
export function productReviewCommandId(candidate: { ticketId: string; assignmentId: string; contract: { workId: string; revision: number; digest: string }; candidateGeneration: number }): string {
  const canonical = digest({ ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, contract: candidate.contract,
    candidateGeneration: candidate.candidateGeneration })
  return createHash('sha256').update(JSON.stringify(['product-review', canonical])).digest('hex').slice(0, 32)
}
export type CompletionHistoryKind = 'reviews' | 'verifications' | 'acceptances' | 'contracts' | 'attempts'
export interface CompletionHistoryQuery {
  workId: string; projectIds: readonly string[]; kind: CompletionHistoryKind; limit?: number; cursor?: string
}
export interface CompletionHistoryPage {
  protocol: 'completion-history/1'
  status: 'ok' | 'blocked'
  reason: 'entry_too_large' | 'page_budget' | null
  workId: string; projectId: string; kind: CompletionHistoryKind
  limit: number; returned: number; available: number; hasMore: boolean; nextCursor: string | null
  coverage: 'complete' | 'truncated'
  entries: readonly unknown[]
  unclassifiedReviews: readonly UnclassifiedReviewFact[]
  limits: { maxLimit: 200; maxBytes: number }
}

export interface WorkIndexEntry {
  work: WorkRecord
  authority: ContractRef | undefined
  authorityState: 'current' | 'missing'
  contract: ContractRevision | undefined
  contractState: 'current' | 'missing' | 'stale'
  contractHistory: readonly { revision: number; digest: string }[]
  links: readonly TicketLink[]
  openQuestionIds: readonly string[]
  verificationIds: readonly string[]
  acceptanceIds: readonly string[]
  deliverables: readonly { verificationId: string; artifactDigest: string; criteriaDigest: string; accepted: boolean }[]
  /** Existing ProductCompletion/verification/acceptance facts; data only, never current/accept authority. */
  completion: CompletionFacts
  project: { id: string; settings: ProjectCurrent | undefined; state: 'current' | 'missing' | 'archived' }
  provenance: readonly string[]
}

/** Bounded read-only index over existing storage facts; never invents a current setting or authority. */
export class WorkflowIndex {
  private readonly db: Database.Database
  private readonly artifacts: ArtifactStore
  private readonly projects: ProductProjects
  constructor(db: Database.Database, artifacts: ArtifactStore, projects: ProductProjects) {
    this.db = db
    this.artifacts = artifacts
    this.projects = projects
  }

  project(projectId: string): { current: ProjectCurrent | undefined; history: ProjectVersion[]; state: 'current' | 'missing' | 'archived' } {
    const idValue = id(projectId, 'project id')
    const current = this.projects.current(idValue)
    const history = this.projects.history(idValue)
    return {
      current,
      history,
      state: !current ? 'missing' : current.archivedAt ? 'archived' : 'current',
    }
  }

  listProjects(input: { projectIds?: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string } = {}): { projects: ProjectCurrent[]; nextCursor?: string; hasMore: boolean } {
    const limit = limitOf(input.limit, 30, 100)
    const cursor = parseCursor(input.cursor)
    const projects = input.projectIds?.map(project => id(project, 'project id')) ?? []
    const where: string[] = []
    const args: unknown[] = []
    if (!input.includeArchived) where.push('c.archived_at IS NULL')
    if (projects.length) {
      where.push(`c.project_id IN (${projects.map(() => '?').join(', ')})`)
      args.push(...projects)
    }
    if (cursor) {
      where.push('(v.created_at < ? OR (v.created_at = ? AND v.project_id < ?))')
      args.push(cursor.at, cursor.at, cursor.id)
    }
    const rows = this.db.prepare(`SELECT v.*, c.archived_at, c.archive_revision FROM project_settings_current c
      JOIN project_settings_versions v ON v.project_id = c.project_id AND v.revision = c.revision
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY v.created_at DESC, v.project_id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const visible = rows.slice(0, limit).map(projectCurrentOf)
    const last = visible.at(-1)
    return {
      projects: visible,
      ...(rows.length > limit && last ? { nextCursor: cursorOf({ createdAt: last.createdAt, id: last.projectId })! } : {}),
      hasMore: rows.length > limit,
    }
  }

  listWorks(input: { projectIds: readonly string[]; query?: string; limit?: number; cursor?: string }): { works: WorkRecord[]; nextCursor?: string; hasMore: boolean } {
    const limit = limitOf(input.limit, 30, 100)
    const projects = input.projectIds.map(project => id(project, 'project id'))
    if (!projects.length) return { works: [], hasMore: false }
    const cursor = parseCursor(input.cursor)
    const where = [`project_id IN (${projects.map(() => '?').join(', ')})`]
    const args: unknown[] = [...projects]
    if (input.query?.trim()) {
      const escaped = input.query.trim().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
      where.push("json_extract(value, '$.title') LIKE ? ESCAPE '\\'")
      args.push(`%${escaped}%`)
    }
    if (cursor) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))')
      args.push(cursor.at, cursor.at, cursor.id)
    }
    const rows = this.db.prepare(`SELECT value FROM works WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const works = rows.slice(0, limit).map(row => json<WorkRecord>(row.value))
    const last = works.at(-1)
    return {
      works,
      ...(rows.length > limit && last ? { nextCursor: cursorOf({ createdAt: last.createdAt, id: last.id })! } : {}),
      hasMore: rows.length > limit,
    }
  }

  private completionVerification(row: Row): CompletionVerificationFact {
    return { id: text(row.id), ticketId: text(row.ticket_id), assignmentId: text(row.assignment_id),
      candidateGeneration: Number(row.candidate_generation), artifactDigest: text(row.artifact_digest),
      criteriaDigest: text(row.criteria_digest), environmentRef: text(row.environment_ref),
      verifierIdentityRef: text(row.verifier_identity_ref), results: json<unknown>(row.results), createdAt: text(row.created_at) }
  }
  private completionAcceptance(row: Row): CompletionAcceptanceFact {
    return { id: text(row.id), ticketId: text(row.ticket_id), assignmentId: text(row.assignment_id),
      candidateGeneration: Number(row.candidate_generation), artifactDigest: text(row.artifact_digest),
      criterionIds: json<string[]>(row.criterion_ids), actorRef: text(row.actor_ref), acceptedAt: text(row.accepted_at) }
  }
  private completionReviewFor(workId: string, ticketId: string, currentAttemptId: string | null, verification: Row):
    { review?: CompletionReviewFact; unclassified?: UnclassifiedReviewFact } {
    let contract: { workId: string; revision: number; digest: string }
    try { contract = json(verification.contract) } catch { return { unclassified: { commandId: '', reason: 'verification_contract_invalid' } } }
    const candidate = { ticketId, assignmentId: text(verification.assignment_id), contract, candidateGeneration: Number(verification.candidate_generation) }
    const commandId = productReviewCommandId(candidate)
    const receipt = this.db.prepare(`SELECT command_id, payload_digest, seq, recorded_at, result FROM command_receipts WHERE command_id = ?`).get(commandId) as Row | undefined
    if (!receipt) return {}
    const unclassified = (reason: string) => ({ unclassified: { commandId, reason } })
    let parsed: Record<string, unknown>
    try { parsed = json<Record<string, unknown>>(receipt.result) } catch { return unclassified('result_not_json') }
    if (Object.keys(parsed).sort().join(',') !== 'artifactIds,attemptId,proposal,verification') return unclassified('review_shape')
    const proposal = CompletionProposalSchema.safeParse(parsed.proposal)
    const verified = VerificationSchema.safeParse(parsed.verification)
    if (!proposal.success) return unclassified('proposal_shape')
    if (!verified.success) return unclassified('verification_shape')
    const attemptId = IdSchema.safeParse(parsed.attemptId)
    const artifactIds = Array.isArray(parsed.artifactIds) ? parsed.artifactIds : null
    if (!attemptId.success || !artifactIds || artifactIds.length === 0 || artifactIds.length > 512 ||
      artifactIds.some(value => !IdSchema.safeParse(value).success) || new Set(artifactIds).size !== artifactIds.length)
      return unclassified('artifact_or_attempt_shape')
    const bindingRow = this.db.prepare('SELECT value FROM runtime_bindings WHERE attempt_id = ?').get(attemptId.data) as Row | undefined
    if (!bindingRow) return unclassified('historical_binding_missing')
    const binding = json<Record<string, unknown>>(bindingRow.value)
    if (proposal.data.ticketId !== ticketId || proposal.data.contract.workId !== workId ||
      proposal.data.ticketId !== text(binding.ticketId) || proposal.data.assignmentId !== text(binding.assignmentId) ||
      attemptId.data !== text(binding.attemptId) || digest(proposal.data.contract) !== digest(binding.contract))
      return unclassified('foreign_work_or_binding')
    if (proposal.data.verificationId !== verified.data.id || proposal.data.artifactDigest !== verified.data.artifactDigest ||
      proposal.data.ticketId !== verified.data.ticketId || proposal.data.assignmentId !== verified.data.assignmentId ||
      proposal.data.candidateGeneration !== verified.data.candidateGeneration ||
      digest(proposal.data.contract) !== digest(verified.data.contract)) return unclassified('proposal_verification_mismatch')
    if (commandId !== productReviewCommandId(proposal.data)) return unclassified('noncanonical_review_key')
    return { review: { commandId, payloadDigest: text(receipt.payload_digest), seq: Number(receipt.seq), recordedAt: text(receipt.recorded_at),
      proposal: proposal.data as unknown as Record<string, unknown>, verification: verified.data as unknown as Record<string, unknown>,
      artifactIds: [...artifactIds] as string[], attemptId: attemptId.data, bindingState: text(binding.state),
      currentLink: currentAttemptId === attemptId.data ? 'current_attempt' : 'historical_attempt' } }
  }
  private historyCursor(query: CompletionHistoryQuery, projectId: string, key: string): string {
    return Buffer.from(JSON.stringify({ v: 1, workId: query.workId, projectId, kind: query.kind, key }), 'utf8').toString('base64url')
  }
  private parseHistoryCursor(query: CompletionHistoryQuery, projectId: string, cursor: string | undefined): string | null {
    if (!cursor) return null
    let value: any
    try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) } catch { throw new WorkflowConflict('invalid completion history cursor') }
    if (value?.v !== 1 || value.workId !== query.workId || value.projectId !== projectId || value.kind !== query.kind ||
      typeof value.key !== 'string' || !value.key) throw new WorkflowConflict('completion history cursor does not belong to this subject')
    return value.key
  }

  /** Stable keyset continuation over existing facts; no history ledger or second candidate state. */
  completionHistory(query: CompletionHistoryQuery): CompletionHistoryPage {
    const workId = id(query.workId, 'work id')
    if (query.projectIds.length !== 1) throw new WorkflowConflict('completion history requires exactly one project')
    const projectId = id(query.projectIds[0], 'project id')
    const row = this.db.prepare('SELECT value FROM works WHERE id = ?').get(workId) as Row | undefined
    if (!row) throw new WorkflowConflict('unknown work')
    const work = json<WorkRecord>(row.value)
    if (work.projectId !== projectId) throw new WorkflowConflict('work does not belong to the requested project')
    if (!['reviews', 'verifications', 'acceptances', 'contracts', 'attempts'].includes(query.kind)) throw new WorkflowConflict('unknown completion history kind')
    const limit = query.limit === undefined ? 50 : Math.trunc(query.limit)
    if (!Number.isInteger(limit) || limit < 0 || limit > 200) throw new WorkflowConflict('completion history limit must be 0..200')
    const cursorKey = this.parseHistoryCursor(query, projectId, query.cursor)
    const linkRows = this.db.prepare('SELECT value FROM ticket_links WHERE work_id = ? ORDER BY revision DESC, ticket_id').all(workId) as Row[]
    const links = linkRows.map(item => json<TicketLink>(item.value))
    const ticketIds = links.map(link => link.ticketId)
    const ph = ticketIds.map(() => '?').join(', ')
    const maxBytes = 4 * 1024 * 1024
    let available = 0
    const entries: unknown[] = [], keys: string[] = [], unclassifiedReviews: UnclassifiedReviewFact[] = []
    let hasMore = false
    const count = (sql: string, args: unknown[]) => Number((this.db.prepare(sql).get(...args) as Row).count)
    if (limit === 0) {
      available = query.kind === 'contracts' ? count('SELECT COUNT(*) AS count FROM contract_revisions WHERE work_id = ?', [workId])
        : query.kind === 'attempts' ? count(`SELECT COUNT(*) AS count FROM runtime_bindings WHERE ticket_id IN (${ph || "''"})`, ticketIds)
          : query.kind === 'acceptances' ? count(`SELECT COUNT(*) AS count FROM completion_acceptances WHERE ticket_id IN (${ph || "''"})`, ticketIds)
            : count(`SELECT COUNT(*) AS count FROM completion_verifications WHERE ticket_id IN (${ph || "''"})`, ticketIds)
      return { protocol: 'completion-history/1', status: 'ok', reason: null, workId, projectId, kind: query.kind, limit,
        returned: 0, available, hasMore: available > 0, nextCursor: null, coverage: available > 0 ? 'truncated' : 'complete',
        entries, unclassifiedReviews, limits: { maxLimit: 200, maxBytes } }
    }
    if (query.kind === 'contracts') {
      const [rev, dig] = cursorKey ? cursorKey.split('\u0000') : []
      const rows = this.db.prepare(`SELECT revision, digest FROM contract_revisions WHERE work_id = ?
        ${cursorKey ? 'AND (revision < ? OR (revision = ? AND digest < ?))' : ''} ORDER BY revision DESC, digest DESC LIMIT ?`)
        .all(workId, ...(cursorKey ? [Number(rev), Number(rev), dig] : []), limit + 1) as Row[]
      available = count('SELECT COUNT(*) AS count FROM contract_revisions WHERE work_id = ?', [workId])
      for (const item of rows.slice(0, limit)) { entries.push({ revision: Number(item.revision), digest: text(item.digest) }); keys.push(`${text(item.revision)}\u0000${text(item.digest)}`) }
      hasMore = rows.length > limit
    } else if (query.kind === 'attempts') {
      available = ticketIds.length ? count(`SELECT COUNT(*) AS count FROM runtime_bindings WHERE ticket_id IN (${ph})`, ticketIds) : 0
      if (ticketIds.length) {
        const [epoch, attempt] = cursorKey ? cursorKey.split('\u0000') : []
        const rows = this.db.prepare(`SELECT value FROM runtime_bindings WHERE ticket_id IN (${ph})
          ${cursorKey ? "AND (json_extract(value, '$.fenceEpoch') < ? OR (json_extract(value, '$.fenceEpoch') = ? AND attempt_id < ?))" : ''}
          ORDER BY json_extract(value, '$.fenceEpoch') DESC, attempt_id DESC LIMIT ?`).all(...ticketIds, ...(cursorKey ? [Number(epoch), Number(epoch), attempt] : []), limit + 1) as Row[]
        for (const item of rows.slice(0, limit)) { const value = json<Record<string, unknown>>(item.value); entries.push({ attempt: value }); keys.push(`${text(value.fenceEpoch)}\u0000${text(value.attemptId)}`) }
        hasMore = rows.length > limit
      }
    } else if (query.kind === 'acceptances') {
      available = ticketIds.length ? count(`SELECT COUNT(*) AS count FROM completion_acceptances WHERE ticket_id IN (${ph})`, ticketIds) : 0
      if (ticketIds.length) {
        const [at, aid] = cursorKey ? cursorKey.split('\u0000') : []
        const rows = this.db.prepare(`SELECT id, ticket_id, assignment_id, candidate_generation, artifact_digest, criterion_ids, actor_ref, accepted_at
          FROM completion_acceptances WHERE ticket_id IN (${ph}) ${cursorKey ? 'AND (accepted_at < ? OR (accepted_at = ? AND id < ?))' : ''}
          ORDER BY accepted_at DESC, id DESC LIMIT ?`).all(...ticketIds, ...(cursorKey ? [at, at, aid] : []), limit + 1) as Row[]
        for (const item of rows.slice(0, limit)) { entries.push({ acceptance: this.completionAcceptance(item) }); keys.push(`${text(item.accepted_at)}\u0000${text(item.id)}`) }
        hasMore = rows.length > limit
      }
    } else {
      available = ticketIds.length ? count(`SELECT COUNT(*) AS count FROM completion_verifications WHERE ticket_id IN (${ph})`, ticketIds) : 0
      if (ticketIds.length) {
        const [created, vid] = cursorKey ? cursorKey.split('\u0000') : []
        const rows = this.db.prepare(`SELECT id, ticket_id, assignment_id, candidate_generation, artifact_digest, criteria_digest,
          environment_ref, verifier_identity_ref, results, contract, created_at FROM completion_verifications WHERE ticket_id IN (${ph})
          ${cursorKey ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
          .all(...ticketIds, ...(cursorKey ? [created, created, vid] : []), limit + 1) as Row[]
        const currentAttempts = new Map<string, string | null>()
        for (const ticketId of ticketIds) { const current = this.db.prepare('SELECT attempt_id FROM runtime_current WHERE ticket_id = ?').get(ticketId) as Row | undefined; currentAttempts.set(ticketId, current ? text(current.attempt_id) : null) }
        for (const item of rows.slice(0, limit)) {
          const fact = this.completionVerification(item)
          let entry: unknown = { verification: fact }
          if (query.kind === 'reviews') {
            const classified = this.completionReviewFor(workId, fact.ticketId, currentAttempts.get(fact.ticketId) ?? null, item)
            if (classified.review) entry = { verification: fact, review: classified.review }
            else if (classified.unclassified) { entry = { verification: fact, unclassified: classified.unclassified }; unclassifiedReviews.push(classified.unclassified) }
          }
          entries.push(entry); keys.push(`${text(item.created_at)}\u0000${text(item.id)}`)
        }
        hasMore = rows.length > limit
      }
    }

    // One byte budget covers the serialized envelope, every entry and top-level unclassified facts for all collections.
    const envelope = { protocol: 'completion-history/1' as const, workId, projectId, kind: query.kind, limit, available,
      limits: { maxLimit: 200, maxBytes } }
    let used = Buffer.byteLength(JSON.stringify({ ...envelope, entries: [], unclassifiedReviews: [] }))
    for (const item of unclassifiedReviews) used += Buffer.byteLength(JSON.stringify(item)) + 1
    let included = 0
    for (const entry of entries) {
      const size = Buffer.byteLength(JSON.stringify(entry)) + 1
      if (used + size > maxBytes) break
      used += size; included += 1
    }
    if (entries.length > 0 && included === 0) {
      return { protocol: 'completion-history/1', status: 'blocked', reason: 'entry_too_large', workId, projectId, kind: query.kind,
        limit, returned: 0, available, hasMore: true, nextCursor: null, coverage: 'truncated', entries: [], unclassifiedReviews,
        limits: { maxLimit: 200, maxBytes } }
    }
    const overBudget = included < entries.length
    const selected = entries.slice(0, included)
    hasMore = hasMore || overBudget
    const nextKey = selected.length ? keys[included - 1] : null
    return { protocol: 'completion-history/1', status: 'ok', reason: overBudget ? 'page_budget' : null, workId, projectId, kind: query.kind,
      limit, returned: selected.length, available, hasMore, nextCursor: hasMore && nextKey ? this.historyCursor(query, projectId, nextKey) : null,
      coverage: hasMore ? 'truncated' : 'complete', entries: selected, unclassifiedReviews, limits: { maxLimit: 200, maxBytes } }
  }

  work(workId: string, projectIds: readonly string[]): WorkIndexEntry | undefined {
    const value = id(workId, 'work id')
    const row = this.db.prepare('SELECT value FROM works WHERE id = ?').get(value) as Row | undefined
    if (!row) return undefined
    const work = json<WorkRecord>(row.value)
    if (!projectIds.includes(work.projectId)) return undefined
    const project = this.project(work.projectId)
    const authorityRow = this.db.prepare('SELECT work_id, revision, digest FROM runtime_authority WHERE work_id = ? AND enabled = 1').get(value) as Row | undefined
    const authority: ContractRef | undefined = authorityRow
      ? { workId: text(authorityRow.work_id), revision: Number(authorityRow.revision), digest: text(authorityRow.digest) } : undefined
    const contractRow = authority ? this.db.prepare('SELECT value FROM contract_revisions WHERE work_id = ? AND revision = ? AND digest = ?')
      .get(authority.workId, authority.revision, authority.digest) as Row | undefined : undefined
    const contract = contractRow ? json<ContractRevision>(contractRow.value) : undefined
    const contractHistory = (this.db.prepare('SELECT revision, digest FROM contract_revisions WHERE work_id = ? ORDER BY revision DESC')
      .all(value) as Row[]).map(item => ({ revision: Number(item.revision), digest: text(item.digest) }))
    const links = (this.db.prepare('SELECT value FROM ticket_links WHERE work_id = ? ORDER BY revision DESC, ticket_id').all(value) as Row[])
      .map(item => json<TicketLink>(item.value))
    const openQuestionIds = (this.db.prepare("SELECT id FROM user_questions WHERE work_id = ? AND validity = 'open' ORDER BY opened_at DESC LIMIT 200")
      .all(value) as Row[]).map(item => text(item.id))
    const ticketIds = links.map(link => link.ticketId)
    const verificationIds: string[] = []
    const acceptanceIds: string[] = []
    const deliverables: { verificationId: string; artifactDigest: string; criteriaDigest: string; accepted: boolean }[] = []
    const reviews: CompletionReviewFact[] = []
    const unclassifiedReviews: UnclassifiedReviewFact[] = []
    let verificationsTruncated = false, acceptancesTruncated = false
    let reviewCandidateCount = 0, verificationCount = 0, acceptanceCount = 0
    const completionVerifications: CompletionVerificationFact[] = []
    const completionAcceptances: CompletionAcceptanceFact[] = []
    for (const ticketId of ticketIds) {
      const verifications = this.db.prepare(`SELECT id, ticket_id, assignment_id, candidate_generation, artifact_digest,
        criteria_digest, environment_ref, verifier_identity_ref, results, contract, created_at FROM completion_verifications
        WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 51`).all(ticketId) as Row[]
      const acceptances = this.db.prepare(`SELECT id, ticket_id, assignment_id, candidate_generation, artifact_digest,
        criterion_ids, actor_ref, accepted_at FROM completion_acceptances
        WHERE ticket_id = ? ORDER BY accepted_at DESC LIMIT 51`).all(ticketId) as Row[]
      const verificationTotal = Number((this.db.prepare('SELECT COUNT(*) AS count FROM completion_verifications WHERE ticket_id = ?').get(ticketId) as Row).count)
      const acceptanceTotal = Number((this.db.prepare('SELECT COUNT(*) AS count FROM completion_acceptances WHERE ticket_id = ?').get(ticketId) as Row).count)
      reviewCandidateCount += verificationTotal; verificationCount += verificationTotal; acceptanceCount += acceptanceTotal
      if (verifications.length > 50) { verificationsTruncated = true; verifications.length = 50 }
      if (acceptances.length > 50) { acceptancesTruncated = true; acceptances.length = 50 }
      verificationIds.push(...verifications.map(item => text(item.id)))
      acceptanceIds.push(...acceptances.map(item => text(item.id)))
      for (const verification of verifications) {
        deliverables.push({
          verificationId: text(verification.id),
          artifactDigest: text(verification.artifact_digest),
          criteriaDigest: text(verification.criteria_digest),
          accepted: acceptances.some(item => text(item.artifact_digest) === text(verification.artifact_digest)),
        })
        completionVerifications.push({
          id: text(verification.id), ticketId: text(verification.ticket_id), assignmentId: text(verification.assignment_id),
          candidateGeneration: Number(verification.candidate_generation), artifactDigest: text(verification.artifact_digest),
          criteriaDigest: text(verification.criteria_digest), environmentRef: text(verification.environment_ref),
          verifierIdentityRef: text(verification.verifier_identity_ref), results: json<unknown>(verification.results), createdAt: text(verification.created_at),
        })
      }
      for (const acceptance of acceptances) completionAcceptances.push({
        id: text(acceptance.id), ticketId: text(acceptance.ticket_id), assignmentId: text(acceptance.assignment_id),
        candidateGeneration: Number(acceptance.candidate_generation), artifactDigest: text(acceptance.artifact_digest),
        criterionIds: json<string[]>(acceptance.criterion_ids), actorRef: text(acceptance.actor_ref), acceptedAt: text(acceptance.accepted_at),
      })
      const currentRow = this.db.prepare('SELECT attempt_id FROM runtime_current WHERE ticket_id = ?').get(ticketId) as Row | undefined
      const currentAttemptId = currentRow ? text(currentRow.attempt_id) : null
      for (const verification of verifications) {
        let contract: { workId: string; revision: number; digest: string }
        try { contract = json(verification.contract) } catch { unclassifiedReviews.push({ commandId: '', reason: 'verification_contract_invalid' }); continue }
        const candidate = { ticketId: text(verification.ticket_id), assignmentId: text(verification.assignment_id),
          contract, candidateGeneration: Number(verification.candidate_generation) }
        const commandId = productReviewCommandId(candidate)
        const receipt = this.db.prepare(`SELECT command_id, payload_digest, seq, recorded_at, result FROM command_receipts
          WHERE command_id = ?`).get(commandId) as Row | undefined
        if (!receipt) continue
        const unclassified = (reason: string): void => { unclassifiedReviews.push({ commandId, reason }) }
        let parsed: Record<string, unknown>
        try { parsed = json<Record<string, unknown>>(receipt.result) } catch { unclassified('result_not_json'); continue }
        const keys = Object.keys(parsed).sort().join(',')
        if (keys !== 'artifactIds,attemptId,proposal,verification') { unclassified('review_shape'); continue }
        const proposal = CompletionProposalSchema.safeParse(parsed.proposal)
        const verified = VerificationSchema.safeParse(parsed.verification)
        if (!proposal.success) { unclassified('proposal_shape'); continue }
        if (!verified.success) { unclassified('verification_shape'); continue }
        const attemptId = IdSchema.safeParse(parsed.attemptId)
        const artifactIds = Array.isArray(parsed.artifactIds) ? parsed.artifactIds : null
        if (!attemptId.success || !artifactIds || artifactIds.length === 0 || artifactIds.length > 512 ||
          artifactIds.some(value => !IdSchema.safeParse(value).success) || new Set(artifactIds).size !== artifactIds.length) {
          unclassified('artifact_or_attempt_shape'); continue
        }
        const bindingRow = this.db.prepare('SELECT value FROM runtime_bindings WHERE attempt_id = ?').get(attemptId.data) as Row | undefined
        const binding = bindingRow ? json<Record<string, unknown>>(bindingRow.value) : undefined
        if (!binding) { unclassified('historical_binding_missing'); continue }
        if (proposal.data.ticketId !== ticketId || proposal.data.contract.workId !== workId ||
          proposal.data.ticketId !== text(binding.ticketId) || proposal.data.assignmentId !== text(binding.assignmentId) ||
          attemptId.data !== text(binding.attemptId) || digest(proposal.data.contract) !== digest(binding.contract)) {
          unclassified('foreign_work_or_binding'); continue
        }
        if (proposal.data.verificationId !== verified.data.id || proposal.data.artifactDigest !== verified.data.artifactDigest ||
          proposal.data.ticketId !== verified.data.ticketId || proposal.data.assignmentId !== verified.data.assignmentId ||
          proposal.data.candidateGeneration !== verified.data.candidateGeneration ||
          digest(proposal.data.contract) !== digest(verified.data.contract)) {
          unclassified('proposal_verification_mismatch'); continue
        }
        if (commandId !== productReviewCommandId(proposal.data)) { unclassified('noncanonical_review_key'); continue }
        reviews.push({
          commandId, payloadDigest: text(receipt.payload_digest), seq: Number(receipt.seq),
          recordedAt: text(receipt.recorded_at), proposal: proposal.data as unknown as Record<string, unknown>,
          verification: verified.data as unknown as Record<string, unknown>, artifactIds: [...artifactIds] as string[], attemptId: attemptId.data,
          bindingState: text(binding.state), currentLink: currentAttemptId === attemptId.data ? 'current_attempt' : 'historical_attempt',
        })
      }
    }
    return {
      work,
      authority,
      authorityState: authority ? 'current' : 'missing',
      contract,
      contractState: !contract ? 'missing' : authority ? 'current' : 'stale',
      contractHistory,
      links,
      openQuestionIds,
      verificationIds,
      acceptanceIds,
      deliverables,
      completion: { reviews, unclassifiedReviews, verifications: completionVerifications, acceptances: completionAcceptances,
        coverage: { reviews: verificationsTruncated ? 'truncated' : 'complete', verifications: verificationsTruncated ? 'truncated' : 'complete',
          acceptances: acceptancesTruncated ? 'truncated' : 'complete' }, available: { reviewCandidates: reviewCandidateCount,
          verifications: verificationCount, acceptances: acceptanceCount }, limits: { perTicket: 50 } },
      project: { id: work.projectId, settings: project.current, state: project.state },
      provenance: [
        ...(project.current ? [project.current.settings.sourceRef] : []),
        ...(contract ? [contract.authorityRef] : []),
        ...links.map(link => link.authorityRef),
      ],
    }
  }

  /** Source-message metadata/digest for C/main revalidation; no raw history dump. */
  sourceMessage(messageId: string, projectIds: readonly string[]): SourceMessageMetadata | undefined {
    const value = id(messageId, 'message id')
    const projects = new Set(projectIds)
    if (!projects.size) return undefined
    const row = this.db.prepare('SELECT value FROM conversation_messages WHERE id = ?').get(value) as Row | undefined
    if (!row) return undefined
    const message = json<ConversationMessage>(row.value)
    if (message.projectId && !projects.has(message.projectId)) return undefined
    if (!message.projectId) {
      const members = this.db.prepare('SELECT project_id FROM conversation_members WHERE conversation_id = ?').all(message.conversationId) as Row[]
      if (!members.some(member => projects.has(text(member.project_id)))) return undefined
    }
    return {
      id: message.id, conversationId: message.conversationId,
      ...(message.projectId ? { projectId: message.projectId } : {}),
      sequence: message.sequence, role: message.role, provenance: message.provenance,
      textDigest: createHash('sha256').update(message.text).digest('hex'), textLength: message.text.length, createdAt: message.createdAt,
    }
  }

  /**
   * Read-only state/instance facts for D's preflight. A writer claim or PID is an observation, not a
   * trusted stop proof; only the existing barrier receipts may establish quiescence.
   */
  stateFacts(): WorkflowStateFacts {
    const meta = this.db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as Row | undefined
    const writer = this.db.prepare('SELECT nonce, pid, started_at FROM writer_claim WHERE id = 1').get() as Row | undefined
    const instances = this.db.prepare('SELECT COUNT(*) AS n FROM coordinator_instances').get() as Row
    const queue = this.db.prepare(`SELECT COUNT(*) FILTER (WHERE parked_at IS NULL) AS waiting,
      COUNT(*) FILTER (WHERE parked_at IS NOT NULL) AS parked FROM effect`).get() as Row
    const artifacts = this.db.prepare('SELECT COUNT(*) AS n FROM artifacts').get() as Row
    const questions = this.db.prepare("SELECT COUNT(*) AS n FROM user_questions WHERE validity = 'open'").get() as Row
    const proposals = this.db.prepare(`SELECT COUNT(*) AS n FROM assistant_proposal_versions p WHERE p.state = 'pending'
      AND p.version = (SELECT MAX(x.version) FROM assistant_proposal_versions x WHERE x.proposal_id = p.proposal_id)`).get() as Row
    return {
      protocol: 'workflow-state/1',
      productSchema: meta ? Number(JSON.parse(String(meta.value))) : null,
      writerClaim: writer ? { nonce: text(writer.nonce), pid: Number(writer.pid), startedAt: text(writer.started_at) } : null,
      instanceCount: Number(instances.n),
      queue: { waiting: Number(queue.waiting), parked: Number(queue.parked) },
      artifacts: Number(artifacts.n), openQuestions: Number(questions.n), pendingProposals: Number(proposals.n),
      observedAt: new Date().toISOString(),
    }
  }

  /**
   * Bounded single-work evidence timeline. It links existing facts by time and identity; it never
   * asserts causality, review correctness or a current profile from a historical row.
   */
  timeline(input: { workId: string; projectIds: readonly string[]; limit?: number }): { entries: readonly TimelineEntry[]; truncated: boolean } | undefined {
    const built = this.buildTimeline(input.workId, input.projectIds)
    if (!built) return undefined
    const limit = limitOf(input.limit, 200, 500)
    return { entries: built.entries.slice(0, limit), truncated: built.capped || built.entries.length > limit }
  }

  /**
   * Paged historical evidence for one work. `window` separates a caller-page boundary from an
   * internal scan bound: `caller_limit` means continue with the cursor, `storage_cap` means the
   * bounded per-source scan was exhausted and later facts may exist, `complete` means the observable
   * facts were fully enumerated for this work.
   */
  evidencePage(input: { workId: string; projectIds: readonly string[]; limit?: number; cursor?: string }): EvidencePage | undefined {
    const built = this.buildTimeline(input.workId, input.projectIds)
    if (!built) return undefined
    const limit = limitOf(input.limit, 100, 200)
    let after = 0
    if (input.cursor) {
      const [at, kind, ...refParts] = input.cursor.split('\u0000')
      const ref = refParts.join('\u0000')
      if (!at || !kind || !ref) throw new WorkflowConflict('Invalid evidence cursor')
      after = built.entries.findIndex(entry => entry.at === at && entry.kind === kind && entry.sourceRef === ref) + 1
      if (after === 0) throw new WorkflowConflict('Evidence cursor is no longer in the observable window')
    }
    const page = built.entries.slice(after, after + limit)
    const hasMore = after + limit < built.entries.length
    const last = page.at(-1)
    return {
      entries: page,
      hasMore,
      ...(hasMore && last ? { nextCursor: `${last.at}\u0000${last.kind}\u0000${last.sourceRef}` } : {}),
      window: hasMore ? 'caller_limit' : built.capped ? 'storage_cap' : 'complete',
      ...(built.capped ? { sourcesCapped: built.cappedSources } : {}),
    }
  }

  private buildTimeline(workId: string, projectIds: readonly string[]): { entries: TimelineEntry[]; capped: boolean; cappedSources: string[] } | undefined {
    const idValue = id(workId, 'work id')
    const workRow = this.db.prepare('SELECT value FROM works WHERE id = ?').get(idValue) as Row | undefined
    if (!workRow) return undefined
    const work = json<WorkRecord>(workRow.value)
    if (!projectIds.includes(work.projectId)) return undefined
    const entries: TimelineEntry[] = [{ at: work.createdAt, kind: 'work.created', sourceRef: work.id, detail: { title: work.title } }]
    const cappedSources: string[] = []
    const capped = (source: string, rows: Row[], bound: number): Row[] => {
      if (rows.length > bound) { cappedSources.push(source); return rows.slice(0, bound) }
      return rows
    }
    const contracts = capped('contracts', this.db.prepare('SELECT revision, digest, created_at FROM contract_revisions WHERE work_id = ? ORDER BY revision DESC LIMIT 501').all(idValue) as Row[], 500)
    for (const row of contracts) entries.push({ at: text(row.created_at), kind: 'contract.revision', sourceRef: `${idValue}@${text(row.revision)}/${text(row.digest)}`, detail: { revision: Number(row.revision), digest: text(row.digest) } })
    const links = capped('links', this.db.prepare('SELECT ticket_id, revision, digest, role FROM ticket_links WHERE work_id = ? ORDER BY ticket_id LIMIT 501').all(idValue) as Row[], 500)
    for (const row of links) entries.push({ at: work.createdAt, kind: 'ticket.link', sourceRef: text(row.ticket_id), detail: { revision: Number(row.revision), digest: text(row.digest), role: text(row.role) } })
    const questions = capped('questions', this.db.prepare('SELECT id, version, validity, opened_at FROM user_questions WHERE work_id = ? ORDER BY opened_at DESC, id LIMIT 501').all(idValue) as Row[], 500)
    for (const row of questions) entries.push({ at: text(row.opened_at), kind: 'question.opened', sourceRef: text(row.id), detail: { version: Number(row.version), validity: text(row.validity) } })
    const ticketIds = links.map(row => text(row.ticket_id))
    if (ticketIds.length) {
      const placeholders = ticketIds.map(() => '?').join(', ')
      const verifications = capped('verifications', this.db.prepare(`SELECT id, artifact_digest, criteria_digest, created_at FROM completion_verifications WHERE ticket_id IN (${placeholders}) ORDER BY created_at DESC, id LIMIT 201`).all(...ticketIds) as Row[], 200)
      for (const row of verifications) entries.push({ at: text(row.created_at), kind: 'verification.recorded', sourceRef: text(row.id), detail: { artifactDigest: text(row.artifact_digest), criteriaDigest: text(row.criteria_digest) } })
      const acceptances = capped('acceptances', this.db.prepare(`SELECT id, artifact_digest, accepted_at FROM completion_acceptances WHERE ticket_id IN (${placeholders}) ORDER BY accepted_at DESC, id LIMIT 201`).all(...ticketIds) as Row[], 200)
      for (const row of acceptances) entries.push({ at: text(row.accepted_at), kind: 'acceptance.recorded', sourceRef: text(row.id), detail: { artifactDigest: text(row.artifact_digest) } })
      const observations = capped('runtime_observations', this.db.prepare(`SELECT fact_id, kind, disposition, observed_at FROM runtime_observations WHERE ticket_id IN (${placeholders}) ORDER BY observed_at DESC, fact_id LIMIT 201`).all(...ticketIds) as Row[], 200)
      for (const row of observations) entries.push({ at: text(row.observed_at), kind: `runtime.${text(row.kind)}`, sourceRef: text(row.fact_id), detail: { disposition: text(row.disposition) } })
    }
    const reviews = capped('reviews', this.db.prepare(`SELECT id, observed_at, disposition, layer FROM review_evidence
      WHERE project_id = ? AND json_extract(subject_value, '$.candidate.contract.workId') = ?
      ORDER BY observed_at DESC, id LIMIT 201`).all(work.projectId, idValue) as Row[], 200)
    for (const row of reviews) entries.push({ at: text(row.observed_at), kind: 'review.recorded', sourceRef: text(row.id), detail: { disposition: text(row.disposition), layer: text(row.layer) } })
    const outcomes = capped('outcomes', this.db.prepare(`SELECT id, observed_at, acceptance, layer, value FROM execution_outcome
      WHERE project_id = ? AND json_extract(value, '$.attempt.contract.workId') = ?
      ORDER BY observed_at DESC, id LIMIT 201`).all(work.projectId, idValue) as Row[], 200)
    for (const row of outcomes) {
      const outcome = json<{ reviewTiming?: unknown }>(row.value)
      entries.push({ at: text(row.observed_at), kind: 'execution.outcome', sourceRef: text(row.id),
        detail: { acceptance: text(row.acceptance), layer: text(row.layer), ...(outcome.reviewTiming ? { reviewTiming: outcome.reviewTiming } : {}) } })
    }
    entries.sort((a, b) => b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind) || a.sourceRef.localeCompare(b.sourceRef))
    return { entries, capped: cappedSources.length > 0, cappedSources }
  }

  listArtifacts(input: { limit?: number; before?: string } = {}): { artifacts: ArtifactRecord[]; nextCursor?: string; hasMore: boolean } {
    return this.artifacts.list(input)
  }
}

/** The workflow-record collection exposed as `store.workflows`. */
export class WorkflowRecords {
  readonly conversations: ProductConversations
  readonly projects: ProductProjects
  readonly decisions: ProductDecisions
  readonly assistant: AssistantState
  readonly routingEvidence: RoutingEvidence
  readonly acceptance: AcceptanceOutcomeProjection
  readonly recoveryIntents: RecoveryIntents
  readonly recoveryActivations: RecoveryActivations
  /** Wave-11 bounded logical source snapshot; never a writer or startup grant. */
  readonly recoverySource: RecoverySourceStore
  readonly index: WorkflowIndex
  constructor(db: Database.Database, uow: UnitOfWork, artifacts: ArtifactStore) {
    this.conversations = new ProductConversations(db, uow)
    this.projects = new ProductProjects(db, uow)
    this.decisions = new ProductDecisions(db, uow)
    this.assistant = new AssistantState(db, uow, this.decisions)
    this.routingEvidence = new RoutingEvidence(db, uow)
    this.acceptance = new AcceptanceOutcomeProjection(db, uow, this.routingEvidence)
    this.recoveryIntents = new RecoveryIntents(db, uow)
    this.recoveryActivations = new RecoveryActivations(db, uow)
    this.recoverySource = new RecoverySourceStore(db)
    this.index = new WorkflowIndex(db, artifacts, this.projects)
  }
}
