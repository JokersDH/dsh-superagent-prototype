#!/usr/bin/env node
/** Read A's strict completion facts (reviews/unclassified/verifications/acceptances) from one DB. */
import { isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: { 'a-worktree': { type: 'string' }, db: { type: 'string' }, work: { type: 'string' }, project: { type: 'string' } } })
const absolute = (name) => { const value = values[name]; if (!value || !isAbsolute(value)) throw new Error(`--${name} must be absolute`); return resolve(value) }
const aWorktree = absolute('a-worktree'), database = absolute('db')
const workId = values.work, projectId = values.project
if (!workId || !projectId) throw new Error('--work and --project are required')
const storage = await import(pathToFileURL(resolve(aWorktree, 'packages/storage/src/index.ts')).href)
const store = new storage.ProductStore({ path: database })
try {
  const entry = store.workflows.index.work(workId, [projectId])
  if (!entry) { process.stdout.write(JSON.stringify({ status: 'missing', workId, projectId }) + '\n'); process.exitCode = 1 }
  else {
    const completion = entry.completion
    const reviews = completion.reviews.map((review) => ({ ...review,
      canonical: review.commandId === storage.productReviewCommandId(review.proposal) }))
    process.stdout.write(JSON.stringify({ status: 'ok', protocol: 'wave29-completion-facts/1', pid: process.pid,
      workId, projectId, contract: entry.contract, authorityState: entry.authorityState,
      completion: { reviews, unclassifiedReviews: completion.unclassifiedReviews,
        verifications: completion.verifications, acceptances: completion.acceptances } }) + '\n')
  }
} finally { store.close() }
