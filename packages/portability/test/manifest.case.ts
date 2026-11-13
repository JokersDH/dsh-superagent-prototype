/** Bundle manifest validation fails closed on shape, version, unsafe paths and semantic drift. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  PortabilityError,
  assertSafeEntryPath,
  canonicalJson,
  manifestDigest,
  validateManifest,
  type BackupManifest,
} from '../src/index.ts'

const sha = 'a'.repeat(64)
const valid = (): BackupManifest => ({
  format: BUNDLE_FORMAT,
  formatVersion: BUNDLE_FORMAT_VERSION,
  createdAt: '2026-11-10T04:00:00.000Z',
  producer: {
    product: 'dsh-superagent',
    version: '0.1.0',
    node: '24.21.0',
    sqlite: '3.53.4',
    platform: 'darwin',
    arch: 'arm64',
    tool: 'pa-backup',
  },
  source: { stateName: 'workbench', instanceRunning: true, access: 'local-development' },
  selection: { database: true, artifacts: true, config: ['config/native-projects.json'], excluded: [{ path: 'api.key', reason: 'credential' }], includeProjectContent: false },
  pathMap: [{ role: 'project', original: '/Users/example/repo', note: 'rebind on restore' }],
  entries: [
    { path: 'artifacts/abc', bytes: 10, sha256: sha, kind: 'artifact' },
    { path: 'config/native-projects.json', bytes: 20, sha256: sha, kind: 'config' },
    { path: 'state/state.sqlite', bytes: 30, sha256: sha, kind: 'database' },
  ],
  artifactRefs: [{ id: sha, digest: sha, bytes: 10, entry: 'artifacts/abc' }],
  database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 6, snapshotBytes: 30, eventSeq: 12, writerClaim: null },
  counts: { entries: 3, artifacts: 1, excluded: 1 },
  limitations: ['native sessions and credentials are not included'],
})

test('a complete manifest round-trips through canonical JSON and validation', () => {
  const manifest = valid()
  const parsed = validateManifest(JSON.parse(canonicalJson(manifest)))
  assert.deepEqual(parsed, manifest)
  assert.equal(manifestDigest(parsed), manifestDigest(validateManifest(valid())))
  assert.equal(canonicalJson({ b: 1, a: [2, 3] }), '{"a":[2,3],"b":1}')
})

test('another format version is refused with a distinct code', () => {
  assert.throws(
    () => validateManifest({ ...valid(), formatVersion: 2 }),
    (error) => error instanceof PortabilityError && error.code === 'manifest_version_unsupported',
  )
  assert.throws(
    () => validateManifest({ ...valid(), format: 'other' }),
    (error) => error instanceof PortabilityError && error.code === 'manifest_invalid',
  )
})

test('unsafe member paths are refused by the validator and the standalone check', () => {
  for (const path of ['/etc/passwd', '../escape', 'a/../../b', 'a\\b', 'a//b', 'a/./b', 'C:/win', `x/${'y'.repeat(120)}`]) {
    assert.throws(() => assertSafeEntryPath(path), (error) => error instanceof PortabilityError && error.code === 'archive_unsafe_path', path)
  }
  for (const path of ['state/state.sqlite', 'artifacts/' + 'a'.repeat(64), 'config/native-projects.json']) {
    assert.equal(assertSafeEntryPath(path), path)
  }
})

test('duplicate entries and artifact references to missing entries are refused', () => {
  const duplicate = valid()
  const withDuplicate = {
    ...duplicate,
    entries: [...duplicate.entries, { path: 'state/state.sqlite', bytes: 30, sha256: sha, kind: 'database' }],
    counts: { ...duplicate.counts, entries: 4 },
  }
  assert.throws(
    () => validateManifest(withDuplicate),
    (error) => error instanceof PortabilityError && error.code === 'archive_duplicate_entry',
  )
  const badRef = {
    ...valid(),
    artifactRefs: [{ id: sha, digest: sha, bytes: 10, entry: 'artifacts/not-listed' }],
  }
  assert.throws(() => validateManifest(badRef), (error) => error instanceof PortabilityError && error.code === 'manifest_invalid')
})

test('counts, digest shapes, credential copy and project content are validations, not warnings', () => {
  assert.throws(() => validateManifest({ ...valid(), counts: { entries: 4, artifacts: 1, excluded: 1 } }))
  const badDigest = valid()
  assert.throws(
    () => validateManifest({ ...badDigest, entries: [{ ...badDigest.entries[0], sha256: 'not-a-digest' }, ...badDigest.entries.slice(1)] }),
  )
  assert.throws(() => validateManifest({ ...valid(), selection: { ...valid().selection, includeProjectContent: true } }))
  const pathStateName = valid()
  assert.throws(
    () => validateManifest({ ...pathStateName, source: { ...pathStateName.source, stateName: '/Users/example/state' } }),
  )
})
