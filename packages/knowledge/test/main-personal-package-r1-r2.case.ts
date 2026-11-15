import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const artifacts = process.env.PA_ARTIFACTS ?? '/Users/hh/Desktop/joker/pa-artifacts'
const R1 = join(artifacts, 'wave30-target/wave30-target-8296720.tar.gz')
const R2 = join(artifacts, 'wave31-target/wave31-target-4dcd28f.tar.gz')
const R1_SHA = '04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543'
const R2_SHA = '405ecd02fcbf288bac0855e17911ec4035521b54fe27d81fa0b28feaf5addcc6'
function join(...parts: string[]) { return parts.join('/') }
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const listing = (tar: string) => execFileSync('tar', ['-tzf', tar], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n')
const installJson = (tar: string) => JSON.parse(execFileSync('tar', ['-xzOf', tar, 'install/install.json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))

test('immutable 829RC and the successor R2 package carry distinct identity and the J/export closure', { timeout: 120000 }, async (t) => {
  for (const [name, path, expected] of [['R1', R1, R1_SHA], ['R2', R2, R2_SHA]] as const) {
    if (!existsSync(path)) { t.diagnostic(`NOT_REACHED: ${name} missing at ${path}`); return }
    assert.equal(sha(path), expected, `${name} tar bytes changed`)
  }
  assert.notEqual(R1_SHA, R2_SHA)

  const r1 = installJson(R1), r2 = installJson(R2)
  assert.equal(r1.source.commit, '82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2')
  assert.equal(r1.buildId, '8296720d8a25f38c')
  assert.equal(r2.source.commit, 'c0a1f8975232b6397dfaf92d31ac5682df2dab36')
  assert.equal(r2.buildId, '4dcd28f758bbb265')
  for (const value of [r1, r2]) {
    assert.equal(value.producer.productSchema, 18)
    assert.equal(value.producer.node, '24.21.0')
    assert.equal(value.producer.abi, '137')
    assert.equal(JSON.stringify(value.entrypoints).includes('/Users/'), false)
  }
  assert.notEqual(r1.buildId, r2.buildId)
  assert.equal(r2.source.commit.startsWith('303b2c6a'), false)

  const r1Files = listing(R1), r2Files = listing(R2)
  for (const files of [r1Files, r2Files]) {
    for (const required of ['install/app/packages/project-recipes/dist/index.js',
      'install/app/apps/coordinator/product/project-recipes.ts',
      'install/app/apps/coordinator/product/usage-observation.ts',
      'install/app/packages/usage-insights/dist/index.js'])
      assert.equal(files.includes(required), true, `missing ${required}`)
  }
  // The successor carries the observation export wiring; the RC is kept as frozen history.
  const r2Assets = r2Files.filter((name) => /^install\/app\/apps\/console\/dist\/assets\/.*\.js$/.test(name))
  assert.equal(r2Assets.length >= 1, true)
  const bundle = execFileSync('tar', ['-xzOf', R2, r2Assets[0]!], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  assert.equal(bundle.includes('/v1/insights'), true)
  t.diagnostic(`R2 asset ${r2Assets[0]} mentions insights: true`)
  t.diagnostic(`R1 entries ${r1Files.length - 1}, R2 entries ${r2Files.length - 1}`)
})
