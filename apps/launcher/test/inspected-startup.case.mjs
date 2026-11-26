import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { hasInspectedNativeStartup } from '../lib/inspected-startup.mjs'

function fixture(t, source) {
  const root = mkdtempSync(join(tmpdir(), 'pa-inspected-receiver-')), install = join(root, 'install'), state = join(root, 'state')
  mkdirSync(install); mkdirSync(state); writeFileSync(join(install, 'package.json'), '{"type":"module"}')
  const product = join(install, 'apps/coordinator/product'); mkdirSync(product, { recursive: true })
  const entry = join(product, 'inspected-startup.ts')
  if (source !== undefined) writeFileSync(entry, source)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, install, state, product, entry, detect: () => hasInspectedNativeStartup({ installRoot: install, stateRoot: state }) }
}
const receiver = "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='inspected-native-startup/1'; export function prepareInspectedPersonalStartup(){ throw Error('detecting a feature must not invoke or authorize startup') }"

test('exact installed blocked-capable receiver can open its workbench without invoking native startup', async t => {
  const h = fixture(t, receiver)
  assert.equal(await h.detect(), true)
})

test('legacy install, wrong marker and non-callable startup preserve the legacy gate', async t => {
  for (const source of [undefined,
    "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='other/1'; export function prepareInspectedPersonalStartup(){}",
    "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='inspected-native-startup/1'; export const prepareInspectedPersonalStartup=true",
    "throw new Error('incomplete receiver dependency');"]) {
    const h = fixture(t, source)
    assert.equal(await h.detect(), false)
  }
})

test('selected restored source remains on the original readonly composition', async t => {
  const h = fixture(t, receiver)
  writeFileSync(join(h.state, 'restore-report.json'), '{"protocol":"personal-restore/1"}')
  assert.equal(await h.detect(), false)
})

test('receiver path cannot redirect detection to a symlink or another install', async t => {
  const h = fixture(t)
  const other = join(h.root, 'another-install.ts'); writeFileSync(other, receiver)
  symlinkSync(other, h.entry)
  assert.equal(await h.detect(), false)
  const nested = fixture(t)
  rmSync(nested.product, { recursive: true })
  const outside = join(nested.root, 'borrowed-product'); mkdirSync(outside); writeFileSync(join(outside, 'inspected-startup.ts'), receiver)
  symlinkSync(outside, nested.product, 'dir')
  assert.equal(await nested.detect(), false)
})
