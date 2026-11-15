/**
 * R3 migration support: re-binding a project to a new root.
 *
 * The report compares metadata only. It never carries the old project's grant, never guesses an
 * unregistered root, and never turns a changed tree into "migration complete".
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PreviewError,
  RebindError,
  RebindReportSchema,
  compareProjectFacts,
  matchRecipe,
  observeProjectMetadata,
  previewInputs,
  rebindRegisteredProject,
  reobserveProjectFacts,
} from '../src/index.ts'
import { NOW, alphaFacts } from './fixtures.ts'

const withDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-rebind-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const writeProject = (dir: string, packageJson: Record<string, unknown>, lock?: string) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson))
  if (lock) writeFileSync(join(dir, lock), lock.endsWith('.json') ? '{"lockfileVersion":3}' : "lockfileVersion: '9.0'\n")
}

const pnpmJson = { name: 'moved', packageManager: 'pnpm@11.7.0', engines: { node: '>=24' }, scripts: { test: 'node --test' } }
const npmJson = { name: 'moved', packageManager: 'npm@11.6.0', engines: { node: '>=22' }, scripts: { test: 'node --test' } }

test('an unregistered project reports unbound instead of guessing a root', () => {
  const { facts, report } = rebindRegisteredProject({ previous: alphaFacts, observedAt: NOW, roots: { rootFor: () => undefined } })
  assert.equal(facts, null)
  assert.equal(report.status, 'unbound')
  assert.equal(report.current, null)
  assert.equal(report.authorization, 'none')
  assert.equal(RebindReportSchema.safeParse(report).success, true)
  assert.match(report.notes[0]!, /重新登记/)
})

test('a mismatched project identity is foreign and never reuses the old observation', () => {
  withDir((dir) => {
    writeProject(dir, pnpmJson, 'pnpm-lock.yaml')
    const { facts, report } = reobserveProjectFacts({ previous: alphaFacts, root: dir, projectId: 'project-other', observedAt: NOW })
    assert.equal(facts, null)
    assert.equal(report.status, 'foreign')
    assert.equal(report.projectId, 'project-other')
    assert.deepEqual(report.changes, [])
    assert.match(report.notes[0]!, /不一致/)
  })
})

test('the same project and bytes report current; a moved tree reports the changed fields', () => {
  withDir((first) => {
    writeProject(first, pnpmJson, 'pnpm-lock.yaml')
    const observed = observeProjectMetadata({ root: first, projectId: 'project-alpha', observedAt: '2026-11-14T10:00:00.000Z' }).facts
    const same = compareProjectFacts(observed, { ...observed, observedAt: '2026-11-14T11:00:00.000Z' })
    assert.equal(same.status, 'current')
    assert.deepEqual(same.changes, [])
    assert.equal(same.previous!.contentDigest, same.current!.contentDigest)
    assert.notEqual(same.previous!.observedAt, same.current!.observedAt)
    assert.equal(JSON.stringify(same).includes(first), false, 'the report carries no absolute root')
    assert.equal(RebindReportSchema.safeParse(same).success, true)

    // Re-bind to a new root that switched manager and lock.
    withDir((second) => {
      writeProject(second, npmJson, 'package-lock.json')
      const moved = reobserveProjectFacts({ previous: observed, root: second, observedAt: NOW })
      assert.equal(moved.report.status, 'changed')
      assert.deepEqual([...moved.report.changes].sort(), ['lockfile', 'manager', 'packageJson'])
      assert.equal(moved.report.authorization, 'none')
      assert.equal(moved.facts?.manager.kind, 'npm')
      assert.equal(JSON.stringify(moved.report).includes(second), false)
    })
  })
})

test('workspace and script changes are listed field by field', () => {
  withDir((first) => {
    writeProject(first, pnpmJson, 'pnpm-lock.yaml')
    const observed = observeProjectMetadata({ root: first, projectId: 'project-alpha', observedAt: NOW }).facts
    withDir((second) => {
      writeProject(second, { ...pnpmJson, workspaces: ['packages/*'], scripts: { test: 'node --test', build: 'tsc' } }, 'pnpm-lock.yaml')
      const report = reobserveProjectFacts({ previous: observed, root: second, observedAt: NOW }).report
      assert.equal(report.status, 'changed')
      assert.ok(report.changes.includes('workspace'))
      assert.ok(report.changes.includes('scripts'))
    })
  })
})

test('malformed previous facts and invalid clocks are caller errors', () => {
  assert.throws(
    () => rebindRegisteredProject({ previous: { ...alphaFacts, protocol: 'project-facts/2' }, observedAt: NOW, roots: { rootFor: () => '/tmp' } }),
    (error: unknown) => error instanceof RebindError && error.code === 'invalid_previous',
  )
  assert.throws(
    () => rebindRegisteredProject({ previous: alphaFacts, observedAt: 'not-a-time', roots: { rootFor: () => '/tmp' } }),
    (error: unknown) => error instanceof RebindError && error.code === 'invalid_clock',
  )
})

test('re-binding never returns a credential, grant or absolute path in the report', () => {
  withDir((dir) => {
    writeProject(dir, pnpmJson, 'pnpm-lock.yaml')
    const result = reobserveProjectFacts({ previous: alphaFacts, root: dir, observedAt: NOW })
    const text = JSON.stringify(result.report)
    assert.equal(text.includes(dir), false)
    assert.equal(result.report.authorization, 'none')
    for (const forbidden of ['token', 'credential', 'grant', 'allowedPaths']) assert.equal(text.includes(`"${forbidden}"`), false)
  })
})

test('after a re-bind the previous draft is stale and the new tree drives the new suggestion', () => {
  withDir((first) => {
    writeProject(first, pnpmJson, 'pnpm-lock.yaml')
    const previous = observeProjectMetadata({ root: first, projectId: 'project-alpha', observedAt: '2026-11-14T10:00:00.000Z' }).facts
    // A suggestion produced before the move, with the project's then-current atoms.
    const configuration = {
      protocol: 'application-configuration/1' as const,
      revision: 'c'.repeat(64),
      executionAvailability: { state: 'available' as const, kind: 'native' as const },
      projects: [{
        id: 'project-alpha',
        displayName: 'Alpha',
        scope: { projectId: 'project-alpha', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] as string[] },
        profileIds: ['profile-native'],
        defaultProfileId: 'profile-native',
        defaultCriteria: [{ id: 'tests', description: 'Tests pass.', kind: 'machine' as const, required: true as const, checkDefinitionRef: 'check-node-test' }],
        dispatchAllowed: true,
      }],
      profiles: [{ id: 'profile-native', revision: 1, displayName: 'Native', driverId: 'codex', kind: 'native' as const, readiness: 'native_test_passed' as const, dispatchAllowed: true }],
      checks: [{ id: 'check-node-test', revision: 1, displayName: 'node --test' }],
    }
    const before = matchRecipe({ facts: previous, configuration, kind: 'scoped_change', selection: { paths: ['src/'] }, now: '2026-11-14T10:05:00.000Z' })
    assert.equal(before.status, 'draft')

    withDir((second) => {
      writeProject(second, npmJson, 'package-lock.json')
      const rebind = reobserveProjectFacts({ previous, root: second, observedAt: NOW })
      assert.equal(rebind.report.status, 'changed')
      assert.ok(rebind.facts)

      // Same configuration, new facts: the old draft must not be reused.
      assert.throws(
        () => previewInputs(before, { configuration, facts: rebind.facts, now: NOW }),
        (error: unknown) => error instanceof PreviewError && error.staleInputs.includes('facts'),
      )
      // The new facts still produce a suggestion against the current configured atoms.
      const after = matchRecipe({ facts: rebind.facts, configuration, kind: 'scoped_change', selection: { paths: ['src/'] }, now: NOW })
      assert.equal(after.status, 'draft')
    })
  })
})
