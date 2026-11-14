/**
 * Bounded metadata observation: allow-listed names only, NOFOLLOW, byte/file budgets, and a facts
 * projection that carries names/digests/flags but never script bodies or absolute paths.
 */
import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { matchRecipe } from '../../../packages/project-recipes/src/index.ts'
import { MetadataRefused, observeProjectMetadata } from '../metadata.ts'
import { fixture } from './paths.ts'

const NOW = '2026-11-14T12:00:00.000Z'

const withDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-meta-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const write = (dir: string, name: string, content: string) => writeFileSync(join(dir, name), content)

const observe = (root: string, extra: Partial<Parameters<typeof observeProjectMetadata>[0]> = {}) =>
  observeProjectMetadata({ root, projectId: 'project-alpha', observedAt: NOW, ...extra })

/** One real configured project, so a negative case fails for the reason under test. */
const minimalConfiguration = {
  protocol: 'application-configuration/1',
  revision: 'c'.repeat(64),
  executionAvailability: { state: 'available', kind: 'native' },
  projects: [{
    id: 'project-alpha',
    displayName: 'Alpha',
    scope: { projectId: 'project-alpha', allowedPaths: ['src'], excludedPaths: [], externalActions: [] },
    profileIds: ['profile-native'],
    defaultProfileId: 'profile-native',
    defaultCriteria: [{ id: 'tests', description: 'Tests pass.', kind: 'machine', required: true, checkDefinitionRef: 'check-node-test' }],
    dispatchAllowed: true,
  }],
  profiles: [{ id: 'profile-native', revision: 1, displayName: 'Native', driverId: 'codex', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true }],
  checks: [{ id: 'check-node-test', revision: 1, displayName: 'node --test' }],
}

const packageJson = {
  name: 'sample',
  packageManager: 'pnpm@11.7.0',
  engines: { node: '>=24' },
  scripts: { test: 'node --test', build: 'tsc -p .' },
}

test('a normal Node project is observed with digests, sorted script names and no paths', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify(packageJson))
    write(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n")
    write(dir, 'tsconfig.json', '{}')
    const { facts, notes } = observe(dir)
    assert.equal(facts.stack.kind, 'node')
    assert.deepEqual(facts.manager, { kind: 'pnpm', declaredVersion: '11.7.0' })
    assert.deepEqual(facts.locks.map((lock) => lock.name), ['pnpm-lock.yaml'])
    assert.match(facts.locks[0]!.digest!, /^[a-f0-9]{64}$/)
    assert.deepEqual(facts.scripts, ['build', 'test'])
    assert.deepEqual(facts.languages, ['node', 'typescript'])
    assert.equal(facts.workspace.declaration, 'none')
    assert.deepEqual(facts.missing, [])
    assert.equal(facts.provenance.source, 'authorized_metadata')
    assert.equal(facts.provenance.inputs.length, 2)
    assert.ok(notes.some((note) => note.includes('tsconfig.json')))
    assert.equal(JSON.stringify(facts).includes(dir), false, 'facts must not contain the absolute root')
  })
})

test('script bodies never reach the facts, even when they contain secrets', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify({ ...packageJson, scripts: { leak: 'echo SUPER_SECRET_TOKEN=abc' } }))
    const { facts } = observe(dir)
    assert.deepEqual(facts.scripts, ['leak'])
    assert.equal(JSON.stringify(facts).includes('SUPER_SECRET'), false)
    assert.equal(JSON.stringify(facts).includes('echo'), false)
  })
})

test('a symlinked package.json or lockfile is refused instead of followed', () => {
  withDir((dir) => {
    const outside = join(dir, 'outside.json')
    writeFileSync(outside, JSON.stringify(packageJson))
    symlinkSync(outside, join(dir, 'package.json'))
    assert.throws(() => observe(dir), (error: unknown) => error instanceof MetadataRefused && error.code === 'symlink')
  })
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify(packageJson))
    write(dir, 'target.lock', 'x')
    symlinkSync(join(dir, 'target.lock'), join(dir, 'pnpm-lock.yaml'))
    assert.throws(() => observe(dir), (error: unknown) => error instanceof MetadataRefused && error.code === 'symlink')
  })
})

test('oversized, malformed or non-object package.json is refused at the boundary', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify({ ...packageJson, padding: 'x'.repeat(400) }))
    assert.throws(() => observe(dir, { limits: { maxJsonBytes: 64 } }), (error: unknown) => error instanceof MetadataRefused && error.code === 'too_large')
  })
  withDir((dir) => {
    write(dir, 'package.json', '{ nope')
    assert.throws(() => observe(dir), (error: unknown) => error instanceof MetadataRefused && error.code === 'invalid_json')
  })
  withDir((dir) => {
    write(dir, 'package.json', '[]')
    assert.throws(() => observe(dir), (error: unknown) => error instanceof MetadataRefused && error.code === 'not_object')
  })
})

