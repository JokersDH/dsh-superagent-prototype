/**
 * The same-version hand-off: one deterministic description of contracts, catalog and vocabulary.
 * D/E can compare it between the reviewed source and the installed artifact; it grants nothing.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  MODULE_PROTOCOL,
  RECIPE_ISSUE_CODES,
  RECIPE_KINDS,
  catalogDigest,
  describeProjectRecipes,
} from '../src/index.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('the module description is deterministic and matches the code it describes', () => {
  const first = describeProjectRecipes()
  assert.deepEqual(first, describeProjectRecipes())
  assert.equal(first.protocol, MODULE_PROTOCOL)
  assert.equal(first.catalog.digest, catalogDigest())
  assert.deepEqual([...first.kinds], [...RECIPE_KINDS])
  assert.deepEqual([...first.issueCodes], [...RECIPE_ISSUE_CODES])
  assert.deepEqual([...first.configurationProtocols], ['application-configuration/1'])
  assert.equal(first.authority, 'none')
  for (const capability of ['match', 'preview-fields', 'observe', 'rebind', 'describe'])
    assert.ok([...first.capabilities].includes(capability), capability)
  for (const value of Object.values(first.protocols)) assert.ok(value.length > 0)
})

test('the reported version is the package version, not a guess', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  assert.equal(describeProjectRecipes().version, pkg.version)
})

test('the description carries no path, credential or authority field', () => {
  const text = JSON.stringify(describeProjectRecipes())
  for (const forbidden of ['/Users/', 'allowedPaths', 'token', 'credential', 'grant'])
    assert.equal(text.includes(forbidden), false, forbidden)
  assert.equal(text.includes(root), false)
})
