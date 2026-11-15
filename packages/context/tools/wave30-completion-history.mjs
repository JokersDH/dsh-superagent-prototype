#!/usr/bin/env node
/**
 * Read A's strict completion history/current facts from one existing Store. A owns the review
 * classification (per-attempt historical binding + canonical command identity); this wrapper only
 * passes its facts through with explicit coverage and separates historical truth from current
 * eligibility. It never writes, never creates a candidate table and never claims acceptance or
 * execution authority — ProductCompletion.metadata/current/preflight/accept stay authoritative.
 */
import { isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: {
  'a-worktree': { type: 'string' }, db: { type: 'string' }, work: { type: 'string' }, project: { type: 'string' },
  limit: { type: 'string' },
} })
const absolute = (name) => { const value = values[name]; if (!value || !isAbsolute(value)) throw new Error(`--${name} must be absolute`); return resolve(value) }
const limit = values.limit === undefined ? 64 : Number(values.limit)
if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit must be a non-negative integer')
const aWorktree = absolute('a-worktree'), database = absolute('db')
const workId = values.work, projectId = values.project
if (!workId || !projectId) throw new Error('--work and --project are required')
const storage = await import(pathToFileURL(resolve(aWorktree, 'packages/storage/src/index.ts')).href)
const store = new storage.ProductStore({ path: database })
try {
  const entry = store.workflows.index.work(workId, [projectId])
  if (!entry) {
    process.stdout.write(JSON.stringify({ status: 'missing', protocol: 'wave30-completion-history/1', workId, projectId }) + '\n')
    process.exitCode = 1
  } else {
    const completion = entry.completion
    const all = completion.reviews.map((review) => ({
      commandId: review.commandId, payloadDigest: review.payloadDigest, seq: review.seq, recordedAt: review.recordedAt,
      proposal: review.proposal, verification: review.verification, artifactIds: [...review.artifactIds], attemptId: review.attemptId,
      bindingState: review.bindingState, currentLink: review.currentLink,
      canonical: review.commandId === storage.productReviewCommandId(review.proposal),
    }))
    const reviews = all.slice(0, limit)
    const truncated = all.length > reviews.length
    process.stdout.write(JSON.stringify({
      status: 'ok', protocol: 'wave30-completion-history/1', pid: process.pid, workId, projectId,
      contract: entry.contract, authorityState: entry.authorityState,
      classification: 'A: reviews derive from completion_verifications; binding resolved per attempt; canonical command identity; binding state is execution history, not current eligibility',
      currentEligibility: 'delegated_to_ProductCompletion',
      completion: {
        reviews: reviews.map((review) => ({
          ...review,
          historical: true,
          currentEligibility: review.canonical && review.currentLink === 'current_attempt' ? 'candidate_for_current' : 'historical_only',
        })),
        unclassifiedReviews: completion.unclassifiedReviews,
        verifications: completion.verifications, acceptances: completion.acceptances,
      },
      coverage: {
        reviews: { state: truncated ? 'bounded' : 'complete', returned: reviews.length, available: all.length, limit, truncated },
        unclassifiedReviews: { state: 'complete_known', returned: completion.unclassifiedReviews.length },
        verifications: { state: 'complete_known', returned: completion.verifications.length },
        acceptances: { state: 'complete_known', returned: completion.acceptances.length },
      },
      limits: ['no pagination cursor beyond --limit', 'unclassified entries carry no proposal body', 'read-only; no event/model/acceptance increment'],
      authorization: 'none',
    }) + '\n')
  }
} finally { store.close() }
