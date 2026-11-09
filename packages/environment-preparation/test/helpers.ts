import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EnvironmentPreparationInput, PreparationPolicy } from '../src/index.ts'

export const pnpmVersion = (): string => execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()

export function tempDir(prefix = 'environment-case-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export interface PnpmFixture {
  root: string
  /** A prepared source template with package.json, lock, tarball dependency and test file. */
  template: string
  /** Offline pnpm store containing the local tarball dependency. */
  store: string
  version: string
}

/**
 * Builds a controlled pnpm project whose only dependency is a local tarball. The lockfile and store
 * are generated with pnpm in offline mode (no registry/network); node_modules is removed so the
 * module under test performs the real frozen offline install.
 */
export function makePnpmFixture(): PnpmFixture {
  const root = tempDir('environment-pnpm-')
  const dependency = join(root, 'dependency')
  mkdirSync(dependency, { recursive: true })
  writeJson(join(dependency, 'package.json'), { name: 'env-dep', version: '1.0.0', main: 'index.js' })
  writeFileSync(join(dependency, 'index.js'), 'module.exports = () => "dep-ok"\n')
  const template = join(root, 'template')
  const vendor = join(template, 'vendor')
  mkdirSync(vendor, { recursive: true })
  execFileSync('pnpm', ['pack', '--pack-destination', vendor], { cwd: dependency, stdio: 'ignore' })
  const tarball = readdirSync(vendor).find(name => name.endsWith('.tgz'))
  if (!tarball) throw new Error('pnpm pack did not produce a tarball')
  const version = pnpmVersion()
  writeJson(join(template, 'package.json'), {
    name: 'environment-fixture', version: '1.0.0', private: true, type: 'commonjs',
    packageManager: `pnpm@${version}`,
    dependencies: { 'env-dep': `file:vendor/${tarball}` },
    scripts: {
      postinstall: "node -e \"require('fs').writeFileSync('postinstall-ran','yes')\"",
      test: 'node --test',
    },
  })
  writeFileSync(join(template, 'smoke.test.cjs'), [
    "const test = require('node:test')",
    "const assert = require('node:assert/strict')",
    "test('local dependency resolves', () => { assert.equal(require('env-dep')(), 'dep-ok') })",
    '',
  ].join('\n'))
  const store = join(root, 'store')
  execFileSync('pnpm', ['install', '--offline', '--ignore-scripts', '--store-dir', store], { cwd: template, stdio: 'ignore' })
  if (!existsSync(join(template, 'pnpm-lock.yaml'))) throw new Error('offline fixture lock was not generated')
  rmSync(join(template, 'node_modules'), { recursive: true, force: true })
  return { root, template, store, version }
}

/** Copies a fixture into project/workspace siblings and initializes the original project as a git repo. */
export function copies(fixture: PnpmFixture): { project: string; workspace: string } {
  const project = join(fixture.root, 'project')
  const workspace = join(fixture.root, 'workspace')
  cpSync(fixture.template, project, { recursive: true })
  cpSync(fixture.template, workspace, { recursive: true })
  for (const directory of [project, workspace]) {
    execFileSync('git', ['init', '-q'], { cwd: directory })
    execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: directory })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: directory })
    execFileSync('git', ['add', '.'], { cwd: directory })
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: directory })
  }
  return { project, workspace }
}

export function input(
  projectPath: string,
  workspacePath: string,
  policy: PreparationPolicy,
  overrides: Partial<EnvironmentPreparationInput> = {},
): EnvironmentPreparationInput {
  return {
    projectPath, workspacePath, requestId: 'request-1', policy,
    signal: new AbortController().signal,
    ...overrides,
  }
}

export function runNodeTest(workspace: string, environment: Readonly<Record<string, string>>): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['--test'], { cwd: workspace, env: { ...environment }, encoding: 'utf8', timeout: 30_000 })
}

export function projectState(project: string): { status: string; files: string; index: string } {
  return {
    status: execFileSync('git', ['status', '--porcelain=v1'], { cwd: project, encoding: 'utf8' }),
    files: execFileSync('git', ['ls-files', '-z'], { cwd: project, encoding: 'utf8' }),
    index: readFileSync(join(project, '.git', 'index')).toString('base64'),
  }
}

export function writeFakeManager(path: string, version: string, mode: 'sleep' | 'offline-error' | 'flood' | 'probe-sleep' | 'disk'): string {
  const pidFile = join(path, '..', 'fake-manager.pid')
  const header = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi
`
  const body = mode === 'sleep'
    ? `${header}echo $$ > ${JSON.stringify(pidFile)}
mkdir -p node_modules/fake .product-environment
trap '' TERM
sleep 30
`
    : mode === 'probe-sleep'
      ? `#!/bin/sh
if [ "$1" = "--version" ]; then sleep 30; fi
exit 1
`
      : mode === 'disk'
        ? `${header}echo $$ > ${JSON.stringify(pidFile)}
mkdir -p node_modules/big .product-environment
head -c 500000 /dev/zero > node_modules/big/file
trap '' TERM
sleep 30
`
        : mode === 'flood'
          ? `${header}echo $$ > ${JSON.stringify(pidFile)}
mkdir -p node_modules/fake .product-environment
trap '' TERM
yes "flood-output-line-for-the-environment-output-limit"
`
          : `${header}mkdir -p .product-environment
echo "ERR_PNPM_NO_OFFLINE_META No metadata for package" >&2
exit 1
`
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return pidFile
}

export function clean(...paths: string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true })
}
