import { CandidateRefSchema, CommandReceiptSchema, ReviewActivitySchema, ReviewTimingSchema, TrustedActorSchema } from '@personal-agent/contracts'
import type { CandidateRef, CommandReceipt, ReviewActivity, ReviewTiming, TrustedActor } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { ApplicationFault } from '@personal-agent/application'
import type { ProductApplication } from '@personal-agent/application'
import type { ProductCompletion } from './completion.ts'

const identity = (value: CandidateRef) => canonicalDigest(CandidateRefSchema.parse(value))

/** UI visibility intervals are a partial activity proxy. Their union never measures actual thinking time. */
export function reviewTiming(readyAt: string | undefined, acceptedAt: string, spans: readonly ReviewActivity[], evidenceRefs: readonly string[]): ReviewTiming {
  const start = readyAt ? Date.parse(readyAt) : NaN, end = Date.parse(acceptedAt)
  const delay = Number.isFinite(start) && end >= start ? end - start : null
  const intervals = delay === null ? [] : spans.map(span => [Math.max(start, Date.parse(span.startedAt)), Math.min(end, Date.parse(span.endedAt))] as const)
    .filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0])
  let total = 0, until = start
  for (const [from, to] of intervals) { total += Math.max(0, to - Math.max(from, until)); until = Math.max(until, to) }
  return ReviewTimingSchema.parse({ candidateReadyAt: readyAt ?? null, acceptedAt, readyToAcceptanceMs: delay,
    activeReviewMs: intervals.length ? total : null, activeReviewSource: intervals.length ? 'ui_visibility_proxy' : 'unknown',
    activeReviewCompleteness: intervals.length ? 'partial' : 'unknown', evidenceRefs: evidenceRefs.slice(0, 128) })
}

/** Observational records share the command transaction; they never grant acceptance or trigger native work. */
export class ProductReviewTiming {
  private readonly store: ProductStore
  private readonly application: ProductApplication
  private readonly completion: ProductCompletion
  private readonly principal: { userId: string; authorityRef: string }
  private readonly projects: () => readonly string[]
  private readonly now: () => string
  constructor(store: ProductStore, application: ProductApplication, completion: ProductCompletion,
    principal: { userId: string; authorityRef: string }, projects: () => readonly string[], now = () => new Date().toISOString()) {
    this.store = store; this.application = application; this.completion = completion
    this.principal = structuredClone(principal); this.projects = projects; this.now = now
  }
  record(input: ReviewActivity, inputActor: TrustedActor): CommandReceipt {
    const value = ReviewActivitySchema.parse(input), actor = TrustedActorSchema.parse(inputActor)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source !== 'local_ui')
      throw new ApplicationFault('forbidden', 'Review activity requires the authenticated local UI', 'none')
    const digest = canonicalDigest(JSON.parse(JSON.stringify({ value, actor })))
    return this.store.uow.atomic(() => {
      const prior = this.store.commands.get(value.commandId)
      if (prior) {
        if (prior.payloadDigest !== digest) throw new ApplicationFault('conflict', 'Activity ID already names another sample')
        return CommandReceiptSchema.parse({ ...(prior.result as object), commandId: value.commandId, seq: prior.seq })
      }
      const work = this.store.product.works.get(value.candidate.contract.workId)
      if (!work || !this.projects().includes(work.projectId)) throw new ApplicationFault('forbidden', 'Review subject is not configured', 'none')
      let current: CandidateRef | undefined
      try { current = this.application.core.completionCandidate(value.candidate.ticketId) } catch {}
      if (!current || identity(current) !== identity(value.candidate) || !this.completion.current(current))
        throw new ApplicationFault('stale_candidate', 'Review activity refers to a stale or unverified candidate')
      const now = Date.parse(this.now()), endedAt = Date.parse(value.endedAt)
      if (endedAt > now + 2000 || now - endedAt > 30000)
        throw new ApplicationFault('invalid_request', 'Review activity clock or delivery is outside the bounded observation window')
      this.store.events.append({ topic: 'application.review.activity', entityRef: work.id, payload: value })
      const receipt = this.store.commands.record(value.commandId, digest, () => ({ status: 'recorded' as const, workId: work.id }))
      return CommandReceiptSchema.parse({ ...receipt.result, commandId: value.commandId, seq: receipt.seq })
    })
  }
  accepted(candidate: CandidateRef, actor: TrustedActor, acceptedAt: string): void {
    const metadata = this.completion.metadata(candidate), spans: ReviewActivity[] = []
    const evidenceRefs: string[] = metadata ? [metadata.verificationId] : []
    // Bounded scan from this candidate's verification receipt; A can later index this projection without changing the signal.
    if (metadata) for (const event of this.store.events.after(metadata.eventCursor, 5000)) {
      if (event.topic !== 'application.review.activity' || event.entityRef !== candidate.contract.workId) continue
      const parsed = ReviewActivitySchema.safeParse(event.payload)
      if (parsed.success && identity(parsed.data.candidate) === identity(candidate)) {
        spans.push(parsed.data); if (evidenceRefs.length < 128) evidenceRefs.push(`review-activity:${event.seq}`)
      }
    }
    this.store.events.append({ topic: 'application.candidate.accepted', entityRef: candidate.contract.workId,
      payload: { candidate, actorRef: actor.authorityRef, reviewTiming: reviewTiming(metadata?.readyAt, acceptedAt, spans, evidenceRefs) } })
  }
}
