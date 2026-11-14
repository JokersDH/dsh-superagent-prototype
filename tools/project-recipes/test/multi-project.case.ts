/**
 * Two real, independently authorized project roots through the actual CLI, plus the
 * cross-project isolation checks: different facts/configuration must never reuse a suggestion.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PreviewError, assertDraftCurrent, parseProjectRecipeDraft, previewInputs } from '../../../packages/project-recipes/src/index.ts'
import { cliPath, fixture } from './paths.ts'

const NOW = '2026-11-14T12:00:00.000Z'
const config = (): Record<string, unknown> => JSON.parse(readFileSync(fixture('configuration.json'), 'utf8')) as Record<string, unknown>

const run = (args: readonly string[]) => spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 60_000 })

const makePnpmProject = (root: string) => {
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'alpha-service',
    packageManager: 'pnpm@11.7.0',
    engines: { node: '>=24' },
    scripts: { build: 'tsc', test: 'node --test' },
  }))
  writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  writeFileSync(join(root, 'tsconfig.json'), '{}')
}

const makeNpmMonorepo = (root: string) => {
  mkdirSync(join(root, 'packages/core/src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'beta-workspace',
    workspaces: ['packages/*'],
    scripts: { ci: 'npm test' },
  }))
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}')
}

const withRoots = (fn: (alpha: string, beta: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-multi-'))
  const alpha = join(dir, 'alpha')
  const beta = join(dir, 'beta')
  mkdirSync(alpha)
  mkdirSync(beta)
  try {
    makePnpmProject(alpha)
    makeNpmMonorepo(beta)
    fn(alpha, beta)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('two authorized roots produce two isolated, project-specific drafts', () => {
  withRoots((alpha, beta) => {
    const configPath = fixture('configuration.json')
    const a = run(['--config', configPath, '--root', alpha, '--project', 'project-alpha', '--paths', 'src/parser.ts', '--kind', 'regression_fix', '--now', NOW])
    const b = run(['--config', configPath, '--root', beta, '--project', 'project-beta', '--paths', 'packages/core/src/index.ts', '--kind', 'regression_fix', '--now', NOW])
    assert.equal(a.status, 0, a.stderr)
    assert.equal(b.status, 0, b.stderr)

    const draftA = parseProjectRecipeDraft(JSON.parse(a.stdout))
    const draftB = parseProjectRecipeDraft(JSON.parse(b.stdout))
    assert.equal(draftA.status, 'draft')
    assert.equal(draftB.status, 'draft')
    if (draftA.status !== 'draft' || draftB.status !== 'draft') return

    assert.equal(draftA.projectId, 'project-alpha')
    assert.equal(draftB.projectId, 'project-beta')
    assert.deepEqual(draftA.scope.allowedPaths, ['src/parser.ts'])
    assert.deepEqual(draftB.scope.allowedPaths, ['packages/core/src/index.ts'])
    assert.deepEqual(draftA.criteria.map((criterion) => criterion.id), ['tests', 'review'])
    assert.deepEqual(draftB.criteria.map((criterion) => criterion.id), ['beta-tests'])
    assert.notEqual(draftA.revision, draftB.revision)
    assert.notEqual(draftA.provenance.facts.digest, draftB.provenance.facts.digest)
    assert.equal(draftB.notes.some((note) => note.includes('monorepo')), true)
  })
})

test('the monorepo root without explicit member paths needs input, and no draft is produced', () => {
  withRoots((alpha, beta) => {
    void alpha
    const result = run(['--config', fixture('configuration.json'), '--root', beta, '--project', 'project-beta', '--kind', 'regression_fix', '--now', NOW])
    assert.equal(result.status, 3, result.stderr)
    const draft = parseProjectRecipeDraft(JSON.parse(result.stdout))
    assert.equal(draft.status, 'needs_input')
    if (draft.status !== 'needs_input') return
    assert.ok(draft.needsInput.some((item) => item.code === 'workspace_member_required'))
  })
})

test('a draft cannot be reused against another configuration or another project observation', () => {
  withRoots((alpha) => {
    const result = run(['--config', fixture('configuration.json'), '--root', alpha, '--project', 'project-alpha', '--paths', 'src', '--now', NOW])
    assert.equal(result.status, 0, result.stderr)
    const draft = parseProjectRecipeDraft(JSON.parse(result.stdout))
    if (draft.status !== 'draft') throw new Error('fixture must draft')

    const current = config()
    const facts = {
      protocol: 'project-facts/1',
      projectId: 'project-alpha',
      observedAt: NOW,
      provenance: { source: 'authorized_metadata', provider: 'x/1', authority: 'none', scope: 'package', inputs: [] },
      stack: { kind: 'node' },
      manager: { kind: 'pnpm' },
      locks: [{ name: 'pnpm-lock.yaml' }],
      workspace: { declaration: 'none' },
      scripts: ['build', 'test'],
      languages: ['node'],
      missing: [],
    }
    // Facts digest differs from the observed run, so the guard refuses reuse.
    assert.throws(() => previewInputs(draft, { configuration: current, facts }), (error: unknown) => error instanceof PreviewError && error.code === 'stale_inputs')
    // A configuration revision change is refused too.
    const changed = { ...current, revision: '9'.repeat(64) }
    assert.throws(() => assertDraftCurrent(draft, { configuration: changed, facts }), (error: unknown) => error instanceof PreviewError && error.code === 'stale_inputs')
  })
})

test('the same root observed twice yields byte-identical drafts', () => {
  withRoots((alpha) => {
    const args = ['--config', fixture('configuration.json'), '--root', alpha, '--project', 'project-alpha', '--paths', 'src', '--now', NOW]
    const first = run(args)
    const second = run(args)
    assert.equal(first.status, 0, first.stderr)
    assert.equal(second.status, 0, second.stderr)
    assert.equal(first.stdout, second.stdout)
  })
})