test('root authorization refuses /, the home directory and relative paths', () => {
  assert.throws(() => observe('/'), (error: unknown) => error instanceof MetadataRefused && error.code === 'root_forbidden')
  assert.throws(() => observe(homedir()), (error: unknown) => error instanceof MetadataRefused && error.code === 'root_forbidden')
  assert.throws(() => observe('relative/project'), (error: unknown) => error instanceof MetadataRefused && error.code === 'root_not_absolute')
  assert.throws(() => observe(join(tmpdir(), 'definitely-missing-recipe-root')), (error: unknown) => error instanceof MetadataRefused && error.code === 'root_missing')
})

test('file and total byte budgets are enforced', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify(packageJson))
    write(dir, 'pnpm-lock.yaml', 'x'.repeat(64))
    assert.throws(() => observe(dir, { limits: { maxFiles: 1 } }), (error: unknown) => error instanceof MetadataRefused && error.code === 'budget_exceeded')
  })
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify(packageJson))
    write(dir, 'pnpm-lock.yaml', 'x'.repeat(64))
    assert.throws(() => observe(dir, { limits: { maxTotalBytes: 32 } }), (error: unknown) => error instanceof MetadataRefused && error.code === 'budget_exceeded')
  })
})

test('workspace layouts are classified, and monorepo roots still need explicit paths', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify({ ...packageJson, workspaces: ['packages/*'] }))
    const { facts } = observe(dir)
    assert.equal(facts.workspace.declaration, 'package_json_workspaces')
    assert.equal(facts.provenance.scope, 'workspace_root')
  })
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify(packageJson))
    write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n')
    const { facts } = observe(dir)
    assert.equal(facts.workspace.declaration, 'pnpm_workspace_yaml')
  })
})

test('a non-Node root is reported as such and never treated as Node', () => {
  withDir((dir) => {
    write(dir, 'pyproject.toml', '[project]\nname = "x"\n')
    const { facts } = observe(dir)
    assert.deepEqual(facts.stack, { kind: 'not_node', markers: ['pyproject.toml'] })
    assert.deepEqual(facts.languages, [])
    assert.ok(facts.missing.includes('packageJson'))
    const draft = matchRecipe({ facts, configuration: minimalConfiguration, kind: 'regression_fix', now: NOW })
    assert.equal(draft.status, 'unsupported')
    if (draft.status !== 'unsupported') return
    assert.deepEqual(draft.unsupported.map((item) => item.code), ['stack_not_node'])
  })
})

test('an empty or unreadable project yields unknown state, not an empty default', () => {
  withDir((dir) => {
    const { facts } = observe(dir)
    assert.equal(facts.stack.kind, 'unknown')
    assert.deepEqual(facts.manager, { kind: 'none' })
    assert.deepEqual(facts.scripts, [])
    assert.ok(facts.missing.includes('packageJson'))
    assert.ok(facts.missing.includes('lockfile'))
  })
})

test('a conflicting pnpm+npm lock pair is observed honestly and needs input', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify({ name: 'x', scripts: {} }))
    write(dir, 'pnpm-lock.yaml', 'x')
    write(dir, 'package-lock.json', '{}')
    const { facts } = observe(dir)
    assert.equal(facts.locks.length, 2)
    const draft = matchRecipe({
      facts,
      configuration: minimalConfiguration,
      kind: 'regression_fix',
      selection: { paths: ['src'] },
      now: NOW,
    })
    assert.equal(draft.status, 'needs_input')
    if (draft.status !== 'needs_input') return
    assert.ok(draft.needsInput.some((item) => item.code === 'locks_ambiguous'))
  })
})

test('an unsupported package manager declaration is observed, not executed', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify({ ...packageJson, packageManager: 'bun@1.2.0' }))
    const { facts } = observe(dir)
    assert.deepEqual(facts.manager, { kind: 'unsupported', name: 'bun' })
    assert.equal(facts.stack.kind === 'node' && facts.stack.packageManagerField, 'bun@1.2.0')
  })
})

test('the committed example project observes cleanly', () => {
  const { facts } = observe(fixture('example-project'))
  assert.equal(facts.stack.kind, 'node')
  assert.deepEqual(facts.manager, { kind: 'pnpm', declaredVersion: '11.7.0' })
  assert.deepEqual(facts.scripts, ['build', 'test'])
  assert.equal(facts.workspace.declaration, 'none')
})

test('observation is read-only: no file in the project changes', () => {
  withDir((dir) => {
    write(dir, 'package.json', JSON.stringify(packageJson))
    write(dir, 'pnpm-lock.yaml', 'lock')
    mkdirSync(join(dir, 'src'))
    const before = [readStat(join(dir, 'package.json')), readStat(join(dir, 'pnpm-lock.yaml')), readStat(join(dir, 'src'))]
    observe(dir)
    const after = [readStat(join(dir, 'package.json')), readStat(join(dir, 'pnpm-lock.yaml')), readStat(join(dir, 'src'))]
    assert.deepEqual(after, before)
  })
})

const readStat = (path: string): string => {
  const stats = lstatSync(path)
  return `${stats.mtimeMs}:${stats.size}:${stats.mode}`
}
