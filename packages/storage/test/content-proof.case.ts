/** Wave-26 A2/A14: content proof covers durable rows, omits only documented runtime tables, and bounds work. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { readWorkflowContent } from '../src/content-proof.ts'

test('content proof changes with durable rows, ignores root-local runtime tables and stops at its limits', () => {
  const root = mkdtempSync(join(tmpdir(), 'wave26-content-')), path = join(root, 'state.sqlite')
  const database = new Database(path)
  try {
    database.pragma('user_version = 18')
    database.exec('CREATE TABLE alpha (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    database.exec('CREATE TABLE writer_claim (id INTEGER PRIMARY KEY CHECK (id = 1), nonce TEXT NOT NULL)')
    database.exec('CREATE TABLE coordinator_instances (nonce TEXT PRIMARY KEY, heartbeat_at TEXT NOT NULL)')
    database.prepare('INSERT INTO alpha (id, value) VALUES (1, ?)').run('one')
    database.prepare('INSERT INTO alpha (id, value) VALUES (2, ?)').run('two')
  } finally { database.close() }
  try {
    const base = readWorkflowContent(path)
    assert.equal(base.complete, true); assert.equal(base.productSchema, 18); assert.ok(base.digest); assert.equal(base.rows, 2)
    const runtime = new Database(path)
    try {
      runtime.prepare('INSERT INTO writer_claim (id, nonce) VALUES (1, ?)').run('other-root-nonce')
      runtime.prepare('INSERT INTO coordinator_instances (nonce, heartbeat_at) VALUES (?, ?)').run('instance', new Date().toISOString())
    } finally { runtime.close() }
    const afterRuntime = readWorkflowContent(path)
    assert.equal(afterRuntime.digest, base.digest)
    const change = new Database(path)
    try { change.prepare('UPDATE alpha SET value = ? WHERE id = 2').run('changed'); change.exec('CREATE TABLE extra_business (id TEXT PRIMARY KEY)') } finally { change.close() }
    const afterChange = readWorkflowContent(path)
    assert.notEqual(afterChange.digest, base.digest)
    const capped = readWorkflowContent(path, { limits: { maxRows: 1 } })
    assert.equal(capped.complete, false); assert.equal(capped.digest, null); assert.match(capped.reason ?? '', /limit/)
    const missing = readWorkflowContent(join(root, 'missing.sqlite'))
    assert.equal(missing.complete, false); assert.equal(missing.digest, null)
    console.log('WAVE26_CONTENT_PROOF', JSON.stringify({ baseDigest: base.digest, omitted: base.omittedTables,
      rows: base.rows, capped: capped.reason, missing: missing.reason }))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
