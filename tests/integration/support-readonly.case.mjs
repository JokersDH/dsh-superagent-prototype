import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { supportBundle } from '../../apps/launcher/lib/support.mjs'

test('actual support consumer inspects an older nonempty database without migration or file changes', t => {
  const root = mkdtempSync(join(tmpdir(), 'pa-readonly-support-')), roots = {}
  for (const key of ['install', 'config', 'data', 'cache', 'logs', 'workspace']) {
    roots[key] = join(root, key); mkdirSync(roots[key], { mode: 0o700 })
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(roots.data, 'state.sqlite'), db = new DatabaseSync(file)
  db.exec('CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES (\'private-content-not-for-export\')'); db.close()
  const fingerprint = () => ({ files: readdirSync(roots.data).sort(), sha: createHash('sha256').update(readFileSync(file)).digest('hex') })
  const before = fingerprint(), result = supportBundle({ roots })
  assert.deepEqual(fingerprint(), before)
  assert.equal(result.state.database.integrity, 'ok'); assert.equal(result.state.database.schema, null)
  assert.equal(JSON.stringify(result).includes('private-content-not-for-export'), false)
  const readonly = new DatabaseSync(file, { readOnly: true })
  try { assert.deepEqual(readonly.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name), ['sentinel']) }
  finally { readonly.close() }
})
