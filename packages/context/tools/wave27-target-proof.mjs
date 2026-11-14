#!/usr/bin/env node
/**
 * Wave-27 target proof. It uses A's official content/restore verification (workflow-content/2 plus
 * the restore report) with independent snapshot/content/artifact expectations, then compares the
 * target A manifest with the original subject.
 *
 * There is no family-name allow-list here. Only `subject.dataRoot` may differ; an appended business
 * event (for example work.accepted), a legal user message or replaced artifact bytes changes the
 * content digest and is rejected. Root-local runtime tables are omitted only by A's explicit,
 * versioned content proof, not by a C policy.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: {
  'a-worktree': { type: 'string' }, 'a-module': { type: 'string' }, 'target-state': { type: 'string' },
  expectation: { type: 'string' }, manifest: { type: 'string' }, 'source-state-root': { type: 'string' },
  protocol: { type: 'string' }, 'snapshot-digest': { type: 'string' }, 'content-digest': { type: 'string' },
  artifacts: { type: 'string' }, 'a-head': { type: 'string' },
} })
const absolute = (name) => {
  const value = values[name]
  if (!value || !isAbsolute(value)) throw new Error(`--${name} must be an absolute path`)
  return resolve(value)
}
const aWorktree = absolute('a-worktree'), aModule = absolute('a-module'), targetState = absolute('target-state')
const expectationPath = absolute('expectation'), manifestPath = absolute('manifest')
const sourceStateRoot = absolute('source-state-root')
const protocol = values.protocol, snapshotDigest = values['snapshot-digest'], contentDigest = values['content-digest']
if (!['workflow-snapshot/1', 'workflow-snapshot/2'].includes(protocol ?? '')) throw new Error('--protocol must be workflow-snapshot/1 or /2')
if (!/^[a-f0-9]{64}$/.test(snapshotDigest ?? '')) throw new Error('--snapshot-digest must be 64 hex')
if (!/^[a-f0-9]{64}$/.test(contentDigest ?? '')) throw new Error('--content-digest must be 64 hex')
const artifacts = values.artifacts ? JSON.parse(readFileSync(absolute('artifacts'), 'utf8')) : undefined
if (artifacts !== undefined && !Array.isArray(artifacts)) throw new Error('--artifacts must contain an array')

const moduleSha = createHash('sha256').update(readFileSync(aModule)).digest('hex')
const { ProductStore } = await import(pathToFileURL(resolve(aWorktree, 'packages/storage/dist/index.js')).href)
const { buildDataManifest } = await import(pathToFileURL(aModule).href)
const { verifyRestoredSnapshot } = await import(pathToFileURL(resolve(aWorktree, 'packages/workflows/src/restore.ts')).href)
const original = JSON.parse(readFileSync(manifestPath, 'utf8'))
const expectation = JSON.parse(readFileSync(expectationPath, 'utf8'))
const verification = verifyRestoredSnapshot(targetState, { sourceStateRoot, protocol, snapshotDigest, contentDigest, ...(artifacts ? { artifacts } : {}) })
const mismatches = []
const compare = (name, expected, actual) => { if (JSON.stringify(expected) !== JSON.stringify(actual)) mismatches.push(name) }
let target = null
if (verification.status === 'ok') {
  const store = new ProductStore({ path: resolve(targetState, 'state.sqlite') })
  try {
    target = await buildDataManifest(store, { ...expectation, dataRoot: resolve(targetState) })
    compare('protocol', original.protocol, target.protocol)
    compare('sourceSha', original.subject.sourceSha, target.subject.sourceSha)
    compare('snapshotFormat', original.subject.snapshotFormat, target.subject.snapshotFormat)
    compare('ticketId', original.subject.ticketId, target.subject.ticketId)
    compare('assignmentId', original.subject.assignmentId, target.subject.assignmentId)
    compare('attemptId', original.subject.attemptId, target.subject.attemptId)
    compare('fenceEpoch', original.subject.fenceEpoch, target.subject.fenceEpoch)
    compare('contract', original.subject.contract, target.subject.contract)
    compare('targetDataRoot', resolve(targetState), target.subject.dataRoot)
    for (const field of ['binding', 'currentAttemptId', 'question', 'answer', 'deliveries', 'commands', 'dispatch', 'observations', 'requirements', 'coverage', 'limits', 'counts']) {
      compare(field, original[field], target[field])
    }
  } finally { store.close() }
} else mismatches.push('restoreVerification')
const basis = verification.basis
const artifactCoverage = verification.artifactCoverage
if (verification.status === 'ok' && (basis !== 'independent' || artifactCoverage !== 'independent')) mismatches.push('independentBasis')
const result = {
  protocol: 'wave27-target-subject-proof/1',
  status: mismatches.length === 0 ? 'ok' : 'mismatch',
  subjectMatches: mismatches.length === 0,
  pid: process.pid, aModuleSha256: moduleSha, aHead: values['a-head'] ?? null,
  targetState, sourceStateRoot, originalManifest: manifestPath,
  allowed: ['subject.dataRoot'],
  verification: {
    status: verification.status, basis, artifactCoverage,
    message: verification.message ?? null,
    content: verification.content === null ? null : {
      protocol: verification.content.protocol, digest: verification.content.digest, complete: verification.content.complete,
      rows: verification.content.rows, bytes: verification.content.bytes, omittedTables: verification.content.omittedTables,
    },
    report: verification.report === null ? null : {
      protocol: verification.report.protocol, snapshot: verification.report.snapshot,
      rootMapping: verification.report.rootMapping, contentDigest: verification.report.content.digest,
      artifacts: verification.report.artifacts.length,
    },
  },
  expected: { protocol, snapshotDigest, contentDigest, artifacts: artifacts?.length ?? null },
  counts: target?.counts ?? null,
  mismatches,
}
process.stdout.write(JSON.stringify(result) + '\n')
if (result.status !== 'ok') process.exitCode = 1
