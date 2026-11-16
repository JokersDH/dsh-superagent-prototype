#!/usr/bin/env node
/**
 * Successor history consumer: combines A's per-ticket source coverage/limits with a local window
 * instead of reporting a truncated source slice as complete. A owns review classification and the
 * source caps; this wrapper only propagates their coverage, applies a bounded local window, and
 * separates historical truth from current eligibility. ProductCompletion remains the only
 * current/preflight/accept authority; nothing here writes or grants.
 */
import { isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { composeHistoryWindow } from './history-coverage.mjs'

const { values } = parseArgs({ options: {
  'a-worktree': { type: 'string' }, db: { type: 'string' }, work: { type: 'string' }, project: { type: 'string' },
  limit: { type: 'string' }, offset: { type: 'string' },
} })
const absolute = (name) => { const value = values[name]; if (!value || !isAbsolute(value)) throw new Error(`--${name} must be absolute`); return resolve(value) }
const number = (name, fallback) => {
  if (values[name] === undefined) return fallback
  const parsed = Number(values[name])
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`)
  return parsed
}
const limit = number('limit', 64), offset = number('offset', 0)
const aWorktree = absolute('a-worktree'), database = absolute('db')
const workId = values.work, projectId = values.project
if (!workId || !projectId) throw new Error('--work and --project are required')
const storage = await import(pathToFileURL(resolve(aWorktree, 'packages/storage/src/index.ts')).href)
const store = new storage.ProductStore({ path: database })
try {
  const entry = store.workflows.index.work(workId, [projectId])
  if (!entry) {
    process.stdout.write(JSON.stringify({ status: 'missing', protocol: 'wave31-completion-history/1', workId, projectId }) + '\n')
    process.exitCode = 1
  } else {
    const completion = entry.completion
    const sourceCoverage = completion.coverage ?? { reviews: 'unknown', verifications: 'unknown', acceptances: 'unknown' }
    const sourceLimits = completion.limits ?? { perTicket: null }
    const reviews = completion.reviews.map((review) => ({
      commandId: review.commandId, payloadDigest: review.payloadDigest, seq: review.seq, recordedAt: review.recordedAt,
      proposal: review.proposal, verification: review.verification, artifactIds: [...review.artifactIds], attemptId: review.attemptId,
      bindingState: review.bindingState, currentLink: review.currentLink,
      canonical: review.commandId === storage.productReviewCommandId(review.proposal),
    }))
    const page = reviews.slice(offset, offset + limit)
    const coverage = {
      reviews: composeHistoryWindow({ sourceState: sourceCoverage.reviews, total: reviews.length, offset, limit }),
      // Unclassified entries are derived from the same capped verification scan.
      unclassifiedReviews: composeHistoryWindow({ sourceState: sourceCoverage.verifications, total: completion.unclassifiedReviews.length, offset: 0, limit: completion.unclassifiedReviews.length }),
      verifications: composeHistoryWindow({ sourceState: sourceCoverage.verifications, total: completion.verifications.length, offset: 0, limit: completion.verifications.length }),
      acceptances: composeHistoryWindow({ sourceState: sourceCoverage.acceptances, total: completion.acceptances.length, offset: 0, limit: completion.acceptances.length }),
    }
    const windowOffsetBackwards = offset > 0 && offset >= reviews.length
    process.stdout.write(JSON.stringify({
      status: 'ok', protocol: 'wave31-completion-history/1', pid: process.pid, workId, projectId,
      contract: entry.contract, authorityState: entry.authorityState,
      classification: 'A: per-ticket capped completion scan; binding per attempt; canonical command identity',
      currentEligibility: 'delegated_to_ProductCompletion',
      completion: {
        reviews: page.map((review) => ({
          ...review, historical: true,
          currentEligibility: review.canonical && review.currentLink === 'current_attempt' ? 'candidate_for_current' : 'historical_only',
        })),
        unclassifiedReviews: completion.unclassifiedReviews,
        verifications: completion.verifications, acceptances: completion.acceptances,
      },
      coverage,
      source: { coverage: sourceCoverage, limits: sourceLimits },
      window: { offset, limit, returned: coverage.reviews.returned, totalKnown: coverage.reviews.complete && coverage.reviews.availableKnown, ...(coverage.reviews.nextOffset === undefined ? {} : { nextOffset: coverage.reviews.nextOffset }) },
      limits: ['A caps each ticket at 50 verifications/acceptances; coverage.reviews reflects that cap',
        'local window is applied to the source slice; truncated_source cannot be widened by paging',
        'read-only; no event/model/acceptance increment'],
      authorization: 'none',
      ...(windowOffsetBackwards ? { note: 'offset is beyond the source slice; empty page is not proof of no history' } : {}),
    }) + '\n')
  }
} finally { store.close() }
