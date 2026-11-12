/**
 * Wave-11 A3/A4: read-only keyset history over the append-only context bindings. Project scope is
 * mandatory, ordering is newest-first with a stable message identity tie-break, and bad rows fail
 * the page instead of being skipped. The raw cursor only continues data; main signs public cursors.
 */
import type Database from 'better-sqlite3'
import { AssistantContextHistoryPageSchema, AssistantContextHistoryQuerySchema } from '@personal-agent/contracts'
import type { AssistantContextBinding, AssistantContextHistory, AssistantContextHistoryPage, AssistantContextHistoryQuery } from '@personal-agent/contracts'
import { contextBindingFromRow } from './assistant-context.ts'
import { WorkflowConflict } from './workflow-errors.ts'

interface Cursor { confirmedAt: string; messageId: string }
const encode = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url')
function decode(input: string): Cursor {
  let value: unknown
  try { value = JSON.parse(Buffer.from(input, 'base64url').toString('utf8')) } catch { throw new WorkflowConflict('History cursor is not a valid continuation') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'confirmedAt,messageId')
    throw new WorkflowConflict('History cursor does not carry exactly a confirmedAt/messageId position')
  const cursor = value as Record<string, unknown>
  if (typeof cursor.confirmedAt !== 'string' || !Number.isFinite(Date.parse(cursor.confirmedAt)) ||
    typeof cursor.messageId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(cursor.messageId))
    throw new WorkflowConflict('History cursor position is invalid')
  return { confirmedAt: cursor.confirmedAt, messageId: cursor.messageId }
}

export class AssistantContextHistoryStore implements AssistantContextHistory {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  /** Low-cost reference check for main: registry presence/digest only, never body content. */
  bundleStatus(messageId: string): { binding: AssistantContextBinding; present: boolean; digestMatches: boolean; bytes: number | null } {
    const row = this.db.prepare('SELECT * FROM assistant_context_bindings WHERE message_id = ?').get(messageId) as Record<string, unknown> | undefined
    if (!row) throw new WorkflowConflict(`Context binding ${messageId} is not present`)
    const binding = contextBindingFromRow(row)
    const artifact = this.db.prepare('SELECT digest, bytes FROM artifacts WHERE id = ?').get(binding.bundleRef) as Record<string, unknown> | undefined
    return { binding, present: !!artifact, digestMatches: !!artifact && String(artifact.digest) === binding.bundleDigest,
      bytes: artifact ? Number(artifact.bytes) : null }
  }

  page(input: AssistantContextHistoryQuery): AssistantContextHistoryPage {
    const query = AssistantContextHistoryQuerySchema.parse(input)
    const limit = query.limit ?? 50
    const cursor = query.cursor ? decode(query.cursor) : undefined
    const clauses = [`project_id IN (${query.projectIds.map(() => '?').join(', ')})`]
    const args: unknown[] = [...query.projectIds]
    if (query.conversationId) { clauses.push('conversation_id = ?'); args.push(query.conversationId) }
    if (query.workId) { clauses.push('work_id = ?'); args.push(query.workId) }
    if (cursor) { clauses.push('(confirmed_at < ? OR (confirmed_at = ? AND message_id < ?))'); args.push(cursor.confirmedAt, cursor.confirmedAt, cursor.messageId) }
    const rows = this.db.transaction(() => this.db.prepare(
      `SELECT * FROM assistant_context_bindings WHERE ${clauses.join(' AND ')}
       ORDER BY confirmed_at DESC, message_id DESC LIMIT ?`,
    ).all(...args, limit + 1) as Record<string, unknown>[])()
    const hasMore = rows.length > limit
    const records = rows.slice(0, limit).map(contextBindingFromRow)
    const last = records.at(-1)
    return AssistantContextHistoryPageSchema.parse({
      protocol: 'assistant-context-history/1', observedAt: new Date().toISOString(), records, hasMore,
      ...(hasMore && last ? { nextCursor: encode({ confirmedAt: last.confirmedAt, messageId: last.messageId }) } : {}),
    })
  }
}
