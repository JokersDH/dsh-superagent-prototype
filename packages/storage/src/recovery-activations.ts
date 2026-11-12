/**
 * Wave-08 A2: production RecoveryActivationFacts over the shared 0027 schema. The intent is one
 * immutable source fact, joined to the caller's source UnitOfWork (command receipt/event are written
 * by main's RecoveryIntentCommitter in the same transaction). It never authorizes a target start,
 * grants HTTP access or performs file/network/async work.
 */
import type Database from 'better-sqlite3'
import { RecoveryActivationIntentSchema } from '@personal-agent/contracts'
import type { RecoveryActivationFacts, RecoveryActivationIntent } from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { WorkflowConflict } from './workflow-errors.ts'

type Row = Record<string, unknown>
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))

/** Strict immutable A fact mapper shared by the activation store and the recovery source. */
export function recoveryActivationFromRow(row: Row): RecoveryActivationIntent {
  let intent: RecoveryActivationIntent
  try { intent = RecoveryActivationIntentSchema.parse(json(row.value)) } catch (error) {
    throw new WorkflowConflict(`Recovery activation ${String(row.activation_id)} has an invalid payload: ${String(error)}`)
  }
  // Every indexed column must agree with the immutable body; a hand-edited row is not a fact.
  if (
    String(row.activation_id) !== intent.activationId || String(row.command_id) !== intent.commandId ||
    String(row.plan_id) !== intent.planId || String(row.plan_digest) !== intent.planDigest ||
    String(row.principal_user_id) !== intent.principal.userId ||
    String(row.principal_authority_ref) !== intent.principal.authorityRef ||
    String(row.machine_digest) !== intent.machineDigest ||
    String(row.resource_policy_digest) !== intent.resourcePolicyDigest ||
    String(row.created_at) !== intent.createdAt || String(row.expires_at) !== intent.expiresAt ||
    String(row.digest) !== digest(intent) ||
    String(row.source_json) !== JSON.stringify(intent.source) || String(row.target_json) !== JSON.stringify(intent.target)
  ) throw new WorkflowConflict(`Recovery activation ${String(row.activation_id)} row is inconsistent with its payload`)
  return intent
}

export class RecoveryActivations implements RecoveryActivationFacts {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) {
    this.db = db
    this.uow = uow
  }

  private mapRow(row: Row): RecoveryActivationIntent { return recoveryActivationFromRow(row) }

  get(activationId: string): RecoveryActivationIntent | undefined {
    const row = this.db.prepare('SELECT * FROM recovery_activations WHERE activation_id = ?').get(activationId) as Row | undefined
    return row ? this.mapRow(row) : undefined
  }

  forCommand(commandId: string): RecoveryActivationIntent | undefined {
    const row = this.db.prepare('SELECT * FROM recovery_activations WHERE command_id = ?').get(commandId) as Row | undefined
    return row ? this.mapRow(row) : undefined
  }

  /**
   * Immutable same-body replay. A different target/plan/principal/resource policy under the same
   * activation, command or plan identity conflicts; nothing is overwritten or silently upgraded.
   */
  put(input: RecoveryActivationIntent): { intent: RecoveryActivationIntent; replayed: boolean } {
    let intent: RecoveryActivationIntent
    try { intent = RecoveryActivationIntentSchema.parse(input) } catch (error) {
      throw new WorkflowConflict(`Recovery activation failed shared contract validation: ${String(error)}`)
    }
    const valueDigest = digest(intent)
    return this.uow.atomic(() => {
      const byActivation = this.db.prepare('SELECT * FROM recovery_activations WHERE activation_id = ?').get(intent.activationId) as Row | undefined
      if (byActivation) {
        if (String(byActivation.digest) !== valueDigest)
          throw new WorkflowConflict(`Recovery activation ${intent.activationId} already has a different body`)
        return { intent: this.mapRow(byActivation), replayed: true }
      }
      const byCommand = this.db.prepare('SELECT * FROM recovery_activations WHERE command_id = ?').get(intent.commandId) as Row | undefined
      if (byCommand) {
        if (String(byCommand.digest) !== valueDigest)
          throw new WorkflowConflict(`Recovery command ${intent.commandId} already names another activation`)
        return { intent: this.mapRow(byCommand), replayed: true }
      }
      const byPlan = this.db.prepare('SELECT * FROM recovery_activations WHERE plan_id = ?').get(intent.planId) as Row | undefined
      if (byPlan) {
        if (String(byPlan.digest) !== valueDigest)
          throw new WorkflowConflict(`Recovery plan ${intent.planId} already has a different activation`)
        return { intent: this.mapRow(byPlan), replayed: true }
      }
      this.db.prepare(`INSERT INTO recovery_activations
        (activation_id, command_id, plan_id, plan_digest, source_json, target_json, principal_user_id,
         principal_authority_ref, machine_digest, resource_policy_digest, created_at, expires_at, value, digest)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        intent.activationId, intent.commandId, intent.planId, intent.planDigest,
        JSON.stringify(intent.source), JSON.stringify(intent.target),
        intent.principal.userId, intent.principal.authorityRef, intent.machineDigest, intent.resourcePolicyDigest,
        intent.createdAt, intent.expiresAt, JSON.stringify(intent), valueDigest,
      )
      return { intent: this.get(intent.activationId)!, replayed: false }
    })
  }
}
