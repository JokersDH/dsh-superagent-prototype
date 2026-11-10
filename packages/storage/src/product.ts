/**
 * Product records (wave-02, WP-02 increment): the frozen application/Broker records beside the core
 * domain rows — Work identity, contract revisions, contract↔Ticket links, conversation messages and
 * pages, user questions, and the manual dispatch switch.
 *
 * Boundaries honoured here:
 * - Every write joins the shared UnitOfWork, so a command can commit/roll back core rows, receipts,
 *   events, effects and product records as one unit. Storage methods never start a second
 *   transaction manager and never allocate business identity from a UI.
 * - Records are frozen and validated with the shared runtime schemas on intake; a same-ID replay
 *   with the same canonical body is idempotent, any body change is a conflict.
 * - No execution phase is stored: Work is identity/index only, and `dispatchControls` is a paused
 *   switch with CAS, not a second Work lifecycle.
 */
import type Database from 'better-sqlite3'
import {
  ContractRevisionSchema, ConversationMessageSchema, TicketLinkSchema, UserQuestionSchema, WorkRecordSchema,
} from '@personal-agent/contracts'
import type {
  ContractRef, ContractRevision, ConversationMessage, ConversationPage, Json, TicketLink, UserQuestion, WorkRecord,
} from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { ProductConversations } from './workflows.ts'

/** A frozen/unique record already exists with a different body, or a CAS expectation is stale. */
export class ProductConflict extends Error {}
/** A dispatch-control CAS was attempted from a stale revision. */
export class DispatchConflict extends Error {}

type Row = Record<string, unknown>
export type NewConversationMessage = Omit<ConversationMessage, 'sequence'>
export interface DispatchControl { paused: boolean; revision: number }

const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)) as Json)
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const limitOf = (value: number | undefined, fallback: number, max: number): number =>
  Math.max(1, Math.min(max, Math.trunc(value ?? fallback)))

