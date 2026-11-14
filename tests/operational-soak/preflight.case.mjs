/**
 * Trial-kit preflight controls: complete positive fixtures, one-defect negatives, archive safety,
 * output privacy, and an explicit no-side-effect proof over the inspected input and a sentinel home.
 *
 * Run with: node --test tests/operational-soak/preflight.case.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { buildTinyInstall, cloneFixture, mutate, packFixture } from '../../tools/trial-kit/fixtures/build-fixtures.mjs'

const REPO = join(import.meta.dirname, '..', '..')
const CLI = join(REPO, 'tools/trial-kit/bin/trial-preflight.mjs')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function tempRoot(label) {
  return mkdtempSync(join(tmpdir(), `trial-kit-${label}-`))
}

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 300_000, env: { ...process.env, ...env } })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function reportFor(out) {
  return JSON.parse(readFileSync(join(out, 'preflight-report.json'), 'utf8'))
}

function snapshot(root) {
  const result = {}
  const visit = (absolute, rel) => {
    for (const name of readdirSync(absolute)) {
      const childAbsolute = join(absolute, name)
      const childRel = rel === '' ? name : `${rel}/${name}`
      const info = statSync(childAbsolute, { throwIfNoEntry: false })
      if (info === null) continue
      if (info.isDirectory()) { result[childRel] = { kind: 'dir', mtimeMs: info.mtimeMs }; visit(childAbsolute, childRel) }
      else if (info.isSymbolicLink()) result[childRel] = { kind: 'link', mtimeMs: info.mtimeMs }
      else result[childRel] = { kind: 'file', bytes: info.size, mtimeMs: info.mtimeMs, sha256: sha256(readFileSync(childAbsolute)) }
    }
  }
  visit(root, '')
  return result
}

function checkIds(report, status) {
  return report.checks.filter((entry) => entry.status === status).map((entry) => entry.id)
}

function validFixture(label) {
  const root = tempRoot(label)
  const fixture = buildTinyInstall(root)
  const artifact = packFixture(fixture, join(root, 'tiny.tar.gz'))
  const artifactPath = join(root, 'artifact.json')
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`)
  return { root, fixture, artifact, artifactPath, tarPath: join(root, 'tiny.tar.gz') }
}

test('valid tar and install inputs verify the complete closure', () => {
  const { root, artifact, artifactPath, tarPath, fixture } = validFixture('valid')
  try {
    const outTar = join(root, 'out-tar')
    const tarRun = runCli(['--tar', tarPath, '--artifact', artifactPath, '--out', outTar])
    assert.equal(tarRun.status, 1, tarRun.stderr)
    const tarReport = reportFor(outTar)
    assert.equal(tarReport.result, 'DEGRADED')
    assert.deepEqual(checkIds(tarReport, 'FAIL'), [])
    for (const id of ['file_digests', 'symlink_closure', 'closure_digest', 'artifact_manifest', 'release_artifacts', 'console_stamp', 'external_dependencies', 'input_immutability', 'extraction_cleanup'])
      assert.ok(checkIds(tarReport, 'PASS').includes(id), `expected PASS ${id}`)
    assert.equal(tarReport.observed.closureDigest, artifact.digests.closureDigest)
    assert.equal(tarReport.observed.archiveSha256, artifact.digests.tarSha256)
    assert.equal(tarReport.observed.fileCounts.files, 12)
    assert.equal(tarReport.observed.fileCounts.symlinks, 1)
    assert.equal(statSync(outTar).mode & 0o777, 0o700)
    assert.equal(statSync(join(outTar, 'preflight-report.json')).mode & 0o777, 0o600)

    const outInstall = join(root, 'out-install')
    const installRun = runCli(['--install', fixture.installRoot, '--out', outInstall])
    assert.equal(installRun.status, 1, installRun.stderr)
    const installReport = reportFor(outInstall)
    assert.deepEqual(checkIds(installReport, 'FAIL'), [])
    assert.equal(installReport.observed.closureDigest, artifact.digests.closureDigest)
    assert.equal(installReport.subject.kind, 'install')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('published tuple assertions pass and a wrong expectation refuses', () => {
  const { root, artifact, artifactPath, tarPath } = validFixture('tuple')
  try {
    const out = join(root, 'out-ok')
    const ok = runCli(['--tar', tarPath, '--artifact', artifactPath, '--out', out,
      '--expect-sha256', artifact.digests.tarSha256, '--expect-build', artifact.buildId, '--expect-schema', '18', '--expect-source', artifact.source.commit])
    assert.equal(ok.status, 1, ok.stderr)
    assert.ok(checkIds(reportFor(out), 'PASS').includes('expected_tuple'))

    const refusedOut = join(root, 'out-bad')
    const refused = runCli(['--tar', tarPath, '--out', refusedOut, '--expect-schema', '99'])
    assert.equal(refused.status, 2)
    const report = reportFor(refusedOut)
    assert.ok(checkIds(report, 'FAIL').includes('expected_tuple'))
    assert.equal(report.result, 'REFUSED')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('one-defect fixtures are refused with the intended check', () => {
  const cases = [
    ['bad-hash', 'file_digests'],
    ['extra-file', 'unlisted_entries'],
    ['missing-file', 'file_digests'],
    ['external-symlink', 'symlink_closure'],
    ['bad-json', 'install_manifest_format'],
    ['missing-dep', 'external_dependencies'],
    ['missing-release', 'release_manifest_present'],
    ['wrong-console-stamp', 'console_stamp'],
  ]
  for (const [variant, expectedCheck] of cases) {
    const base = validFixture(`neg-${variant}`)
    try {
      const root = tempRoot(`neg-${variant}-copy`)
      const fixture = cloneFixture(base.fixture, join(root, 'install-root'))
      mutate(fixture, variant)
      const out = join(root, 'out')
      const run = runCli(['--install', fixture.installRoot, '--out', out])
      assert.equal(run.status, 2, `${variant}: ${run.stderr}`)
      const report = reportFor(out)
      assert.equal(report.result, 'REFUSED', variant)
      assert.ok(checkIds(report, 'FAIL').includes(expectedCheck), `${variant}: expected FAIL ${expectedCheck}; got ${checkIds(report, 'FAIL')}`)
      rmSync(root, { recursive: true, force: true })
    } finally {
      rmSync(base.root, { recursive: true, force: true })
    }
  }
})

test('abi mismatch degrades instead of claiming compatibility', () => {
  const base = validFixture('abi')
  try {
    const root = tempRoot('abi-copy')
    const fixture = cloneFixture(base.fixture, join(root, 'install-root'))
    mutate(fixture, 'abi-mismatch')
    const out = join(root, 'out')
    const run = runCli(['--install', fixture.installRoot, '--out', out])
    assert.equal(run.status, 1, run.stderr)
    const report = reportFor(out)
    assert.ok(checkIds(report, 'WARN').includes('host_abi'))
    assert.equal(report.result, 'DEGRADED')
    assertEqualsNoClaim(report)
    rmSync(root, { recursive: true, force: true })
  } finally {
    rmSync(base.root, { recursive: true, force: true })
  }
})

function assertEqualsNoClaim(report) {
  // A compatibility observation must never be reported as a runnable/release claim.
  const serialized = JSON.stringify(report).toLowerCase()
  assert.ok(!serialized.includes('compatible":true'))
  assert.ok(!serialized.includes('release_approved'))
}

test('unsafe or unreadable archives are refused before extraction', () => {
  const base = validFixture('unsafe')
  try {
    const root = tempRoot('unsafe-out')
    const absoluteTar = join(root, 'absolute.tar.gz')
    const absoluteSource = join(root, 'absolute-source.txt')
    writeFileSync(absoluteSource, 'payload\n')
    const absolute = spawnSync('tar', ['-P', '-czf', absoluteTar, absoluteSource], { encoding: 'utf8' })
    assert.equal(absolute.status, 0, absolute.stderr)
    const outAbsolute = join(root, 'out-absolute')
    const runAbsolute = runCli(['--tar', absoluteTar, '--out', outAbsolute])
    assert.equal(runAbsolute.status, 2)
    assert.ok(checkIds(reportFor(outAbsolute), 'FAIL').includes('archive_listing'))

    const sub = join(root, 'sub')
    mkdirSync(sub)
    writeFileSync(join(root, 'up.txt'), 'up\n')
    const parentTar = join(root, 'parent.tar.gz')
    const parent = spawnSync('tar', ['-czf', parentTar, '../up.txt'], { cwd: sub, encoding: 'utf8' })
    assert.equal(parent.status, 0, parent.stderr)
    const outParent = join(root, 'out-parent')
    assert.equal(runCli(['--tar', parentTar, '--out', outParent]).status, 2)
    assert.ok(checkIds(reportFor(outParent), 'FAIL').includes('archive_listing'))

    const truncatedTar = join(root, 'truncated.tar.gz')
    writeFileSync(truncatedTar, readFileSync(base.tarPath).subarray(0, 120))
    const outTruncated = join(root, 'out-truncated')
    assert.equal(runCli(['--tar', truncatedTar, '--out', outTruncated]).status, 2)
    assert.ok(checkIds(reportFor(outTruncated), 'FAIL').includes('archive_listing'))
    rmSync(root, { recursive: true, force: true })
  } finally {
    rmSync(base.root, { recursive: true, force: true })
  }
})

test('preflight leaves the inspected input and the home directory untouched', () => {
  const { root, tarPath } = validFixture('side-effect')
  const fakeHome = join(root, 'home')
  mkdirSync(fakeHome, { mode: 0o700 })
  writeFileSync(join(fakeHome, 'sentinel.txt'), 'keep\n', { mode: 0o600 })
  const insideHomeTar = join(fakeHome, 'package.tar.gz')
  spawnSync('cp', [tarPath, insideHomeTar])
  const before = snapshot(root)
  const outParent = tempRoot('side-effect-out')
  try {
    const out = join(outParent, 'out')
    const run = runCli(['--tar', insideHomeTar, '--out', out], { HOME: fakeHome })
    assert.equal(run.status, 1, run.stderr)
    const report = reportFor(out)
    assert.equal(report.subject.path, '~/package.tar.gz', 'home prefix is redacted but remains reproducible')
    assert.ok(checkIds(report, 'PASS').includes('input_immutability'))
    assert.deepEqual(checkIds(report, 'FAIL'), [])
    const after = snapshot(root)
    assert.deepEqual(after, before, 'inspected input and home must be byte/mtime identical')
    assert.equal(readFileSync(join(fakeHome, 'sentinel.txt'), 'utf8'), 'keep\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outParent, { recursive: true, force: true })
  }
})

test('usage and root failures refuse without creating personal state', () => {
  const root = tempRoot('usage')
  try {
    const noInput = runCli(['--out', join(root, 'a')])
    assert.equal(noInput.status, 2)
    const bothInputs = runCli(['--tar', join(root, 'x.tar'), '--install', join(root, 'x'), '--out', join(root, 'b')])
    assert.equal(bothInputs.status, 2)
    const unknownFlag = runCli(['--tar', join(root, 'x.tar'), '--out', join(root, 'c'), '--global-scan'])
    assert.equal(unknownFlag.status, 2)
    const missingInput = runCli(['--tar', join(root, 'missing.tar'), '--out', join(root, 'd')])
    assert.equal(missingInput.status, 2)
    assert.ok(checkIds(reportFor(join(root, 'd')), 'FAIL').includes('invocation'))

    const readOnlyParent = join(root, 'readonly')
    mkdirSync(readOnlyParent, { mode: 0o500 })
    const out = join(readOnlyParent, 'out')
    const refused = runCli(['--tar', join(root, 'x.tar'), '--out', out])
    assert.equal(refused.status, 2)
    assert.match(refused.stderr, /output_unavailable|REFUSED/)
    chmodSync(readOnlyParent, 0o700)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an existing output root is never overwritten', () => {
  const { root, tarPath } = validFixture('overwrite')
  try {
    const out = join(root, 'out')
    assert.equal(runCli(['--tar', tarPath, '--out', out]).status, 1)
    const before = sha256(readFileSync(join(out, 'preflight-report.json')))
    const second = runCli(['--tar', tarPath, '--out', out])
    assert.equal(second.status, 2)
    assert.match(second.stderr, /output_exists/)
    assert.equal(sha256(readFileSync(join(out, 'preflight-report.json'))), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('paths with spaces and non-ASCII names remain reproducible', () => {
  const base = tempRoot('unicode')
  const root = join(base, '空 格 目录')
  mkdirSync(root, { mode: 0o700 })
  try {
    const fixture = buildTinyInstall(root)
    const tarPath = join(root, '安装 包.tar.gz')
    packFixture(fixture, tarPath)
    const out = join(root, '输出 root')
    const run = runCli(['--tar', tarPath, '--out', out])
    assert.equal(run.status, 1, run.stderr)
    const report = reportFor(out)
    assert.deepEqual(checkIds(report, 'FAIL'), [])
    assert.ok(report.subject.path.includes('安装 包.tar.gz'))
    assert.equal(relative(REPO, out).startsWith('..'), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
