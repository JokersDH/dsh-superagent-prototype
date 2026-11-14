import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('global and command help describe restored review without initializing private roots or invoking an executor', t => {
  const root = mkdtempSync(join(tmpdir(), 'pa-cli-help-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const entry = fileURLToPath(new URL('../bin/pa.mjs', import.meta.url))
  const env = { ...process.env, PA_CODEX_BIN: join(root, 'no-executor'),
    PA_CONFIG_ROOT: join(root, 'config'), PA_DATA_ROOT: join(root, 'data'),
    PA_CACHE_ROOT: join(root, 'cache'), PA_LOGS_ROOT: join(root, 'logs'), PA_WORKSPACE_ROOT: join(root, 'workspaces') }
  for (const args of [['--help'], ['-h'], ['help', 'review-restored'], ['review-restored', '--help'], ['start', '--help']]) {
    const result = spawnSync(process.execPath, [entry, ...args], { env, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /review-restored/)
    assert.equal(result.stderr, '')
  }
  for (const dir of ['config', 'data', 'cache', 'logs', 'workspaces']) assert.equal(existsSync(join(root, dir)), false)
})
