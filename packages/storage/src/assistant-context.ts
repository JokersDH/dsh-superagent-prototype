/**
 * Wave-10 A3: append-only assistant context binding audit. This is the shared
 * `AssistantContextBindings` port over the existing product UnitOfWork: same body replays by either
 * identity, any identity with a different body conflicts. It never sends a request, grants tools or
 * starts a second lifecycle; main owns confirmation, HTTP and provider consumption.
 */
import type Database from 'better-sqlite3'
import { AssistantContextBindingSchema } from '@personal-agent/contracts'
import type { AssistantContextBinding, AssistantContextBindings } from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { WorkflowConflict } from './workflow-errors.ts'

type Row = Record<string, unknown>
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))

/** Shared strict row validation for the binding table; history uses the same body authority. */
export function contextBindingFromRow(row: Record<string, unknown>): AssistantContextBinding {
  let binding: AssistantContextBinding
  try { binding = AssistantContextBindingSchema.parse(json(row.value)) } catch (error) {
    throw new WorkflowConflict(`Context binding ${String(row.message_id)} has an invalid payload: ${String(error)}`)
  }
  if (
    String(row.message_id) !== binding.messageId || String(row.command_id) !== binding.commandId ||
    String(row.request_id) !== binding.requestId || String(row.project_id) !== binding.projectId ||
    String(row.conversation_id) !== binding.conversationId ||
    String(row.user_text_digest) !== binding.userTextDigest ||
    String(row.principal_user_id) !== binding.principal.userId ||
    String(row.principal_authority_ref) !== binding.principal.authorityRef ||
    String(row.bundle_ref) !== binding.bundleRef || String(row.bundle_digest) !== binding.bundleDigest ||
    String(row.confirmed_at) !== binding.confirmedAt || String(row.expires_at) !== binding.expiresAt ||
    String(row.digest) !== digest(binding) ||
    (row.work_id === undefined ? null : row.work_id) !== (binding.contract?.workId ?? null)
  ) throw new WorkflowConflict(`Context binding ${String(row.message_id)} row is inconsistent with its payload`)
  return binding
}

export class AssistantContextBindingStore implements AssistantContextBindings {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) {
    this.db = db
    this.uow = uow
  }

  private mapRow(row: Row): AssistantContextBinding { return contextBindingFromRow(row) }

  forMessage(messageId: string): AssistantContextBinding | undefined {
    const row = this.db.prepare('SELECT * FROM assistant_context_bindings WHERE message_id = ?').get(messageId) as Row | undefined
    return row ? this.mapRow(row) : undefined
  }

  forCommand(commandId: string): AssistantContextBinding | undefined {
    const row = this.db.prepare('SELECT * FROM assistant_context_bindings WHERE command_id = ?').get(commandId) as Row | undefined
    return row ? this.mapRow(row) : undefined
  }

  put(input: AssistantContextBinding): { binding: AssistantContextBinding; replayed: boolean } {
    let binding: AssistantContextBinding
    try { binding = AssistantContextBindingSchema.parse(input) } catch (error) {
      throw new WorkflowConflict(`Context binding failed shared contract validation: ${String(error)}`)
    }
    const valueDigest = digest(binding)
    return this.uow.atomic(() => {
      const byMessage = this.db.prepare('SELECT * FROM assistant_context_bindings WHERE message_id = ?').get(binding.messageId) as Row | undefined
      if (byMessage) {
        if (String(byMessage.digest) !== valueDigest)
          throw new WorkflowConflict(`Context message ${binding.messageId} already has a different binding`)
        return { binding: this.mapRow(byMessage), replayed: true }
      }
      const byCommand = this.db.prepare('SELECT * FROM assistant_context_bindings WHERE command_id = ?').get(binding.commandId) as Row | undefined
      if (byCommand) {
        if (String(byCommand.digest) !== valueDigest)
          throw new WorkflowConflict(`Context command ${binding.commandId} already has a different binding`)
        return { binding: this.mapRow(byCommand), replayed: true }
      }
      const artifact = this.db.prepare('SELECT digest FROM artifacts WHERE id = ?').get(binding.bundleRef) as { digest?: unknown } | undefined
      if (!artifact) throw new WorkflowConflict(`Context bundle ${binding.bundleRef} is not a registered artifact`)
      if (String(artifact.digest) !== binding.bundleDigest)
        throw new WorkflowConflict(`Context bundle ${binding.bundleRef} digest does not match bundleDigest`)
      this.db.prepare(`INSERT INTO assistant_context_bindings
        (message_id, command_id, request_id, project_id, conversation_id, user_text_digest,
         principal_user_id, principal_authority_ref, bundle_ref, bundle_digest,
         confirmed_at, expires_at, work_id, value, digest)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        binding.messageId, binding.commandId, binding.requestId, binding.projectId, binding.conversationId,
        binding.userTextDigest, binding.principal.userId, binding.principal.authorityRef,
        binding.bundleRef, binding.bundleDigest, binding.confirmedAt, binding.expiresAt,
        binding.contract?.workId ?? null, JSON.stringify(binding), valueDigest,
      )
      return { binding: this.forMessage(binding.messageId)!, replayed: false }
    })
  }
}
