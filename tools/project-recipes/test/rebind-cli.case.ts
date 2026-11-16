/**
 * R3 CLI surface: a colleague re-binds a project to a new root and gets a bounded comparison report.
 * The command never writes to the project and never invents a current observation.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { RebindReportSchema, observeProjectMetadata } from '../../../packages/project-recipes/src/index.ts'
import { cliPath } from './paths.ts'

const NOW = '2026-11-14T12:00:00.000Z'
const run = (args: readonly string[]) => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 60_000 })

const pnpmJson = { name: 'moved', packageManager: 'pnpm@11.7.0', engines: { node: '>=24' }, scripts: { test: 'node --test' } }

const withFixture = (fn: (input: { dir: string; previous: string }) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'recipe-rebind-cli-'))
  const before = join(root, 'before')
  mkdirSync(before)
  writeFileSync(join(before, 'package.json'), JSON.stringify(pnpmJson))
  writeFileSync(join(before, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  const facts = observeProjectMetadata({ root: before, projectId: 'project-alpha', observedAt: '2026-11-14T10:00:00.000Z' }).facts
  const previous = join(root, 'previous.json')
  writeFileSync(previous, JSON.stringify(facts))
  try {
    fn({ dir: root, previous })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('unchanged bytes report current with exit 0', () => {
  withFixture(({ dir, previous }) => {
    const result = run(['--previous-facts', previous, '--root', join(dir, 'before'), '--now', NOW])
    assert.equal(result.status, 0, result.stderr)
    const report = RebindReportSchema.parse(JSON.parse(result.stdout))
    assert.equal(report.status, 'current')
    assert.deepEqual(report.changes, [])
    assert.equal(report.authorization, 'none')
  })
})

test('a moved project reports the changed fields with exit 0', () => {
  withFixture(({ dir, previous }) => {
    const after = join(dir, 'after')
    mkdirSync(after)
    writeFileSync(join(after, 'package.json'), JSON.stringify({ ...pnpmJson, packageManager: 'npm@11.6.0', engines: { node: '>=22' } }))
    writeFileSync(join(after, 'package-lock.json'), '{"lockfileVersion":3}')
    const result = run(['--previous-facts', previous, '--root', after, '--now', NOW])
    assert.equal(result.status, 0, result.stderr)
    const report = RebindReportSchema.parse(JSON.parse(result.stdout))
    assert.equal(report.status, 'changed')
    assert.deepEqual([...report.changes].sort(), ['lockfile', 'manager', 'packageJson'])
    assert.equal(result.stdout.includes(after), false, 'no absolute root in the report')
  })
})

test('an unregistered or missing root is unbound with exit 3, not a fake current report', () => {
  withFixture(({ dir, previous }) => {
    const result = run(['--previous-facts', previous, '--root', join(dir, 'missing'), '--now', NOW])
    assert.equal(result.status, 3, result.stderr)
    const report = RebindReportSchema.parse(JSON.parse(result.stdout))
    assert.equal(report.status, 'unbound')
    assert.equal(report.current, null)
  })
})

test('a re-identified project reports the migration diff and is refused for reuse', () => {
  withFixture(({ dir, previous }) => {
    const moved = run(['--previous-facts', previous, '--root', join(dir, 'before'), '--project', 'project-other', '--now', NOW])
    assert.equal(moved.status, 5)
    const report = JSON.parse(moved.stdout)
    assert.equal(report.status, 'reidentified')
    assert.equal(report.previousProjectId, 'project-alpha')
    assert.match(moved.stderr, /not reusable/)

    for (const args of [
      ['--previous-facts', previous, '--now', NOW],
      ['--previous-facts', previous, '--root', join(dir, 'before'), '--facts', previous, '--now', NOW],
      ['--previous-facts', previous, '--root', join(dir, 'before'), '--paths', 'src/', '--now', NOW],
    ]) assert.equal(run(args).status, 2, JSON.stringify(args))
  })
})
