/**
 * The read-only CLI: documented exits for draft/needs_input/unsupported/usage/refused, a new-file-only
 * output writer, and no private material or absolute path in stdout.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseProjectRecipeDraft } from '../../../packages/project-recipes/src/index.ts'
import { cliPath, fixture } from './paths.ts'

const NOW = '2026-11-14T12:00:00.000Z'

const run = (args: readonly string[]) => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 60_000 })

const base = ['--config', fixture('configuration.json'), '--facts', fixture('facts-alpha.json'), '--now', NOW]

const withTemp = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-cli-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('--help exits 0, documents every recipe kind and touches no file', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /project-recipes — 只读的项目任务\/检查声明建议/)
  for (const kind of ['regression_fix', 'scoped_change', 'verification_followup']) assert.ok(result.stdout.includes(kind))
  assert.match(result.stdout, /退出码/)
})

test('a complete draft exits 0 and its JSON passes the shared revision check', () => {
  const result = run([...base, '--paths', 'src/parser.ts', '--kind', 'regression_fix'])
  assert.equal(result.status, 0, result.stderr)
  const draft = parseProjectRecipeDraft(JSON.parse(result.stdout))
  assert.equal(draft.status, 'draft')
  assert.equal(draft.authorization, 'none')
  if (draft.status !== 'draft') return
  assert.deepEqual(draft.scope.allowedPaths, ['src/parser.ts'])
  assert.equal(draft.profileId, 'profile-native')
  assert.equal(draft.provenance.configuration.revision, 'c'.repeat(64))
})

test('the documented needs_input and unsupported exits are accurate', () => {
  const needs = run([...base, '--kind', 'scoped_change'])
  assert.equal(needs.status, 3)
  assert.equal(JSON.parse(needs.stdout).status, 'needs_input')
  assert.match(needs.stderr, /needs_input scope_paths_required/)

  withTemp((dir) => {
    const ghost = join(dir, 'facts-ghost.json')
    writeFileSync(ghost, JSON.stringify({ ...JSON.parse(readFileSync(fixture('facts-alpha.json'), 'utf8')), projectId: 'project-ghost' }))
    const unsupported = run(['--config', fixture('configuration.json'), '--facts', ghost, '--now', NOW])
    assert.equal(unsupported.status, 4)
    assert.equal(JSON.parse(unsupported.stdout).status, 'unsupported')
    assert.match(unsupported.stderr, /unsupported project_unknown/)
  })

  const mismatch = run([...base, '--project', 'project-beta'])
  assert.equal(mismatch.status, 2)
  assert.match(mismatch.stderr, /不一致/)
})

test('usage errors exit 2 without reading anything', () => {
  assert.equal(run([]).status, 2)
  assert.equal(run(['--config', fixture('configuration.json')]).status, 2)
  assert.equal(run([...base, '--root', fixture('example-project')]).status, 2)
  assert.equal(run([...base, '--nope', 'x']).status, 2)
  assert.equal(run([...base, '--kind', 'deploy_everything']).status, 2)
})

test('a bad or missing input file is refused with exit 5', () => {
  withTemp((dir) => {
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{ not json')
    const bad = run(['--config', fixture('configuration.json'), '--facts', broken, '--now', NOW])
    assert.equal(bad.status, 5)
    assert.match(bad.stderr, /refused \[invalid_json\]/)

    const missing = run(['--config', fixture('configuration.json'), '--facts', join(dir, 'nope.json'), '--now', NOW])
    assert.equal(missing.status, 5)

    const link = join(dir, 'linked.json')
    symlinkSync(fixture('facts-alpha.json'), link)
    const symlinked = run(['--config', fixture('configuration.json'), '--facts', link, '--now', NOW])
    assert.equal(symlinked.status, 5)
    assert.match(symlinked.stderr, /\[symlink\]/)
  })
})

test('--output never overwrites an existing file and writes an identical new one', () => {
  withTemp((dir) => {
    const existing = join(dir, 'report.json')
    writeFileSync(existing, '{"keep":true}')
    const refused = run([...base, '--paths', 'src', '--output', existing])
    assert.equal(refused.status, 5)
    assert.equal(readFileSync(existing, 'utf8'), '{"keep":true}')

    const fresh = join(dir, 'new-report.json')
    const written = run([...base, '--paths', 'src', '--output', fresh])
    assert.equal(written.status, 0, written.stderr)
    assert.deepEqual(JSON.parse(readFileSync(fresh, 'utf8')), JSON.parse(written.stdout))
  })
})

test('reading an authorized root yields a draft and keeps script bodies and paths out of stdout', () => {
  withTemp((dir) => {
    const project = join(dir, 'project')
    const result = run(['--config', fixture('configuration.json'), '--root', project, '--project', 'project-alpha', '--paths', 'src', '--now', NOW])
    // A directory that does not exist yet is refused, never created.
    assert.equal(result.status, 5)
    assert.ok(!result.stdout.includes(project))
  })

  const result = run(['--config', fixture('configuration.json'), '--root', fixture('example-project'), '--project', 'project-alpha', '--paths', 'src', '--now', NOW])
  assert.equal(result.status, 0, result.stderr)
  const draft = JSON.parse(result.stdout)
  assert.equal(draft.status, 'draft')
  assert.equal(draft.provenance.facts.source, 'authorized_metadata')
  assert.ok(!result.stdout.includes(fixture('example-project')), 'stdout must not contain the absolute root')
})

test('stale facts reach the documented needs_input exit through the CLI', () => {
  const stale = run(['--config', fixture('configuration.json'), '--facts', fixture('facts-alpha.json'), '--now', '2026-11-20T00:00:00.000Z', '--paths', 'src'])
  assert.equal(stale.status, 3, stale.stderr)
  const draft = JSON.parse(stale.stdout)
  assert.equal(draft.status, 'needs_input')
  assert.ok(draft.needsInput.some((item: { code: string }) => item.code === 'facts_stale'))
})
