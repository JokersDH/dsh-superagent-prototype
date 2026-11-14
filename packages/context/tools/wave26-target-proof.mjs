#!/usr/bin/env node
/**
 * Verify that a restored target database still carries exactly the original A subject.
 *
 * Allowed transformations are versioned and explicit:
 *  - subject.dataRoot becomes the new restore root;
 *  - the operational families `event_log`, `coordinator_instances` and `writer_claim` may change
 *    from read-only service startup/audit, and only when every business family still matches.
 *
 * Any business family change (for example an added user message), a different subject/content set
 * or a non-allowed fingerprint delta is rejected. A's verifyRestoredSnapshot only checks DB
 * integrity/schema, so this is a C-side consumer proof, not a producer or authorization.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: {
  'a-worktree': { type: 'string' }, 'a-module': { type: 'string' }, db: { type: 'string' }, expectation: { type: 'string' },
  manifest: { type: 'string' }, report: { type: 'string' }, 'a-head': { type: 'string' },
} })
const absolute = (name) => {
  const value = values[name]
  if (!value || !isAbsolute(value)) throw new Error(`--${name} must be an absolute path`)
  return resolve(value)
}
const aWorktree = absolute('a-worktree'), aModule = absolute('a-module'), database = absolute('db')
const expectationPath = absolute('expectation'), manifestPath = absolute('manifest')
const reportPath = values.report ? resolve(values.report) : null
const moduleSha = createHash('sha256').update(readFileSync(aModule)).digest('hex')
const { ProductStore } = await import(pathToFileURL(resolve(aWorktree, 'packages/storage/dist/index.js')).href)
const { buildDataManifest } = await import(pathToFileURL(aModule).href)
const original = JSON.parse(readFileSync(manifestPath, 'utf8'))
const expectation = JSON.parse(readFileSync(expectationPath, 'utf8'))
const targetRoot = dirname(database)
const originalRoot = resolve(expectation.dataRoot)
const originalDatabase = join(originalRoot, 'state.sqlite')
const ALLOWED_FAMILIES = new Set(['event_log', 'coordinator_instances', 'writer_claim'])
const mismatches = []
const compare = (name, expected, actual) => { if (JSON.stringify(expected) !== JSON.stringify(actual)) mismatches.push(name) }

const store = new ProductStore({ path: database })
const originalStore = new ProductStore({ path: originalDatabase })
let familyChanges = []
try {
  const target = await buildDataManifest(store, { ...expectation, dataRoot: targetRoot })
  compare('protocol', original.protocol, target.protocol)
  compare('sourceSha', original.subject.sourceSha, target.subject.sourceSha)
  compare('snapshotFormat', original.subject.snapshotFormat, target.subject.snapshotFormat)
  compare('ticketId', original.subject.ticketId, target.subject.ticketId)
  compare('assignmentId', original.subject.assignmentId, target.subject.assignmentId)
  compare('attemptId', original.subject.attemptId, target.subject.attemptId)
  compare('fenceEpoch', original.subject.fenceEpoch, target.subject.fenceEpoch)
  compare('contract', original.subject.contract, target.subject.contract)
  compare('targetDataRoot', targetRoot, target.subject.dataRoot)
  for (const field of ['binding', 'currentAttemptId', 'question', 'answer', 'deliveries', 'commands', 'dispatch', 'observations', 'requirements', 'coverage', 'limits', 'counts']) {
    compare(field, original[field], target[field])
  }

  const originalSource = originalStore.workflows.recoverySource.inspect()
  const targetSource = store.workflows.recoverySource.inspect()
  if (originalSource.coverage !== 'complete' || targetSource.coverage !== 'complete') mismatches.push('sourceCoverage')
  const originalFamilies = new Map((originalSource.families ?? []).map((family) => [family.name, family]))
  const targetFamilies = new Map((targetSource.families ?? []).map((family) => [family.name, family]))
  for (const name of new Set([...originalFamilies.keys(), ...targetFamilies.keys()])) {
    const left = originalFamilies.get(name), right = targetFamilies.get(name)
    if (left?.rows === right?.rows && left?.digest === right?.digest && left?.truncated === right?.truncated) continue
    familyChanges.push({ name, allowed: ALLOWED_FAMILIES.has(name), originalRows: left?.rows ?? null, targetRows: right?.rows ?? null })
  }
  const forbiddenFamilyChanges = familyChanges.filter((change) => !change.allowed).map((change) => change.name)
  const fingerprintMatches = target.sourceFingerprint === original.sourceFingerprint
  if (forbiddenFamilyChanges.length > 0) mismatches.push('sourceFingerprint')

  // Artifact identity is bytes, not only DB metadata: compare the set and re-hash every target file.
  const artifactList = (productStore) => {
    const records = []
    let before
    for (let page = 0; page < 16; page += 1) {
      const result = productStore.artifacts.list({ limit: 512, ...(before ? { before } : {}) })
      records.push(...result.artifacts.map((artifact) => ({ id: artifact.id, digest: artifact.digest, bytes: artifact.bytes })))
      if (!result.hasMore || !result.nextCursor) break
      before = result.nextCursor
    }
    return records.sort((left, right) => left.id.localeCompare(right.id))
  }
  let artifactBytesVerified = 0
  const originalArtifacts = artifactList(originalStore)
  const targetArtifacts = artifactList(store)
  compare('artifacts', originalArtifacts, targetArtifacts)
  for (const artifact of targetArtifacts) {
    const file = store.artifacts.get(artifact.id)?.absolutePath
    if (!file || !existsSync(file)) { mismatches.push(`artifact_missing:${artifact.id}`); continue }
    const stat = statSync(file)
    if (stat.size !== artifact.bytes || stat.size > 2 * 1024 * 1024) { mismatches.push(`artifact_size:${artifact.id}`); continue }
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (digest !== artifact.digest) mismatches.push(`artifact_bytes:${artifact.id}`)
    else artifactBytesVerified += 1
  }
  const report = reportPath ? JSON.parse(readFileSync(reportPath, 'utf8')) : null
  const reportOk = report === null ? null : report.protocol === 'personal-restore/1'
  const result = {
    protocol: 'wave26-target-subject-proof/1',
    status: mismatches.length === 0 && reportOk !== false ? 'ok' : 'mismatch',
    subjectMatches: mismatches.length === 0,
    pid: process.pid, aModuleSha256: moduleSha, aHead: values['a-head'] ?? null,
    database, targetRoot, originalRoot, originalManifest: manifestPath,
    allowed: ['subject.dataRoot', ...ALLOWED_FAMILIES],
    sourceFingerprint: target.sourceFingerprint, originalFingerprint: original.sourceFingerprint,
    fingerprintMatches,
    fingerprintRelation: fingerprintMatches ? 'exact' : forbiddenFamilyChanges.length === 0 ? 'allowed-operational-delta' : 'forbidden-delta',
    allowedFamilyChanges: familyChanges.filter((change) => change.allowed),
    forbiddenFamilyChanges: familyChanges.filter((change) => !change.allowed),
    counts: target.counts, artifacts: { total: targetArtifacts.length, bytesVerified: artifactBytesVerified }, mismatches,
    report: report === null ? null : { protocol: report.protocol ?? null, ok: reportOk, createdAt: report.createdAt ?? null },
  }
  process.stdout.write(JSON.stringify(result) + '\n')
  if (result.status !== 'ok') process.exitCode = 1
} finally {
  originalStore.close()
  store.close()
}
