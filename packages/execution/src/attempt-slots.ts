/**
 * Wave-33 B outcome 3: original-scheduler slot accounting for attempts.
 *
 * Main's product scheduler remains the authority for WHEN work starts and for the original queue. This
 * module owns only the bounded slot accounting main needs around it: start at the original 2 slots and
 * open to 4, NEVER release a slot on an unknown stop, promote queued work only after a confirmed
 * release, and restore the same accounting from the original Store's binding states without inventing a
 * second ledger. It never starts an attempt by itself and never writes Store state.
 */
export type SlotCapacity = 2 | 4
export type SlotState = 'running' | 'queued' | 'indeterminate' | 'released'

export type SlotCandidate = { attemptId: string; ticketId: string }
export type SlotRecord = SlotCandidate & { state: SlotState; lease: string }

export type SlotSettleEvidence = 'confirmed' | 'indeterminate'
export type SlotSettleResult = {
  released: boolean
  retained: boolean
  promoted: string[]
  reason?: 'unknown_evidence' | 'not_admitted' | 'already_released'
}
export type SlotAdmitResult = { state: 'running' | 'queued'; lease: string } | { state: 'duplicate' } | { state: 'refused'; reason: 'queue_full' | 'empty_id' }
export type SlotRestoreBinding = SlotCandidate & { state: 'active' | 'stopping' | 'ended' }

export type AttemptSlotOptions = {
  initial?: SlotCapacity
  max?: SlotCapacity
  maxQueued?: number
}

export class AttemptSlotScheduler {
  #capacity: SlotCapacity
  readonly #max: SlotCapacity
  readonly #maxQueued: number
  readonly #records = new Map<string, SlotRecord>()
  readonly #queue: string[] = []
  #leaseSeq = 0

