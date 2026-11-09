/** Generic artifact handling: immutable content-addressed references and candidate completeness. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { AttemptArtifactManifest } from '../src/artifact-manifest.ts'
import { parseRuntimeFactPayload } from '../../../packages/contracts/src/validation.ts'
import { makeFact } from '../../../packages/testing/src/index.ts'

const bytes = (text: string) => Buffer.from(text, 'utf8')

test('registering an artifact returns a stable reference and is idempotent', () => {
  const manifest = new AttemptArtifactManifest()
  const first = manifest.register({ path: 'src/a.ts', bytes: bytes('export const a = 1') })
  const again = manifest.register({ path: 'src/a.ts', bytes: bytes('export const a = 1') })
  assert.equal(first.ref, again.ref)
  assert.equal(manifest.size, 1)
})

test('the same path with different bytes is a different artifact', () => {
  const manifest = new AttemptArtifactManifest()
  const first = manifest.register({ path: 'src/a.ts', bytes: bytes('v1') })
  const second = manifest.register({ path: 'src/a.ts', bytes: bytes('v2') })
  assert.notEqual(first.ref, second.ref)
  assert.notEqual(first.digest, second.digest)
  assert.equal(manifest.size, 2)
})

test('references are content addressed and contract-legal ids', () => {
  const manifest = new AttemptArtifactManifest()
  const entry = manifest.register({ path: 'src/b.ts', bytes: bytes('content') })
  assert.match(entry.ref, /^artifact-[A-Za-z0-9._:-]{1,120}$/)
  assert.equal(entry.ref.includes(entry.digest.slice(0, 16)), true)
  assert.equal(entry.bytes, 7)
})

test('a full manifest refuses new artifacts instead of dropping produced ones', () => {
  const manifest = new AttemptArtifactManifest({ maxEntries: 1 })
  manifest.register({ path: 'a', bytes: bytes('1') })
  assert.throws(
    () => manifest.register({ path: 'b', bytes: bytes('2') }),
    error => (error as { reason?: string }).reason === 'artifact_manifest_full',
  )
  assert.equal(manifest.size, 1)
})

test('a candidate without artifacts is refused', () => {
  const manifest = new AttemptArtifactManifest()
  assert.throws(
    () => manifest.requireCandidateArtifacts(),
    error => (error as { reason?: string }).reason === 'candidate_without_artifacts',
  )
  manifest.register({ path: 'a', bytes: bytes('1') })
  assert.equal(manifest.requireCandidateArtifacts().length, 1)
})

test('a candidate payload built from the manifest passes the frozen runtime validator', () => {
  const manifest = new AttemptArtifactManifest()
  const entry = manifest.register({ path: 'src/a.ts', bytes: bytes('x') })
  const fact = makeFact('candidate.observed', 'payload-1', { factId: 'fact-c' })
  const artifactRefs = manifest.requireCandidateArtifacts()
  const parsed = parseRuntimeFactPayload(fact, {
    kind: 'candidate.observed',
    value: { artifactRefs, summaryRef: 'summary-1', evidenceRefs: ['e'] },
  })
  assert.deepEqual([...(parsed as unknown as { value: { artifactRefs: string[] } }).value.artifactRefs], [entry.ref])
})
