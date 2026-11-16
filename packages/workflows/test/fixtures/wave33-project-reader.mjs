/** Wave-33 A: a different Node PID reads original Work, receipts and artifact bytes after reopen. */
import { readFileSync } from 'node:fs'
import { ProductStore } from '../../../../packages/storage/dist/index.js'
const [databasePath, workId, projectId, createId, acceptId] = process.argv.slice(2)
if (!databasePath || !workId || !projectId || !createId || !acceptId) throw new Error('Usage: wave33-project-reader.mjs <db> <work> <project> <create> <accept>')
const store = new ProductStore({ path: databasePath })
try {
  const entry = store.workflows.index.work(workId, [projectId])
  if (!entry) throw new Error('work missing')
  const review = entry.completion.reviews[0]
  if (!review) throw new Error('review missing')
  const artifacts = review.artifactIds.map(id => { const value = store.artifacts.read(id); if (!value) throw new Error(`artifact missing ${id}`);
    return { id, bytes: value.record.bytes, digest: value.record.digest, sha256: value.data.byteLength } })
  console.log(JSON.stringify({ pid: process.pid, workId, projectId, contractDigest: entry.contract?.digest ?? null,
    review: { commandId: review.commandId, attemptId: review.attemptId, bindingState: review.bindingState, currentLink: review.currentLink,
      artifactDigest: review.proposal.artifactDigest }, receipts: { create: store.commands.get(createId)?.status ?? null, accept: store.commands.get(acceptId)?.status ?? null },
    artifacts }))
} finally { store.close() }
