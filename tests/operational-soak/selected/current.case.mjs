/**
 * Current-source consumer controls: exact committed I/B, fresh-intent fix, current B sink guard
 * (missing/deny/throw refused, fresh allow), wrong root/commit refusal and materialized-byte tamper detection.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { verifyMaterializedTree } from './source2.mjs'

const PRODUCE = join(import.meta.dirname, 'produce2.mjs')

function run(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [PRODUCE, ...args], { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolvePromise({ status: code, stdout, stderr }))
  })
}

test('current committed I/B run: fresh intent fixed, B sink guard closed, source unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-current-'))
  const out = join(root, 'run')
  try {
    const produced = await run(['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const source = JSON.parse(readFileSync(join(out, 'source.json'), 'utf8'))
    assert.equal(source.ok, true)
    assert.ok(source.bindings.I.commit)
    assert.ok(source.bindings.B.commit)
    assert.equal(source.bindings.I.branch, 'codex/g5-coordinator-channel')
    assert.equal(source.bindings.B.branch, 'codex/g1-runtime')

    const i = JSON.parse(readFileSync(join(out, 'i.json'), 'utf8'))
    assert.equal(Object.values(i.checks).every(Boolean), true, JSON.stringify(i.checks))
    assert.equal(i.checks.freshIntentFixed, true)
    assert.equal(i.checks.queueNamespace, true)
    assert.equal(i.checks.timeoutPrune, true)

    const b = JSON.parse(readFileSync(join(out, 'b.json'), 'utf8'))
    assert.equal(Object.values(b.checks).every(Boolean), true, JSON.stringify(b.checks))
    assert.equal(b.checks.sinkMissingGuardRefused, true)
    assert.equal(b.checks.sinkDenyRefused, true)
    assert.equal(b.checks.sinkAllowFresh, true)
    assert.equal(b.findings.length, 0)

    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.signalsSent, 0)
    assert.equal(report.findings.length, 0)
    assert.ok(report.notReached.some((entry) => entry.includes('SIGKILL')))
    assert.ok(!readFileSync(join(out, 'report.json'), 'utf8').includes(process.env.HOME ?? '/Users/'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('wrong root or invalid commit refuses before consumers run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-current-wrong-'))
  try {
    const wrongRoot = await run(['--out', join(root, 'a'), '--i-root', '/Users/hh/Desktop/joker/superagent-agent-b'])
    assert.equal(wrongRoot.status, 2)
    assert.match(wrongRoot.stderr, /REFUSED current source/)
    assert.equal(existsSync(join(root, 'a', 'i.json')), false)

    const badCommit = await run(['--out', join(root, 'b'), '--i-commit', 'f'.repeat(40)])
    assert.equal(badCommit.status, 2)
    assert.equal(existsSync(join(root, 'b', 'i.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('materialized bytes are re-checked against the selected commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-current-tamper-'))
  const out = join(root, 'run')
  try {
    const produced = await run(['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const materialized = JSON.parse(readFileSync(join(out, 'materialized.json'), 'utf8'))
    const selected = materialized.I.verify.files[0]
    const tree = { dest: join(out, 'source', 'I') }
    const okCheck = verifyMaterializedTree(tree, { [selected.rel]: selected.sha256 })
    assert.equal(okCheck.ok, true)
    const target = join(tree.dest, selected.rel)
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n// tampered\n`)
    const tampered = verifyMaterializedTree(tree, { [selected.rel]: selected.sha256 })
    assert.equal(tampered.ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
