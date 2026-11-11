/**
 * Workflow records (wave-03 A): durable conversation catalog/search/archive, versioned project
 * settings, explicit UserDecision versions, and a bounded read index over existing work/checks/
 * deliveries. Every write joins the shared UnitOfWork; this module never creates a second writer,
 * never changes the core execution lifecycle, and never infers a user decision.
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { ConversationMessageSchema, UserDecisionSchema } from '@personal-agent/contracts'
import type {
  ContractRef, ContractRevision, ConversationMessage, Json, Scope, TicketLink, UserDecision, WorkRecord,
} from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { ArtifactStore, type ArtifactRecord } from './artifacts.ts'
import { AssistantState } from './assistant-state.ts'
import { RoutingEvidence, type RoutingEvidenceSources } from './routing-evidence.ts'

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
    for (const ticketId of ticketIds) {
      const verifications = this.db.prepare(`SELECT id, artifact_digest, criteria_digest FROM completion_verifications
        WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 50`).all(ticketId) as Row[]
      const acceptances = this.db.prepare(`SELECT id, artifact_digest FROM completion_acceptances
        WHERE ticket_id = ? ORDER BY accepted_at DESC LIMIT 50`).all(ticketId) as Row[]
      verificationIds.push(...verifications.map(item => text(item.id)))
      acceptanceIds.push(...acceptances.map(item => text(item.id)))
      for (const verification of verifications) {
        deliverables.push({
          verificationId: text(verification.id),
          artifactDigest: text(verification.artifact_digest),
          criteriaDigest: text(verification.criteria_digest),
          accepted: acceptances.some(item => text(item.artifact_digest) === text(verification.artifact_digest)),
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
    const workId = id(input.workId, 'work id')
    const workRow = this.db.prepare('SELECT value FROM works WHERE id = ?').get(workId) as Row | undefined
    if (!workRow) return undefined
    const work = json<WorkRecord>(workRow.value)
    if (!input.projectIds.includes(work.projectId)) return undefined
    const limit = limitOf(input.limit, 200, 500)
    const entries: TimelineEntry[] = [{ at: work.createdAt, kind: 'work.created', sourceRef: work.id, detail: { title: work.title } }]
    const contracts = this.db.prepare('SELECT revision, digest, created_at FROM contract_revisions WHERE work_id = ?').all(workId) as Row[]
    for (const row of contracts) entries.push({ at: text(row.created_at), kind: 'contract.revision', sourceRef: `${workId}@${text(row.revision)}/${text(row.digest)}`, detail: { revision: Number(row.revision), digest: text(row.digest) } })
    const links = this.db.prepare('SELECT ticket_id, revision, digest, role FROM ticket_links WHERE work_id = ?').all(workId) as Row[]
    for (const row of links) entries.push({ at: work.createdAt, kind: 'ticket.link', sourceRef: text(row.ticket_id), detail: { revision: Number(row.revision), digest: text(row.digest), role: text(row.role) } })
    const questions = this.db.prepare('SELECT id, version, validity, opened_at FROM user_questions WHERE work_id = ?').all(workId) as Row[]
    for (const row of questions) entries.push({ at: text(row.opened_at), kind: 'question.opened', sourceRef: text(row.id), detail: { version: Number(row.version), validity: text(row.validity) } })
    const ticketIds = links.map(row => text(row.ticket_id))
    if (ticketIds.length) {
      const placeholders = ticketIds.map(() => '?').join(', ')
      const verifications = this.db.prepare(`SELECT id, artifact_digest, criteria_digest, created_at FROM completion_verifications WHERE ticket_id IN (${placeholders})`).all(...ticketIds) as Row[]
      for (const row of verifications) entries.push({ at: text(row.created_at), kind: 'verification.recorded', sourceRef: text(row.id), detail: { artifactDigest: text(row.artifact_digest), criteriaDigest: text(row.criteria_digest) } })
      const acceptances = this.db.prepare(`SELECT id, artifact_digest, accepted_at FROM completion_acceptances WHERE ticket_id IN (${placeholders})`).all(...ticketIds) as Row[]
      for (const row of acceptances) entries.push({ at: text(row.accepted_at), kind: 'acceptance.recorded', sourceRef: text(row.id), detail: { artifactDigest: text(row.artifact_digest) } })
      const observations = this.db.prepare(`SELECT fact_id, kind, disposition, observed_at FROM runtime_observations WHERE ticket_id IN (${placeholders})`).all(...ticketIds) as Row[]
      for (const row of observations) entries.push({ at: text(row.observed_at), kind: `runtime.${text(row.kind)}`, sourceRef: text(row.fact_id), detail: { disposition: text(row.disposition) } })
    }
    const reviews = this.db.prepare(`SELECT id, observed_at, disposition, layer FROM review_evidence
      WHERE project_id = ? AND json_extract(subject_value, '$.candidate.contract.workId') = ?`).all(work.projectId, workId) as Row[]
    for (const row of reviews) entries.push({ at: text(row.observed_at), kind: 'review.recorded', sourceRef: text(row.id), detail: { disposition: text(row.disposition), layer: text(row.layer) } })
    const outcomes = this.db.prepare(`SELECT id, observed_at, acceptance, layer, value FROM execution_outcome
      WHERE project_id = ? AND json_extract(value, '$.attempt.contract.workId') = ?`).all(work.projectId, workId) as Row[]
    for (const row of outcomes) {
      const outcome = json<{ reviewTiming?: unknown }>(row.value)
      entries.push({ at: text(row.observed_at), kind: 'execution.outcome', sourceRef: text(row.id),
        detail: { acceptance: text(row.acceptance), layer: text(row.layer), ...(outcome.reviewTiming ? { reviewTiming: outcome.reviewTiming } : {}) } })
    }
    entries.sort((a, b) => b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind) || a.sourceRef.localeCompare(b.sourceRef))
    return { entries: entries.slice(0, limit), truncated: entries.length > limit }
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
  readonly index: WorkflowIndex
  constructor(db: Database.Database, uow: UnitOfWork, artifacts: ArtifactStore) {
    this.conversations = new ProductConversations(db, uow)
    this.projects = new ProductProjects(db, uow)
    this.decisions = new ProductDecisions(db, uow)
    this.assistant = new AssistantState(db, uow, this.decisions)
    this.routingEvidence = new RoutingEvidence(db, uow)
    this.index = new WorkflowIndex(db, artifacts, this.projects)
  }
}
