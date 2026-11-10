#!/usr/bin/env node
/**
 * Rebuilds two offline pnpm recipes with local tarball dependencies only. No registry/network access
 * is used; node_modules is removed afterwards so the environment-preparation module performs the
 * frozen offline install. Usage: node build-recipes.mjs --out <empty directory>
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { out: { type: 'string' }, force: { type: 'boolean', default: false } } })
if (!values.out) throw new Error('--out is required')
const out = resolve(values.out)
if (values.force) rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: false })
const home = join(out, 'pnpm-home')
mkdirSync(home)
const env = {
  ...process.env, HOME: home, COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  COREPACK_HOME: process.env.COREPACK_HOME ?? join(process.env.HOME ?? home, '.cache/node/corepack'),
}
const pnpm = (args, cwd) => execFileSync('pnpm', args, { cwd: cwd ?? out, env, stdio: 'ignore' })
const pnpmVersion = execFileSync('pnpm', ['--version'], { env, encoding: 'utf8' }).trim()

function dependency(name, version, body) {
  const directory = join(out, 'sources', name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }) + '\n')
  writeFileSync(join(directory, 'index.js'), body)
  return directory
}
const dep = dependency('env-dep', '1.0.0', 'module.exports = () => "dep-ok"\n')
const devDep = dependency('env-dev-dep', '1.0.0', 'module.exports = () => "dev-ok"\n')

function pack(source, vendor) {
  const destination = join(vendor)
  mkdirSync(destination, { recursive: true })
  pnpm(['pack', '--pack-destination', destination], source)
  const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  const expected = `${metadata.name}-${metadata.version}.tgz`
  const file = readdirSync(destination).find(name => name === expected)
    ?? readdirSync(destination).find(name => name.startsWith(`${metadata.name}-`) && name.endsWith('.tgz'))
  if (!file) throw new Error(`pack failed for ${source}`)
  return file
}

function recipe(name, tarballs, testSource, extra = {}) {
  const directory = join(out, name)
  mkdirSync(directory, { recursive: true })
  const vendor = join(directory, 'vendor')
  const files = tarballs.map(([packageName, source]) => [packageName, pack(source, vendor)])
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: `recipe-${name}`, version: '1.0.0', private: true, type: 'commonjs',
    packageManager: `pnpm@${pnpmVersion}`,
    dependencies: Object.fromEntries(files.slice(0, 1).map(([packageName, file]) => [packageName, `file:vendor/${file}`])),
    ...(files.length > 1 ? { devDependencies: Object.fromEntries(files.slice(1).map(([packageName, file]) => [packageName, `file:vendor/${file}`])) } : {}),
    scripts: { test: 'node --test', ...(extra.scripts ?? {}) },
  }, null, 2) + '\n')
  writeFileSync(join(directory, 'smoke.test.cjs'), testSource)
  if (extra.build) writeFileSync(join(directory, 'build.mjs'), extra.build)
  pnpm(['install', '--offline', '--ignore-scripts', '--store-dir', join(out, 'store')], directory)
  if (!exists(join(directory, 'pnpm-lock.yaml'))) throw new Error('lock was not generated')
  rmSync(join(directory, 'node_modules'), { recursive: true, force: true })
  return directory
}

function exists(path) { try { readFileSync(path); return true } catch { return false } }

const plain = recipe('plain-js', [['env-dep', dep]], [
  "const test = require('node:test')",
  "const assert = require('node:assert/strict')",
  "test('plain js dependency', () => { assert.equal(require('env-dep')(), 'dep-ok') })",
  '',
].join('\n'))
const dev = recipe('dev-deps', [['env-dep', dep], ['env-dev-dep', devDep]], [
  "const test = require('node:test')",
  "const assert = require('node:assert/strict')",
  "const dep = require('env-dep')",
  "const devDep = require('env-dev-dep')",
  "test('runtime and dev dependencies resolve', () => { assert.equal(dep(), 'dep-ok'); assert.equal(devDep(), 'dev-ok') })",
  "test('build output exists', () => { assert.match(require('node:fs').readFileSync('build-output.txt', 'utf8'), /built/) })",
  '',
].join('\n'), {
  scripts: { build: 'node build.mjs' },
  build: "import { writeFileSync } from 'node:fs'\nwriteFileSync('build-output.txt', 'built by recipe\\n')\n",
})
execFileSync(process.execPath, ['build.mjs'], { cwd: dev, env })
console.log(JSON.stringify({ status: 'RECIPES_BUILT', out, store: join(out, 'store'), pnpmVersion, recipes: { plain, dev } }, null, 2))
