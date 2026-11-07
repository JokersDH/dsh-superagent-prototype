/**
 * Bounded journal and stderr ring (WP-03, RT-07 / REL-05 / REL-07).
 *
 * Critical facts may never be dropped silently: when the critical reserve is full the Runner stops
 * accepting new business input instead. Diagnostics are a ring: oldest entries are dropped and the
 * loss is recorded as an explicit gap, so recovery can say "unknown after this point" rather than
 * pretending the record is complete. stderr is text for humans, never a business fact.
 */
import { DriverError } from '../../../packages/driver-kit/src/index.ts'

export type CriticalEntry = { seq: number; factId: string; kind: string; at: number }
export type DiagnosticEntry = { seq: number; kind: string; at: number; detail?: string }

export type JournalSnapshot = {
  critical: readonly CriticalEntry[]
  diagnostics: readonly DiagnosticEntry[]
  droppedDiagnostics: number
  gaps: number
  criticalCapacity: number
  diagnosticCapacity: number
}

export class BoundedJournal {
  readonly #criticalCapacity: number
  readonly #diagnosticCapacity: number
  readonly #critical: CriticalEntry[] = []
  readonly #diagnostics: DiagnosticEntry[] = []
  readonly #now: () => number
  #droppedDiagnostics = 0
  #gaps = 0
  #diagnosticSeq = 0

  constructor(options: { criticalCapacity?: number; diagnosticCapacity?: number; now?: () => number } = {}) {
    this.#criticalCapacity = options.criticalCapacity ?? 256
    this.#diagnosticCapacity = options.diagnosticCapacity ?? 1024
    this.#now = options.now ?? Date.now
  }

  get criticalRemaining(): number {
    return this.#criticalCapacity - this.#critical.length
  }

  get criticalFull(): boolean {
    return this.#critical.length >= this.#criticalCapacity
  }

  /** Check the reserve before touching the durable sink. */
  assertCriticalCapacity(): void {
    if (this.criticalFull) {
      throw new DriverError('state_indeterminate', 'critical_reserve_exhausted', `Critical journal reserve is full (${this.#criticalCapacity})`)
    }
  }

  commitCritical(factId: string, kind: string): void {
    if (this.#critical.length >= this.#criticalCapacity) {
      throw new DriverError('state_indeterminate', 'critical_reserve_exhausted', 'Critical reserve changed during commit')
    }
    this.#critical.push({ seq: this.#critical.length + 1, factId, kind, at: this.#now() })
  }

  appendDiagnostic(kind: string, detail?: string): void {
    this.#diagnosticSeq += 1
    if (this.#diagnostics.length >= this.#diagnosticCapacity) {
      this.#diagnostics.shift()
      this.#droppedDiagnostics += 1
      this.#gaps += 1
    }
    this.#diagnostics.push({ seq: this.#diagnosticSeq, kind, at: this.#now(), ...(detail === undefined ? {} : { detail }) })
  }

  snapshot(): JournalSnapshot {
    return {
      critical: [...this.#critical],
      diagnostics: [...this.#diagnostics],
      droppedDiagnostics: this.#droppedDiagnostics,
      gaps: this.#gaps,
      criticalCapacity: this.#criticalCapacity,
      diagnosticCapacity: this.#diagnosticCapacity,
    }
  }
}

/** Later consumers must treat `gaps > 0` as "journal coverage unknown", never as completeness. */
export function journalCoverage(snapshot: JournalSnapshot): 'complete' | 'gapped' {
  return snapshot.gaps > 0 ? 'gapped' : 'complete'
}

export class StderrRing {
  readonly #maxBytes: number
  readonly #chunks: Buffer[] = []
  #bytes = 0
  #droppedBytes = 0
  #totalBytes = 0

  constructor(options: { maxBytes?: number } = {}) {
    this.#maxBytes = options.maxBytes ?? 64 * 1024
  }

  append(chunk: Uint8Array): void {
    const buffer = Buffer.from(chunk)
    this.#totalBytes += buffer.length
    this.#chunks.push(buffer)
    this.#bytes += buffer.length
    while (this.#bytes > this.#maxBytes && this.#chunks.length > 1) {
      const dropped = this.#chunks.shift()!
      this.#bytes -= dropped.length
      this.#droppedBytes += dropped.length
    }
    if (this.#bytes > this.#maxBytes) {
      // A single oversized line: keep the tail only.
      const kept = this.#chunks[0]!.subarray(this.#bytes - this.#maxBytes)
      this.#droppedBytes += this.#chunks[0]!.length - kept.length
      this.#chunks[0] = kept
      this.#bytes = kept.length
    }
  }

  text(): string {
    return Buffer.concat(this.#chunks).toString('utf8')
  }

  stats(): { bytes: number; totalBytes: number; droppedBytes: number } {
    return { bytes: this.#bytes, totalBytes: this.#totalBytes, droppedBytes: this.#droppedBytes }
  }
}
