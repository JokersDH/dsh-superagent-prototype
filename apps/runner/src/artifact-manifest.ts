/**
 * Attempt artifact manifest (wave-02, generic artifact fix).
 *
 * A candidate (`candidate.observed`) is only meaningful if its `artifactRefs` name artifacts the
 * attempt actually produced: a stale or empty reference list would let a completion gate accept
 * nothing. This module gives the Runner an owned, bounded description of what one attempt wrote, so
 * the Driver can publish real references instead of placeholders.
 *
 * Rules:
 * - an artifact is identified by a content digest, never by a path alone: the same path with
 *   different bytes is a different artifact;
 * - registering a different body under an existing reference is a conflict (artifacts are immutable);
 * - the manifest is bounded, and a full manifest refuses new entries rather than dropping old ones;
 * - `artifactRefs()` returns them in registration order so a manifest is reproducible.
 */
import { createHash } from 'node:crypto'
import { DriverError } from '../../../packages/driver-kit/src/index.ts'

export type ArtifactEntry = {
  /** Stable reference the candidate payload points at. */
  ref: string
  /** Absolute path inside the attempt workspace, for diagnostics only. */
  path: string
  /** sha256 of the artifact bytes. */
  digest: string
  bytes: number
  at: string
}

export type ArtifactSource = {
  path: string
  /** The bytes, or a function returning them; only the digest is kept. */
  bytes: Uint8Array
}

const REF = /^artifact-[A-Za-z0-9._:-]{1,120}$/

export class AttemptArtifactManifest {
  readonly #maxEntries: number
  readonly #now: () => string
  readonly #byRef = new Map<string, ArtifactEntry>()
  readonly #byPathDigest = new Map<string, string>()
  #seq = 0

  constructor(options: { maxEntries?: number; now?: () => string } = {}) {
    this.#maxEntries = options.maxEntries ?? 256
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  get size(): number {
    return this.#byRef.size
  }

  /**
   * Register one artifact and return its reference.
   *
   * Re-registering identical bytes for the same path returns the existing reference (idempotent);
   * a different body under the same path is a new artifact, and a conflicting body under an existing
   * reference is refused.
   */
  register(input: ArtifactSource): ArtifactEntry {
    const digest = createHash('sha256').update(input.bytes).digest('hex')
    const pathKey = `${input.path}\u0000${digest}`
    const existing = this.#byPathDigest.get(pathKey)
    if (existing !== undefined) return this.#byRef.get(existing)!

    if (this.#byRef.size >= this.#maxEntries) {
      throw new DriverError(
        'state_indeterminate',
        'artifact_manifest_full',
        `Artifact manifest holds ${this.#byRef.size} entries; refusing to drop a produced artifact`,
      )
    }
    this.#seq += 1
    const ref = `artifact-${this.#seq}-${digest.slice(0, 16)}`
    if (!REF.test(ref)) throw new DriverError('protocol_error', 'invalid_artifact_ref', ref)
    const entry: ArtifactEntry = { ref, path: input.path, digest, bytes: input.bytes.byteLength, at: this.#now() }
    this.#byRef.set(ref, entry)
    this.#byPathDigest.set(pathKey, ref)
    return entry
  }

  /** References in registration order; this is what a candidate payload carries. */
  artifactRefs(): string[] {
    return [...this.#byRef.keys()]
  }

  entries(): ArtifactEntry[] {
    return [...this.#byRef.values()]
  }

  get(ref: string): ArtifactEntry | undefined {
    return this.#byRef.get(ref)
  }

  /** A candidate needs at least one real artifact; an empty candidate is never publishable. */
  requireCandidateArtifacts(): string[] {
    const refs = this.artifactRefs()
    if (refs.length === 0) {
      throw new DriverError('state_indeterminate', 'candidate_without_artifacts', 'A candidate must reference at least one produced artifact')
    }
    return refs
  }
}
