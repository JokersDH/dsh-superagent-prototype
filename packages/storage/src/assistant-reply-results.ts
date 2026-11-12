/**
 * Wave-11 A5/A6: completed assistant reply data joined to the existing before-send request receipt.
 * One immutable result per request and per reply identity; a request record alone stays unknown.
 * The port stores references and digests only and never sends a model request.
 */
import type Database from 'better-sqlite3'
import { AssistantInferenceRecordSchema, AssistantReplyResultSchema } from '@personal-agent/contracts'
import type { AssistantReplyResult, AssistantReplyResults } from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { WorkflowConflict } from './workflow-errors.ts'

type Row = Record<string, unknown>
const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))
const MAX_BYTES = 524288

function resultFromRow(row: Row): AssistantReplyResult {
  let result: AssistantReplyResult
  try { result = AssistantReplyResultSchema.parse(JSON.parse(String(row.value))) } catch (error) {
    throw new WorkflowConflict(`Assistant reply ${String(row.request_id)} has an invalid payload: ${String(error)}`)
  }
  if (String(row.request_id) !== result.requestId || String(row.request_digest) !== result.requestDigest ||
    String(row.source_message_id) !== result.sourceMessageId || String(row.reply_message_id) !== result.replyMessageId ||
    String(row.project_id) !== result.projectId || String(row.conversation_id) !== result.conversationId ||
    String(row.principal_user_id) !== result.principal.userId ||
    String(row.principal_authority_ref) !== result.principal.authorityRef || String(row.model) !== result.model ||
    String(row.artifact_ref) !== result.artifactRef || String(row.artifact_digest) !== result.artifactDigest ||
    String(row.text_digest) !== result.textDigest || String(row.recorded_at) !== result.recordedAt ||
    String(row.digest) !== digest(result))
    throw new WorkflowConflict(`Assistant reply ${String(row.request_id)} row is inconsistent with its payload`)
  return result
}

export class AssistantReplyResultStore implements AssistantReplyResults {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  private request(result: AssistantReplyResult): void {
    const receipt = this.db.prepare('SELECT * FROM command_receipts WHERE command_id = ?').get(result.requestId) as Row | undefined
    if (!receipt || String(receipt.status) !== 'recorded' || String(receipt.payload_digest) !== result.requestDigest)
      throw new WorkflowConflict(`Assistant request ${result.requestId} is not an exact recorded before-send receipt`)
    let inference
    try { inference = AssistantInferenceRecordSchema.parse(JSON.parse(String(receipt.result))) } catch (error) {
      throw new WorkflowConflict(`Assistant request ${result.requestId} has an invalid inference record: ${String(error)}`)
    }
    if (inference.input.messageId !== result.sourceMessageId || inference.input.projectId !== result.projectId ||
      inference.input.conversationId !== result.conversationId || inference.model !== result.model)
      throw new WorkflowConflict(`Assistant request ${result.requestId} does not match its source/project/model`)
    const artifact = this.db.prepare('SELECT digest, bytes FROM artifacts WHERE id = ?').get(result.artifactRef) as Row | undefined
    if (!artifact || String(artifact.digest) !== result.artifactDigest)
      throw new WorkflowConflict(`Assistant reply artifact ${result.artifactRef} is missing or has another digest`)
    const bytes = Number(artifact.bytes)
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_BYTES)
      throw new WorkflowConflict(`Assistant reply artifact ${result.artifactRef} is outside the bounded body size`)
  }

  forRequest(requestId: string): AssistantReplyResult | undefined {
    const row = this.db.prepare('SELECT * FROM assistant_reply_results WHERE request_id = ?').get(requestId) as Row | undefined
    return row ? resultFromRow(row) : undefined
  }

  forReply(replyMessageId: string): AssistantReplyResult | undefined {
    const row = this.db.prepare('SELECT * FROM assistant_reply_results WHERE reply_message_id = ?').get(replyMessageId) as Row | undefined
    return row ? resultFromRow(row) : undefined
  }

  put(input: AssistantReplyResult): { result: AssistantReplyResult; replayed: boolean } {
    let result: AssistantReplyResult
    try { result = AssistantReplyResultSchema.parse(input) } catch (error) {
      throw new WorkflowConflict(`Assistant reply failed shared contract validation: ${String(error)}`)
    }
    const valueDigest = digest(result)
    return this.uow.atomic(() => {
      this.request(result)
      const byRequest = this.db.prepare('SELECT * FROM assistant_reply_results WHERE request_id = ?').get(result.requestId) as Row | undefined
      if (byRequest) {
        if (String(byRequest.digest) !== valueDigest) throw new WorkflowConflict(`Assistant request ${result.requestId} already has a different completed reply`)
        return { result: resultFromRow(byRequest), replayed: true }
      }
      const byReply = this.db.prepare('SELECT * FROM assistant_reply_results WHERE reply_message_id = ?').get(result.replyMessageId) as Row | undefined
      if (byReply) {
        if (String(byReply.digest) !== valueDigest) throw new WorkflowConflict(`Assistant reply ${result.replyMessageId} already names another request`)
        return { result: resultFromRow(byReply), replayed: true }
      }
      this.db.prepare(`INSERT INTO assistant_reply_results
        (request_id, request_digest, source_message_id, reply_message_id, project_id, conversation_id,
         principal_user_id, principal_authority_ref, model, artifact_ref, artifact_digest, text_digest,
         recorded_at, value, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        result.requestId, result.requestDigest, result.sourceMessageId, result.replyMessageId, result.projectId,
        result.conversationId, result.principal.userId, result.principal.authorityRef, result.model,
        result.artifactRef, result.artifactDigest, result.textDigest, result.recordedAt,
        JSON.stringify(result), valueDigest,
      )
      return { result: this.forRequest(result.requestId)!, replayed: false }
    })
  }
}
