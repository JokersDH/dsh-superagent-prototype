/** D9: the support bundle is whitelisted status/version/digests only, never content or argv. */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { supportBundle, writeSupportBundle } from '../lib/support.mjs'

const rootsFor = (root) => {
  const roots = { install: join(root, 'install'), config: join(root, 'config'), data: join(root, 'state'), cache: join(root, 'cache'), logs: join(root, 'logs'), workspace: join(root, 'workspace') }
  mkdirSync(join(roots.install, 'app'), { recursive: true })
  for (const name of ['config', 'data', 'cache', 'logs', 'workspace']) { mkdirSync(roots[name], { recursive: true, mode: 0o700 }); chmodSync(roots[name], 0o700) }
  return roots
}

test('support bundle redacts content, argv, keys and absolute roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'pa-support-'))
  try {
    const roots = rootsFor(root)
    writeFileSync(join(roots.config, 'instance.json'), JSON.stringify({
      protocol: 'personal-product-instance/1', pid: 12345, processStart: 'x', apiPid: 12346, consolePid: 12345,
      apiURL: 'http://127.0.0.1:45001', consoleURL: 'http://127.0.0.1:45002', state: roots.data, install: join(roots.install, 'app'),
      buildId: 'b1', mode: 'personal', access: 'local-development', startupMode: 'normal', startedAt: new Date().toISOString(),
      launcherArgv: ['/usr/bin/node', '/private/key/token-abc', '--api-key', 'sk-secret-value'],
    }), { mode: 0o600 })
    const bundle = supportBundle({ roots })
    const text = JSON.stringify(bundle)
    for (const forbidden of [root, 'token-abc', 'sk-secret-value', 'launcherArgv']) assert.equal(text.includes(forbidden), false, `bundle leaked ${forbidden}`)
    assert.equal(bundle.protocol, 'pa-support/1')
    assert.equal(bundle.instance.buildId, 'b1')
    assert.equal(bundle.instance.ports.api, 45001)
    assert.equal(bundle.redaction.included, false)
    const out = join(root, 'support.json')
    const written = writeSupportBundle({ roots, out })
    assert.equal(statSync(out).mode & 0o777, 0o600)
    assert.equal(written.digest.length, 64)
    assert.throws(() => writeSupportBundle({ roots, out }), /EEXIST/)
    assert.equal(existsSync(out), true)
    const parsed = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(parsed.roots.data.private, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