export class ProductWorks {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  /** Frozen Work identity: stable id, project/conversation indexes, no execution phase. */
  insert(work: WorkRecord): { created: boolean } {
    const valid = WorkRecordSchema.parse(work)
    return this.uow.atomic(() => {
      const existing = this.db.prepare('SELECT value FROM works WHERE id = ?').get(valid.id) as Row | undefined
      if (existing) {
        if (digest(json(existing.value)) !== digest(valid)) throw new ProductConflict(`Work ${valid.id} already exists with a different body`)
        return { created: false }
      }
      this.db.prepare('INSERT INTO works (id, project_id, conversation_id, value, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(valid.id, valid.projectId, valid.conversationId, JSON.stringify(valid), valid.createdAt)
      return { created: true }
    })
  }

  get(id: string): WorkRecord | undefined {
    const row = this.db.prepare('SELECT value FROM works WHERE id = ?').get(id) as Row | undefined
    return row ? json<WorkRecord>(row.value) : undefined
  }

  /** Newest first, bounded; `before` is the exclusive createdAt/id cursor. */
  listByProject(projectId: string, options: { limit?: number; before?: string } = {}): WorkRecord[] {
    const limit = limitOf(options.limit, 50, 200)
    const rows = options.before
      ? this.db.prepare('SELECT value FROM works WHERE project_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ?').all(projectId, options.before, limit)
      : this.db.prepare('SELECT value FROM works WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(projectId, limit)
    return (rows as Row[]).map(row => json<WorkRecord>(row.value))
  }
}

export class ProductContracts {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  /** Frozen contract revision; appending never changes the enabled authority. */
  append(revision: ContractRevision): { created: boolean } {
    const valid = ContractRevisionSchema.parse(revision)
    return this.uow.atomic(() => {
      const existing = this.db.prepare('SELECT value FROM contract_revisions WHERE work_id = ? AND revision = ? AND digest = ?')
        .get(valid.workId, valid.revision, valid.digest) as Row | undefined
      if (existing) {
        if (digest(json(existing.value)) !== digest(valid)) throw new ProductConflict(`Contract ${valid.workId}@${valid.revision}/${valid.digest} already exists with a different body`)
        return { created: false }
      }
      this.db.prepare('INSERT INTO contract_revisions (work_id, revision, digest, authority_ref, value, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(valid.workId, valid.revision, valid.digest, valid.authorityRef, JSON.stringify(valid), valid.createdAt)
      return { created: true }
    })
  }

  getByRef(ref: ContractRef): ContractRevision | undefined {
    const row = this.db.prepare('SELECT value FROM contract_revisions WHERE work_id = ? AND revision = ? AND digest = ?')
      .get(ref.workId, ref.revision, ref.digest) as Row | undefined
    return row ? json<ContractRevision>(row.value) : undefined
  }

  /** All frozen revisions of a Work, newest revision first. */
  history(workId: string, options: { limit?: number } = {}): ContractRevision[] {
    const limit = limitOf(options.limit, 100, 500)
    const rows = this.db.prepare('SELECT value FROM contract_revisions WHERE work_id = ? ORDER BY revision DESC, digest ASC LIMIT ?')
      .all(workId, limit) as Row[]
    return rows.map(row => json<ContractRevision>(row.value))
  }
}

export class ProductLinks {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  /** Attaches a contract revision to an existing Ticket. One primary link per contract revision. */
  attach(link: TicketLink): { created: boolean } {
    const valid = TicketLinkSchema.parse(link)
    return this.uow.atomic(() => {
      const key = [valid.contract.workId, valid.contract.revision, valid.contract.digest, valid.ticketId]
      const existing = this.db.prepare('SELECT value FROM ticket_links WHERE work_id = ? AND revision = ? AND digest = ? AND ticket_id = ?')
        .get(...key) as Row | undefined
      if (existing) {
        if (digest(json(existing.value)) !== digest(valid)) throw new ProductConflict(`Ticket link ${valid.contract.digest}/${valid.ticketId} already exists with a different body`)
        return { created: false }
      }
      try {
        this.db.prepare('INSERT INTO ticket_links (work_id, revision, digest, ticket_id, role, authority_ref, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(...key, valid.role, valid.authorityRef, JSON.stringify(valid), new Date().toISOString())
      } catch (error) {
        if (String((error as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT')) {
          throw new ProductConflict(`Contract ${valid.contract.digest} already has a primary Ticket link`)
        }
        throw error
      }
      return { created: true }
    })
  }

  /** All links of a Work, newest contract revision first, primary before child. */
  listByWork(workId: string): TicketLink[] {
    const rows = this.db.prepare(`SELECT value FROM ticket_links WHERE work_id = ?
      ORDER BY revision DESC, CASE role WHEN 'primary' THEN 0 ELSE 1 END, ticket_id`).all(workId) as Row[]
    return rows.map(row => json<TicketLink>(row.value))
  }

  listByRef(ref: ContractRef): TicketLink[] {
    const rows = this.db.prepare(`SELECT value FROM ticket_links WHERE work_id = ? AND revision = ? AND digest = ?
      ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, ticket_id`).all(ref.workId, ref.revision, ref.digest) as Row[]
    return rows.map(row => json<TicketLink>(row.value))
  }
}

export class ProductMessages {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  private readonly conversations: import('./workflows.ts').ProductConversations | undefined
  constructor(db: Database.Database, uow: UnitOfWork, conversations?: import('./workflows.ts').ProductConversations) {
    this.db = db
    this.uow = uow
    this.conversations = conversations
  }

  /**
   * Appends a message with a transaction-assigned per-conversation sequence. A replay of the same
   * message ID keeps the original sequence and returns the stored message; a different body is a
   * conflict. `sequence` is never accepted from the caller.
   */
  append(input: NewConversationMessage): ConversationMessage {
    return this.uow.atomic(() => {
      const existing = this.getById(input.id)
      if (existing) {
        if (digest(existing) !== digest({ ...input, sequence: existing.sequence })) {
          throw new ProductConflict(`Message ${input.id} already exists with a different body`)
        }
        return existing
      }
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM conversation_messages WHERE conversation_id = ?')
        .get(input.conversationId) as { sequence: number }
      const message = ConversationMessageSchema.parse({ ...input, sequence: Number(row.sequence) + 1 })
      this.db.prepare('INSERT INTO conversation_messages (conversation_id, sequence, id, value, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(message.conversationId, message.sequence, message.id, JSON.stringify(message), message.createdAt)
      // The catalog is a derived directory over the persisted message identity; it never rewrites
      // the message, sequence or archive state. Existing callers need no extra write.
      this.conversations?.ensureForMessage({
        conversationId: message.conversationId,
        ...(message.projectId ? { projectId: message.projectId } : {}),
        text: message.text,
        createdAt: message.createdAt,
      })
      this.conversations?.indexMessage(message)
      return message
    })
  }

  getById(id: string): ConversationMessage | undefined {
    const row = this.db.prepare('SELECT value FROM conversation_messages WHERE id = ?').get(id) as Row | undefined
    return row ? json<ConversationMessage>(row.value) : undefined
  }

  /**
   * Exclusive `before` pagination over persisted sequence. Returns the newest `limit` messages older
   * than `before` in ascending order; `beforeCursor` is the oldest returned sequence (pass it as the
   * next `before`) and `hasMore` reports whether older messages remain.
   */
  page(conversationId: string, options: { before?: number; limit?: number } = {}): ConversationPage {
    const limit = limitOf(options.limit, 50, 200)
    const before = options.before ?? Number.MAX_SAFE_INTEGER
    const rows = this.db.prepare(`SELECT value FROM conversation_messages WHERE conversation_id = ? AND sequence < ?
      ORDER BY sequence DESC LIMIT ?`).all(conversationId, before, limit + 1) as Row[]
    const hasMore = rows.length > limit
    const messages = rows.slice(0, limit).reverse().map(row => json<ConversationMessage>(row.value))
    return {
      conversationId,
      messages,
      ...(messages.length ? { beforeCursor: messages[0]!.sequence } : {}),
      hasMore,
    }
  }
}

export class ProductQuestions {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  /** Frozen question as opened; Broker semantics (answer/expiry/targets) stay outside storage. */
  insert(question: UserQuestion): { created: boolean } {
    const valid = UserQuestionSchema.parse(question)
    return this.uow.atomic(() => {
      const existing = this.db.prepare('SELECT value FROM user_questions WHERE id = ?').get(valid.id) as Row | undefined
      if (existing) {
        if (digest(json(existing.value)) !== digest(valid)) throw new ProductConflict(`Question ${valid.id} already exists with a different body`)
        return { created: false }
      }
      this.db.prepare('INSERT INTO user_questions (id, version, work_id, revision, digest, validity, opened_at, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(valid.id, valid.version, valid.contract.workId, valid.contract.revision, valid.contract.digest, valid.validity, valid.openedAt, JSON.stringify(valid))
      return { created: true }
    })
  }

  get(id: string): UserQuestion | undefined {
    const row = this.db.prepare('SELECT value FROM user_questions WHERE id = ?').get(id) as Row | undefined
    return row ? json<UserQuestion>(row.value) : undefined
  }

  /** Open questions, newest first, bounded. */
  listOpen(options: { workId?: string; limit?: number } = {}): UserQuestion[] {
    const limit = limitOf(options.limit, 50, 200)
    const rows = options.workId
      ? this.db.prepare("SELECT value FROM user_questions WHERE validity = 'open' AND work_id = ? ORDER BY opened_at DESC, id LIMIT ?").all(options.workId, limit)
      : this.db.prepare("SELECT value FROM user_questions WHERE validity = 'open' ORDER BY opened_at DESC, id LIMIT ?").all(limit)
    return (rows as Row[]).map(row => json<UserQuestion>(row.value))
  }

  /**
   * Compare-and-set replacement: the stored version and validity must still equal `expected`, and the
   * replacement must be a strictly newer version of the same question/contract. A stale caller gets
   * `ProductConflict` and changes nothing.
   */
  replaceExpected(next: UserQuestion, expected: { version: number; validity: UserQuestion['validity'] }): { updated: boolean } {
    const valid = UserQuestionSchema.parse(next)
    return this.uow.atomic(() => {
      const row = this.db.prepare('SELECT version, validity, work_id, revision, digest FROM user_questions WHERE id = ?').get(valid.id) as Row | undefined
      if (!row) throw new ProductConflict(`Unknown question ${valid.id}`)
      if (Number(row.version) !== expected.version || String(row.validity) !== expected.validity) {
        throw new ProductConflict(`Question ${valid.id} moved to version ${String(row.version)}/${String(row.validity)}`)
      }
      if (valid.version <= expected.version) throw new ProductConflict('A replacement must advance the question version')
      if (String(row.work_id) !== valid.contract.workId || Number(row.revision) !== valid.contract.revision || String(row.digest) !== valid.contract.digest) {
        throw new ProductConflict('A question cannot change its contract identity')
      }
      const result = this.db.prepare('UPDATE user_questions SET version = ?, validity = ?, value = ? WHERE id = ? AND version = ? AND validity = ?')
        .run(valid.version, valid.validity, JSON.stringify(valid), valid.id, expected.version, expected.validity)
      if (Number(result.changes) !== 1) throw new ProductConflict(`Question ${valid.id} changed concurrently`)
      return { updated: true }
    })
  }
}

export class ProductDispatchControls {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  /** The manual dispatch switch only; it never stores a Work/execution phase. */
  get(scope: string): DispatchControl | undefined {
    const row = this.db.prepare('SELECT paused, revision FROM dispatch_controls WHERE scope = ?').get(scope) as Row | undefined
    return row ? { paused: Number(row.paused) === 1, revision: Number(row.revision) } : undefined
  }

  /** Initializes at revision 1 (`expectedRevision = 0`) or advances one revision; stale expectations conflict. */
  compareAndSet(scope: string, expectedRevision: number, paused: boolean): DispatchControl {
    return this.uow.atomic(() => {
      const current = this.get(scope)
      if (!current) {
        if (expectedRevision !== 0) throw new DispatchConflict(`Dispatch control ${scope} does not exist; expected revision 0, got ${expectedRevision}`)
        this.db.prepare('INSERT INTO dispatch_controls (scope, paused, revision, updated_at) VALUES (?, ?, 1, ?)')
          .run(scope, paused ? 1 : 0, new Date().toISOString())
        return { paused, revision: 1 }
      }
      if (current.revision !== expectedRevision) throw new DispatchConflict(`Dispatch control ${scope} is at revision ${current.revision}, not ${expectedRevision}`)
      const result = this.db.prepare('UPDATE dispatch_controls SET paused = ?, revision = revision + 1, updated_at = ? WHERE scope = ? AND revision = ?')
        .run(paused ? 1 : 0, new Date().toISOString(), scope, expectedRevision)
      if (Number(result.changes) !== 1) throw new DispatchConflict(`Dispatch control ${scope} changed concurrently`)
      return { paused, revision: expectedRevision + 1 }
    })
  }
}

/** The product-record collection exposed as `store.product`. */
export class ProductRecords {
  readonly works: ProductWorks
  readonly contracts: ProductContracts
  readonly links: ProductLinks
  readonly messages: ProductMessages
  readonly questions: ProductQuestions
  readonly dispatchControls: ProductDispatchControls

  constructor(db: Database.Database, uow: UnitOfWork) {
    this.works = new ProductWorks(db, uow)
    this.contracts = new ProductContracts(db, uow)
    this.links = new ProductLinks(db, uow)
    const conversations = new ProductConversations(db, uow)
    this.messages = new ProductMessages(db, uow, conversations)
    this.questions = new ProductQuestions(db, uow)
    this.dispatchControls = new ProductDispatchControls(db, uow)
  }
}
