import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TAR = '/Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz'
const ARTIFACT = '/Users/hh/Desktop/joker/pa-artifacts/wave30-target/install-artifact.json'
const CLI = join(import.meta.dirname, '../../..', 'tools/trial-kit/bin/trial-field-kit.mjs')

test('field kit produces a bounded redacted summary with installed and source layers', () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-field-'))
  const out = join(root, 'run')
  try {
    const run = spawnSync(process.execPath, [CLI,
      '--tar', TAR, '--artifact', ARTIFACT, '--out', out, '--readiness-fixture',
      '--expect-sha256', '04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543',
      '--expect-build', '8296720d8a25f38c', '--expect-schema', '18',
      '--expect-source', '82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2',
      '--source-consumer', '--i-commit', '4bce0673388f22952513b5e530381f7a95e7a794',
      '--b-commit', 'fbc933166758f446ba8907ce93795d04d34d11d7',
      '--main-root', join(import.meta.dirname, '../../..'),
    ], { encoding: 'utf8', timeout: 240000 })
    assert.equal(run.status, 1, run.stderr || run.stdout)
    const summary = JSON.parse(readFileSync(join(out, 'support-summary.json'), 'utf8'))
    assert.equal(summary.package.buildId, '8296720d8a25f38c')
    assert.equal(summary.result, 'DEGRADED')
    assert.equal(summary.counts.fail, 0)
    assert.equal(summary.sourceConsumer.exit, 0)
    assert.equal(summary.sourceConsumer.report.ok, true)
    assert.equal(summary.layers.recovery, 'NOT_REACHED in this kit')
    assert.ok(summary.knownIssues.some((issue) => issue.id === 'host_sqlite_unknown'))
    assert.ok(!readFileSync(join(out, 'support-summary.json'), 'utf8').includes(process.env.HOME ?? '/Users/'))
    assert.ok(readFileSync(join(out, 'FIELD-NOTES.md'), 'utf8').includes('一页清单'))
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    assert.ok(manifest.files.some((entry) => entry.path === 'support-summary.json'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
