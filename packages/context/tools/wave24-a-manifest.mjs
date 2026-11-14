#!/usr/bin/env node
/**
 * C-side invocation of A's actual data-manifest producer/verifier. The A source file and Git
 * identity are recorded in the output; this script does not reimplement the manifest logic.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({ options: {
  'a-module': { type: 'string' }, 'a-worktree': { type: 'string' }, db: { type: 'string' }, expectation: { type: 'string' },
  manifest: { type: 'string' }, output: { type: 'string' }, mode: { type: 'string' }, 'a-head': { type: 'string' },
} })
const absolute = (name) => { const value = values[name]; if (!value || !isAbsolute(value)) throw new Error(`--${name} must be absolute`); return resolve(value) }
const modulePath = absolute('a-module'), database = absolute('db'), expectationPath = absolute('expectation')
const mode = values.mode ?? 'build'
const moduleSha = createHash('sha256').update(readFileSync(modulePath)).digest('hex')
const aRoot = absolute('a-worktree')
const storagePath = resolve(aRoot, 'packages/storage/dist/index.js')
const { ProductStore } = await import(pathToFileURL(storagePath).href)
const { buildDataManifest, verifyDataManifest } = await import(pathToFileURL(modulePath).href)
const store = new ProductStore({ path: database })
try {
  const expectation = JSON.parse(readFileSync(expectationPath, 'utf8'))
  if (mode === 'build') {
    const manifest = await buildDataManifest(store, expectation)
    const output = absolute('output')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    process.stdout.write(JSON.stringify({ protocol: 'wave24-a-producer-invocation/1', status: 'ok', pid: process.pid,
      aModule: modulePath, aModuleSha256: moduleSha, aHead: values['a-head'] ?? null, output, manifest }) + '\n')
  } else if (mode === 'verify') {
    const manifest = JSON.parse(readFileSync(absolute('manifest'), 'utf8'))
    const verification = await verifyDataManifest(store, manifest, expectation)
    process.stdout.write(JSON.stringify({ protocol: 'wave24-a-producer-invocation/1', status: 'ok', pid: process.pid,
      aModule: modulePath, aModuleSha256: moduleSha, aHead: values['a-head'] ?? null, verification }) + '\n')
  } else throw new Error('--mode must be build or verify')
} finally { store.close() }
