/** Roots stay outside the checkout by default, private, and never coincide with the install. */
import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PortabilityError,
  defaultRoots,
  describeRoots,
  ensureRoots,
  platformSupport,
  resolveRoots,
} from '../src/index.ts'

const temp = (name: string) => join(tmpdir(), `pa-roots-${name}-${process.pid}-${Math.random().toString(16).slice(2)}`)

test('default darwin roots live outside the install root and differ per role', () => {
  const roots = defaultRoots({ home: '/Users/example', platform: 'darwin', installRoot: '/work/product' })
  assert.equal(roots.install, '/work/product')
  assert.equal(roots.config, '/Users/example/Library/Application Support/dsh-superagent/config')
  assert.equal(roots.data, '/Users/example/Library/Application Support/dsh-superagent/data')
  assert.equal(roots.cache, '/Users/example/Library/Caches/dsh-superagent')
  assert.equal(roots.logs, '/Users/example/Library/Logs/dsh-superagent')
  assert.equal(roots.workspace, '/Users/example/Library/Application Support/dsh-superagent/workspaces')
  assert.equal(new Set(Object.values(roots)).size, 6)
})

test('explicit overrides win over environment, and tilde expands against the given home', () => {
  const roots = resolveRoots({
    installRoot: '/work/product',
    home: '/Users/example',
    platform: 'darwin',
    env: { PA_DATA_ROOT: '/env/data' },
    overrides: { data: '~/private/state' },
  })
  assert.equal(roots.data, '/Users/example/private/state')
  assert.equal(roots.config, '/Users/example/Library/Application Support/dsh-superagent/config')
})

test('environment roots are used when no override is given', () => {
  const roots = resolveRoots({
    installRoot: '/work/product',
    home: '/Users/example',
    platform: 'darwin',
    env: { PA_DATA_ROOT: '/env/data' },
  })
  assert.equal(roots.data, '/env/data')
})

test('private roots inside the install root are refused', () => {
  assert.throws(
    () => resolveRoots({ installRoot: '/work/product', home: '/Users/example', platform: 'darwin', overrides: { data: '/work/product/.local-state' } }),
    (error) => error instanceof PortabilityError && error.code === 'root_inside_install',
  )
})

test('install inside a private root is refused', () => {
  assert.throws(
    () => resolveRoots({ installRoot: '/data/product', home: '/Users/example', platform: 'darwin', env: { PA_DATA_ROOT: '/data' } }),
    (error) => error instanceof PortabilityError && error.code === 'root_inside_install',
  )
})

test('coinciding roots and relative roots are refused', () => {
  assert.throws(
    () => resolveRoots({ installRoot: '/work/product', home: '/Users/example', platform: 'darwin', overrides: { cache: '/Users/example/Library/Logs/dsh-superagent' } }),
    (error) => error instanceof PortabilityError && error.code === 'invalid_root',
  )
  assert.throws(
    () => resolveRoots({ installRoot: '/work/product', home: '/Users/example', platform: 'darwin', overrides: { data: 'relative/data' } }),
    (error) => error instanceof PortabilityError && error.code === 'invalid_root',
  )
})

test('ensureRoots creates private roots and refuses a symlinked or world-visible root', (t) => {
  const base = temp('ensure')
  mkdirSync(join(base, 'install'), { recursive: true, mode: 0o700 })
  try {
    const roots = resolveRoots({
      installRoot: join(base, 'install'),
      home: base,
      platform: 'darwin',
      overrides: {
        config: join(base, 'roots/config'),
        data: join(base, 'roots/data'),
        cache: join(base, 'roots/cache'),
        logs: join(base, 'roots/logs'),
        workspace: join(base, 'roots/workspace'),
      },
    })
    const { created } = ensureRoots(roots)
    assert.equal(created.length, 5)
    for (const name of ['config', 'data', 'cache', 'logs', 'workspace'] as const) {
      const stat = lstatSync(roots[name])
      assert.equal(stat.mode & 0o777, 0o700, `${name} is private`)
    }
    const reports = describeRoots(roots)
    assert.deepEqual(reports.map((report) => report.exists), [true, true, true, true, true, true])
    assert.deepEqual(reports.map((report) => report.private), [true, true, true, true, true, true])

    // A symlinked private root is refused rather than followed.
    const linkBase = temp('symlink')
    mkdirSync(join(linkBase, 'target'), { recursive: true, mode: 0o700 })
    mkdirSync(join(linkBase, 'install'), { recursive: true, mode: 0o700 })
    symlinkSync(join(linkBase, 'target'), join(linkBase, 'data'))
    const linked = resolveRoots({
      installRoot: join(linkBase, 'install'),
      home: linkBase,
      platform: 'darwin',
      overrides: {
        config: join(linkBase, 'config'),
        data: join(linkBase, 'data'),
        cache: join(linkBase, 'cache'),
        logs: join(linkBase, 'logs'),
        workspace: join(linkBase, 'workspace'),
      },
    })
    assert.throws(
      () => ensureRoots(linked),
      (error) => error instanceof PortabilityError && error.code === 'unsafe_root',
    )
    rmSync(linkBase, { recursive: true, force: true })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('unsupported platforms are refused instead of guessed', () => {
  assert.throws(
    () => defaultRoots({ home: '/home/example', platform: 'sunos', installRoot: '/work/product' }),
    (error) => error instanceof PortabilityError && error.code === 'unsupported_platform',
  )
})

test('platform support keeps only the measured candidate as tested', () => {
  const support = platformSupport()
  assert.equal(support.tested, process.platform === 'darwin' && process.arch === 'arm64')
  if (!support.tested) assert.match(support.note, /NOT_TESTED/)
})