  constructor(options: AttemptSlotOptions = {}) {
    this.#capacity = options.initial ?? 2
    this.#max = options.max ?? 4
    if (this.#capacity > this.#max) throw new Error('initial slot capacity cannot exceed the maximum')
    this.#maxQueued = options.maxQueued ?? 32
  }

  get capacity(): SlotCapacity { return this.#capacity }
  get running(): number { return this.#running().length }
  get queued(): number { return this.#queue.length }

  snapshot(): SlotRecord[] {
    return [...this.#records.values()].map(record => ({ ...record }))
  }

  /** Open from the original 2 slots to the original 4. Shrinking is refused, not silently clamped. */
  openTo(size: SlotCapacity): { opened: boolean; promoted: string[]; reason?: 'cannot_shrink' | 'above_max' } {
    if (size > this.#max) return { opened: false, promoted: [], reason: 'above_max' }
    if (size < this.#capacity) return { opened: false, promoted: [], reason: 'cannot_shrink' }
    this.#capacity = size
    return { opened: true, promoted: this.#promote() }
  }

  /**
   * Admit one original attempt. It only becomes `running` while a slot is open; otherwise it waits in the
   * bounded queue. A second admit for the same attempt is a duplicate, not a second slot.
   */
  admit(candidate: SlotCandidate): SlotAdmitResult {
    if (!candidate.attemptId || !candidate.ticketId) return { state: 'refused', reason: 'empty_id' }
    const existing = this.#records.get(candidate.attemptId)
    if (existing && existing.state !== 'released') return { state: 'duplicate' }
    this.#leaseSeq += 1
    const lease = `slot-${this.#leaseSeq}`
    if (this.#occupied().length < this.#capacity) {
      this.#records.set(candidate.attemptId, { ...candidate, state: 'running', lease })
      return { state: 'running', lease }
    }
    if (this.#queue.length >= this.#maxQueued) return { state: 'refused', reason: 'queue_full' }
    this.#records.set(candidate.attemptId, { ...candidate, state: 'queued', lease })
    this.#queue.push(candidate.attemptId)
    return { state: 'queued', lease }
  }

  /**
   * Settle a slot from explicit physical evidence. `indeterminate` RETAINS the slot (unknown is not an
   * exit); only `confirmed` quiescence releases it and may promote the original queued work.
   */
  settle(attemptId: string, evidence: SlotSettleEvidence): SlotSettleResult {
    const record = this.#records.get(attemptId)
    if (!record || record.state === 'released') return { released: false, retained: false, promoted: [], reason: 'already_released' }
    if (record.state === 'queued') {
      // Cancelling a QUEUED attempt only needs confirmed quiescence (it never started): it leaves the queue
      // without claiming a running slot. An unknown queued cancel stays queued for the original scheduler.
      if (evidence !== 'confirmed') return { released: false, retained: true, promoted: [], reason: 'not_admitted' }
      const index = this.#queue.indexOf(attemptId)
      if (index >= 0) this.#queue.splice(index, 1)
      this.#records.set(attemptId, { ...record, state: 'released' })
      return { released: true, retained: false, promoted: [] }
    }
    if (evidence !== 'confirmed') {
      // The attempt keeps its reservation and material: nothing is released and nothing is promoted.
      this.#records.set(attemptId, { ...record, state: 'indeterminate' })
      return { released: false, retained: true, promoted: [], reason: 'unknown_evidence' }
    }
    this.#records.set(attemptId, { ...record, state: 'released' })
    return { released: true, retained: false, promoted: this.#promote() }
  }

  /** A cancellation follows the same rule as any stop: confirmed quiescence releases, unknown retains. */
  cancel(attemptId: string, evidence: SlotSettleEvidence): SlotSettleResult { return this.settle(attemptId, evidence) }

  markUnknown(attemptId: string): { retained: boolean; reason?: 'not_admitted' } {
    const record = this.#records.get(attemptId)
    if (!record || record.state !== 'running') return { retained: false, reason: 'not_admitted' }
    this.#records.set(attemptId, { ...record, state: 'indeterminate' })
    return { retained: true }
  }

  /**
   * Rebuild accounting from the ORIGINAL Store's binding states after a restart. `ended` releases its
   * slot, `active` is running (promoting queued work only up to capacity), `stopping` is retained as
   * indeterminate. A binding restored twice is not double-counted.
   */
  restore(bindings: readonly SlotRestoreBinding[]): { running: string[]; indeterminate: string[]; released: string[]; queued: string[] } {
    const seen = new Set<string>()
    for (const binding of bindings) {
      if (!binding.attemptId || seen.has(binding.attemptId)) continue
      seen.add(binding.attemptId)
      const state: SlotState = binding.state === 'ended' ? 'released' : binding.state === 'stopping' ? 'indeterminate' : 'running'
      this.#leaseSeq += 1
      this.#records.set(binding.attemptId, { attemptId: binding.attemptId, ticketId: binding.ticketId, state, lease: `slot-restored-${this.#leaseSeq}` })
      const index = this.#queue.indexOf(binding.attemptId)
      if (index >= 0) this.#queue.splice(index, 1)
    }
    // Over-capacity active bindings (a crashed predecessor opened more than the limit) stay running and
    // visible; no new work is admitted until the count drops below capacity.
    return {
      running: [...this.#records.values()].filter(record => record.state === 'running').map(record => record.attemptId),
      indeterminate: [...this.#records.values()].filter(record => record.state === 'indeterminate').map(record => record.attemptId),
      released: [...this.#records.values()].filter(record => record.state === 'released').map(record => record.attemptId),
      queued: [...this.#queue],
    }
  }

  #running(): SlotRecord[] { return [...this.#records.values()].filter(record => record.state === 'running') }
  /** An indeterminate stop retains its slot: it still occupies capacity until confirmed evidence. */
  #occupied(): SlotRecord[] { return [...this.#records.values()].filter(record => record.state === 'running' || record.state === 'indeterminate') }

  #promote(): string[] {
    const promoted: string[] = []
    while (this.#occupied().length < this.#capacity && this.#queue.length > 0) {
      const attemptId = this.#queue.shift()!
      const record = this.#records.get(attemptId)
      if (!record || record.state !== 'queued') continue
      this.#records.set(attemptId, { ...record, state: 'running' })
      promoted.push(attemptId)
    }
    return promoted
  }
}
