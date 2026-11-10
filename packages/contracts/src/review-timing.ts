import { z } from 'zod'
import { CandidateRefSchema, EvidenceRefSchema, IdSchema, TimestampSchema } from './schemas.ts'

/** Wall-clock waiting and visible/focused UI activity are different measurements, never substitutes for each other. */
export const ReviewTimingSchema = z.strictObject({
  candidateReadyAt: TimestampSchema.nullable(),
  acceptedAt: TimestampSchema.nullable(),
  readyToAcceptanceMs: z.number().int().nonnegative().safe().nullable(),
  activeReviewMs: z.number().int().nonnegative().safe().nullable(),
  activeReviewSource: z.enum(['ui_visibility_proxy', 'unknown']),
  activeReviewCompleteness: z.enum(['partial', 'unknown']),
  evidenceRefs: z.array(EvidenceRefSchema).max(128).readonly(),
}).superRefine((value, ctx) => {
  if (value.readyToAcceptanceMs !== null && (!value.candidateReadyAt || !value.acceptedAt ||
    Date.parse(value.acceptedAt) - Date.parse(value.candidateReadyAt) !== value.readyToAcceptanceMs))
    ctx.addIssue({ code: 'custom', message: 'Acceptance delay must match the recorded ready/accepted timestamps' })
  if ((value.activeReviewMs === null) !== (value.activeReviewSource === 'unknown') ||
    (value.activeReviewMs === null) !== (value.activeReviewCompleteness === 'unknown'))
    ctx.addIssue({ code: 'custom', message: 'Missing activity is unknown, never zero or fully measured human time' })
  if (value.activeReviewMs !== null && (value.readyToAcceptanceMs === null || value.activeReviewMs > value.readyToAcceptanceMs))
    ctx.addIssue({ code: 'custom', message: 'Active review proxy must fit inside the acceptance interval' })
})

export const ReviewActivitySchema = z.strictObject({
  protocol: z.literal('review-activity/1'), commandId: IdSchema, sessionId: IdSchema, candidate: CandidateRefSchema,
  startedAt: TimestampSchema, endedAt: TimestampSchema,
  source: z.literal('ui_visibility_proxy'),
}).refine(value => {
  const elapsed = Date.parse(value.endedAt) - Date.parse(value.startedAt)
  return elapsed > 0 && elapsed <= 15000
}, 'An activity span must be positive and no longer than 15 seconds')
export type ReviewTiming = z.infer<typeof ReviewTimingSchema>
export type ReviewActivity = z.infer<typeof ReviewActivitySchema>
