/**
 * Registered check definitions (WP-04). Only definitions a trusted operator registered can run:
 * a contract criterion names a check definition ID, and external text or a worker's self-report can
 * never turn into an arbitrary shell command. Revisions are immutable and additive; the verifier
 * records the exact revision it executed.
 */
import { createHash } from 'node:crypto'

export interface CheckDefinition {
  /** The ID a contract criterion's `checkDefinitionRef` names. */
  id: string
  /** Immutable revision of this definition; a changed body must use a new revision. */
  revision: number
  title?: string
  executable: string
  argv: readonly string[]
  /** Working directory relative to the frozen workspace; must stay inside it. */
  cwd?: string
  /** Environment variable names passed through from the host; nothing else is inherited. */
  allowedEnvironment?: readonly string[]
  deadlineMs: number
  /** Captured stdout+stderr byte budget; exceeding it fails the check instead of buffering without bound. */
  outputLimitBytes: number
}

export class CheckConflict extends Error {}
export class UnknownCheck extends Error {}
export class InvalidCheck extends Error {}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const definitionDigest = (definition: CheckDefinition): string =>
  createHash('sha256').update(JSON.stringify(definition)).digest('hex')

function validate(definition: CheckDefinition): void {
  if (!ID.test(definition.id)) throw new InvalidCheck(`Invalid check definition id: ${definition.id}`)
  if (!Number.isSafeInteger(definition.revision) || definition.revision < 1) throw new InvalidCheck(`Check ${definition.id} needs a positive revision`)
  if (!definition.executable.trim()) throw new InvalidCheck(`Check ${definition.id} needs an executable`)
  if (!Number.isSafeInteger(definition.deadlineMs) || definition.deadlineMs < 1 || definition.deadlineMs > 600_000) throw new InvalidCheck(`Check ${definition.id} deadline must be 1..600000 ms`)
  if (!Number.isSafeInteger(definition.outputLimitBytes) || definition.outputLimitBytes < 1 || definition.outputLimitBytes > 1_000_000) throw new InvalidCheck(`Check ${definition.id} output limit must be 1..1000000 bytes`)
  if (definition.cwd !== undefined && (definition.cwd.startsWith('/') || definition.cwd.split(/[\\/]/).includes('..'))) {
    throw new InvalidCheck(`Check ${definition.id} working directory must stay inside the workspace`)
  }
  for (const name of definition.allowedEnvironment ?? []) {
    if (!ENV_NAME.test(name)) throw new InvalidCheck(`Check ${definition.id} allows an invalid environment name: ${name}`)
  }
}

export class CheckRegistry {
  private readonly byId = new Map<string, Map<number, { definition: Readonly<CheckDefinition>; digest: string }>>()

  /** Registers an immutable revision; the same ID and revision with a different body conflicts. */
  register(definition: CheckDefinition): void {
    validate(definition)
    const frozen = Object.freeze({ ...definition, argv: Object.freeze([...definition.argv]), ...(definition.allowedEnvironment ? { allowedEnvironment: Object.freeze([...definition.allowedEnvironment]) } : {}) })
    const digest = definitionDigest(frozen)
    const revisions = this.byId.get(definition.id) ?? new Map()
    const existing = revisions.get(definition.revision)
    if (existing) {
      if (existing.digest !== digest) throw new CheckConflict(`Check ${definition.id} revision ${definition.revision} already exists with a different body`)
      return
    }
    revisions.set(definition.revision, { definition: frozen, digest })
    this.byId.set(definition.id, revisions)
  }

  /** The newest revision of a registered check ID, if any. */
  latest(id: string): Readonly<CheckDefinition> | undefined {
    const revisions = this.byId.get(id)
    if (!revisions) return undefined
    return revisions.get(Math.max(...revisions.keys()))?.definition
  }

  /** One exact revision, or the newest when `revision` is omitted. */
  get(id: string, revision?: number): Readonly<CheckDefinition> | undefined {
    return revision === undefined ? this.latest(id) : this.byId.get(id)?.get(revision)?.definition
  }

  /** Resolves a criterion's check reference; an unregistered check is refused (fail closed). */
  require(id: string): Readonly<CheckDefinition> {
    const definition = this.latest(id)
    if (!definition) throw new UnknownCheck(`Check definition ${id} is not registered`)
    return definition
  }

  ids(): string[] { return [...this.byId.keys()].sort() }
}
