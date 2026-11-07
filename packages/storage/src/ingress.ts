/**
 * Production runtime-ingress storage (WP-01 ingress store request). It supplies the durable pieces
 * the coordinator's composed `RuntimeIngressStore` needs — binding history and the current-by-ticket
 * pointer, the enabled-contract authority check, and immutable content-addressed payloads — while
 * the composition bridge owns the authenticated Runner context and the business/physical reducers.
 *
 * Storage stays structural over the binding JSON (generic `T extends BindingIdentity`), so the
 * public `IngressBinding` definition stays owned by `apps/coordinator/runtime-ingress.ts`; a repo
 * test proves the two are compatible and that complete binding JSON is preserved.
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ContractRef, Json } from '@personal-agent/contracts'
import { ArtifactStore } from './artifacts.ts'

type Row = Record<string, unknown>

/** Canonical JSON with sorted object keys, as the coordinator ingress uses for payload digests. */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`
}
/** SHA-256 of the canonical JSON form — the host-recorded payload digest. */
export const canonicalDigest = (value: Json): string => createHash('sha256').update(canonicalJson(value)).digest('hex')

/** The identity fields of a binding: indexed, immutable per attempt and enforced on every update. */
export interface BindingIdentity {
  attemptId: string
  ticketId: string
  assignmentId: string
  fenceEpoch: number
  contract: ContractRef
  state: 'active' | 'stopping' | 'ended'
  runnerIdentityRef: string
  source: string
  resources: readonly { ref: string; ownership: 'spawned_process' | 'shared_service_session' }[]
}

/** A binding update would rewrite its immutable identity or revive an ended attempt. */
export class BindingConflict extends Error {}
/** A payload reference exists with different content (never expected for content-addressed refs). */
export class PayloadConflict extends Error {}

const sameContract = (a: ContractRef, b: ContractRef): boolean =>
  a.workId === b.workId && a.revision === b.revision && a.digest === b.digest

/** Known bindings by attempt (history) plus the current binding by ticket; ended attempts never reactivate. */
export class RuntimeBindings {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  /** Records or updates one attempt's binding; full JSON (resources included) is preserved. */
  record<T extends BindingIdentity>(binding: T): void {
    const existing = this.row(binding.attemptId)
    if (!existing) {
      this.db.prepare('INSERT INTO runtime_bindings (attempt_id, ticket_id, state, value) VALUES (?, ?, ?, ?)')
        .run(binding.attemptId, binding.ticketId, binding.state, JSON.stringify(binding))
      return
    }
    const current = JSON.parse(String(existing.value)) as BindingIdentity
    const identityChanged = current.ticketId !== binding.ticketId
      || current.assignmentId !== binding.assignmentId
      || current.fenceEpoch !== binding.fenceEpoch
      || !sameContract(current.contract, binding.contract)
      || current.runnerIdentityRef !== binding.runnerIdentityRef
      || current.source !== binding.source
    if (identityChanged) throw new BindingConflict(`Attempt ${binding.attemptId} already has a different immutable binding identity`)
    if (current.state === 'ended' && binding.state !== 'ended') {
      throw new BindingConflict(`Attempt ${binding.attemptId} has ended and cannot return to ${binding.state}`)
    }
    this.db.prepare('UPDATE runtime_bindings SET state = ?, value = ? WHERE attempt_id = ?')
      .run(binding.state, JSON.stringify(binding), binding.attemptId)
  }

  /** A known binding by attempt (active, stopping, or ended history). */
  binding<T = BindingIdentity>(attemptId: string): T | undefined {
    const row = this.row(attemptId)
    return row ? JSON.parse(String(row.value)) as T : undefined
  }

  /** The current binding of a ticket, as the separate current-by-ticket pointer selects it. */
  current<T = BindingIdentity>(ticketId: string): T | undefined {
    const row = this.db.prepare(`SELECT b.value FROM runtime_bindings b JOIN runtime_current c ON c.attempt_id = b.attempt_id WHERE c.ticket_id = ?`)
      .get(ticketId) as Row | undefined
    return row ? JSON.parse(String(row.value)) as T : undefined
  }

  /** Points a ticket at its current attempt; the binding must exist (no pointer to an unknown attempt). */
  setCurrent(ticketId: string, attemptId: string): void {
    if (!this.row(attemptId)) throw new BindingConflict(`Unknown attempt ${attemptId} cannot become current for ${ticketId}`)
    this.db.prepare('INSERT INTO runtime_current (ticket_id, attempt_id) VALUES (?, ?) ON CONFLICT(ticket_id) DO UPDATE SET attempt_id = excluded.attempt_id')
      .run(ticketId, attemptId)
  }

  /** Marks an attempt ended in place (idempotent); its history row stays available. */
  end(attemptId: string): void {
    const row = this.row(attemptId)
    if (!row) throw new BindingConflict(`Unknown attempt ${attemptId}`)
    const binding = JSON.parse(String(row.value)) as BindingIdentity
    if (binding.state === 'ended') return
    binding.state = 'ended'
    this.db.prepare('UPDATE runtime_bindings SET state = ?, value = ? WHERE attempt_id = ?')
      .run('ended', JSON.stringify(binding), attemptId)
  }

  private row(attemptId: string): Row | undefined {
    return this.db.prepare('SELECT attempt_id, ticket_id, state, value FROM runtime_bindings WHERE attempt_id = ?').get(attemptId) as Row | undefined
  }
}

/** Enabled contract revisions for the current-authorization check; a disabled revision is refused. */
export class RuntimeAuthority {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  enable(ref: ContractRef): void {
    this.db.prepare(`INSERT INTO runtime_authority (work_id, revision, digest, enabled) VALUES (?, ?, ?, 1)
      ON CONFLICT(work_id, revision, digest) DO UPDATE SET enabled = 1`).run(ref.workId, ref.revision, ref.digest)
  }
  disable(ref: ContractRef): void {
    this.db.prepare('UPDATE runtime_authority SET enabled = 0 WHERE work_id = ? AND revision = ? AND digest = ?')
      .run(ref.workId, ref.revision, ref.digest)
  }
  isCurrent(ref: ContractRef): boolean {
    return !!this.db.prepare('SELECT 1 FROM runtime_authority WHERE work_id = ? AND revision = ? AND digest = ? AND enabled = 1')
      .get(ref.workId, ref.revision, ref.digest)
  }
}

/**
 * Immutable content-addressed JSON payloads. `write` completes the file and its record before it
 * returns, so a caller can reference it in the same transaction; `read` returns the value with the
 * host-recorded canonical SHA-256 and verifies both the artifact digest and the record.
 */
export class ImmutablePayloads {
  private readonly db: Database.Database
  private readonly artifacts: ArtifactStore
  constructor(db: Database.Database, artifacts: ArtifactStore) {
    this.db = db
    this.artifacts = artifacts
  }

  /** Stores one JSON value under `payload:<sha256-of-canonical-json>`; identical content reuses the record. */
  write(value: Json): { ref: string; sha256: string } {
    const text = canonicalJson(value)
    const sha256 = createHash('sha256').update(text).digest('hex')
    const ref = `payload:${sha256}`
    const written = this.artifacts.write(new TextEncoder().encode(text))
    // The payload file is an artifact: registering it keeps reads digest-verified and protects it from GC.
    this.artifacts.insert(written)
    const existing = this.db.prepare('SELECT sha256 FROM ingress_payloads WHERE ref = ?').get(ref) as Row | undefined
    if (existing && String(existing.sha256) !== sha256) throw new PayloadConflict(`Payload ${ref} already exists with a different digest`)
    this.db.prepare('INSERT OR IGNORE INTO ingress_payloads (ref, sha256, artifact_id, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ref, sha256, written.id, written.bytes, new Date().toISOString())
    return { ref, sha256 }
  }

  /** Resolves a reference to its JSON value and recorded digest; a changed file or an unknown ref is refused. */
  async read(ref: string): Promise<{ value: unknown; sha256: string }> {
    const row = this.db.prepare('SELECT sha256, artifact_id FROM ingress_payloads WHERE ref = ?').get(ref) as Row | undefined
    if (!row) throw new Error(`Unknown immutable payload reference: ${ref}`)
    const artifact = this.artifacts.read(String(row.artifact_id))
    if (!artifact) throw new Error(`Immutable payload ${ref} is missing its file`)
    const text = new TextDecoder().decode(artifact.data)
    const sha256 = createHash('sha256').update(text).digest('hex')
    if (sha256 !== String(row.sha256)) throw new Error(`Immutable payload ${ref} no longer matches its recorded digest`)
    return { value: JSON.parse(text) as Json, sha256 }
  }
}
