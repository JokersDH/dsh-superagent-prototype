#!/usr/bin/env node
/** Read a restored bundle's original Work/accepted event and artifact bytes without starting the product. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
const { values } = parseArgs({ options: { state: { type: 'string' }, recipe: { type: 'string' } } })
if (!values.state || !values.recipe) throw new Error('usage: verify-wave33-restore.mjs --state <restored-state> --recipe <recipe.json>')
const recipe = JSON.parse(readFileSync(values.recipe, 'utf8')); let report = null; try { report = JSON.parse(readFileSync(join(values.state, 'restore-report.json'), 'utf8')) } catch {}
const store = new ProductStore({ path: join(values.state, 'state.sqlite') })
try {
  const work = store.product.works.get(recipe.workId)
  if (!work) throw new Error('restored original Work missing')
  const accepted = store.events.after(0, 10000).filter(e => e.topic === 'application.candidate.accepted' && e.entityRef === recipe.workId)
  if (accepted.length !== 1) throw new Error(`accepted event count ${accepted.length}`)
  const contractCount = Number(store.db.prepare('SELECT count(*) AS n FROM contract_revisions WHERE work_id = ?').get(recipe.workId)?.n ?? 0)
  const acceptanceCount = Number(store.db.prepare('SELECT count(*) AS n FROM completion_acceptances').get()?.n ?? 0)
  if (contractCount < 1 || acceptanceCount < 1) throw new Error(`contracts/acceptances missing ${contractCount}/${acceptanceCount}`)
  const artifacts = []
  for (const expected of recipe.artifacts) {
    const record = store.artifacts.get(expected.id)
    if (!record) throw new Error(`artifact missing ${expected.id}`)
    const bytes = readFileSync(record.absolutePath), digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== expected.sha256 || bytes.length !== expected.bytes) throw new Error(`artifact bytes mismatch ${expected.id}`)
    artifacts.push({ id: record.id, bytes: bytes.length, sha256: digest })
  }
  const result = { protocol: 'wave33-restore-read/1', status: 'PASS', target: report?.targetPath ?? values.state, sourceState: '/tmp/w33-nonempty/state', workId: work.id,
    workProjectId: work.projectId, acceptedEventSeq: accepted[0].seq, artifactCount: artifacts.length, artifacts, contractCount, acceptanceCount,
    restore: report ? { protocol: report.protocol, eventSeq: report.database.eventSeq, schema: report.database.productSchema, integrity: report.database.integrity, evidence: report.evidence.status } : null,
    started: false, businessActions: 0, realVendorTurns: 0, realModelTurns: 0, realNativeTurns: 0 }
  console.log(JSON.stringify(result, null, 2))
} finally { store.close() }
