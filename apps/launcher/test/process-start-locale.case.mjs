import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import * as instance from '../lib/instance.mjs'
import { stopInstance } from '../lib/stop.mjs'

const weeks = ['日', '一', '二', '三', '四', '五', '六']
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function chinese(marker) {
  const [week, month, day, time, year] = marker.trim().split(/\s+/)
  return weeks[weekdays.indexOf(week)] + ' ' + (months.indexOf(month) + 1) + '月/' + day + ' ' + time + ' ' + year
}
async function localBirth() {
  const previous = process.env.LC_ALL
  try { process.env.LC_ALL = 'C'; return await instance.processStart(process.pid) }
  finally { if (previous === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = previous }
}
function ownRecord(marker, state) {
  return { protocol: 'personal-product-instance/1', pid: process.pid, processStart: marker,
    apiPid: process.pid, consolePid: process.pid, apiProcessStart: marker,
    apiUid: process.getuid(), launcherArgv: [...process.argv], launcherCwd: process.cwd(),
    apiArgv: ['/not-the-real-node', '/not-the-real-coordinator'],
    apiURL: 'http://127.0.0.1:65001', consoleURL: 'http://127.0.0.1:65002',
    state, install: process.cwd(), buildId: 'locale-regression', mode: 'personal',
    access: 'local-development', startupMode: 'normal', startedAt: new Date().toISOString() }
}
function noNetwork(t) {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'ok', mode: 'personal', startupMode: 'normal' }))
  t.after(() => { globalThis.fetch = original })
}

test('same actual PID birth observation is independent of Terminal locale', async () => {
  const previous = process.env.LC_ALL
  try {
    process.env.LC_ALL = 'C'; const english = await instance.processStart(process.pid)
    process.env.LC_ALL = 'zh_CN.UTF-8'; const fromChineseTerminal = await instance.processStart(process.pid)
    assert.ok(english)
    assert.equal(fromChineseTerminal, english)
    assert.match(fromChineseTerminal, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) /)
  } finally { if (previous === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = previous }
})

test('legacy English and observed Chinese markers denote exactly the same validated birth', () => {
  assert.equal(typeof instance.sameProcessStart, 'function')
  assert.equal(instance.sameProcessStart('Fri Nov 20 16:19:06 2026', '五 11月/20 16:19:06 2026'), true)
  assert.equal(instance.sameProcessStart('五 11月/20 16:19:07 2026', 'Fri Nov 20 16:19:07 2026'), true)
  assert.equal(instance.sameProcessStart('Fri Nov 20 16:19:06 2026', 'Fri Nov 20 16:19:07 2026'), false)
  assert.equal(instance.sameProcessStart('Fri Nov 20 16:19:06 2026', '五 11月/21 16:19:06 2026'), false)
})

test('birth equivalence refuses unknown, malformed and impossible markers instead of waiving identity', () => {
  for (const marker of [null, undefined, '', 'unavailable', 'five November', '五 13月/20 16:19:06 2026',
    '五 11月/20 24:19:06 2026', 'Fri Nov 31 16:19:06 2026', 'Fri Nov 20 16:19:06 2026 extra']) {
    assert.equal(instance.sameProcessStart(marker, marker), false, String(marker))
  }
  assert.equal(instance.sameProcessStart('Fri Nov 20 16:19:06 2026', '六 11月/20 16:19:06 2026'), false)
})

test('actual instance birth gates accept a legacy Chinese marker but retain the other failing guards', async t => {
  noNetwork(t)
  const record = ownRecord(chinese(await localBirth()), '/tmp/locale-readonly-nonexistent-state')
  const result = await instance.verifyInstance(record)
  assert.equal(result.checks.find(check => check.id === 'process_start').ok, true)
  assert.equal(result.checks.find(check => check.id === 'api_process_start').ok, true)
  assert.equal(result.ok, false)
  assert.ok(result.failures.includes('api_argv'))
})

test('actual coordinator birth gate supports legacy Chinese without accepting wrong argv', async () => {
  const record = ownRecord(chinese(await localBirth()), '/tmp/locale-readonly-nonexistent-state')
  const result = await instance.verifyCoordinatorProcess(record)
  assert.equal(result.checks.find(check => check.id === 'api_process_start').ok, true)
  assert.equal(result.ok, false)
  assert.ok(result.failures.includes('api_argv'))
})

for (const changed of [false, true]) test('stop prevalidation ' + (changed ? 'refuses a changed birth' : 'passes locale equivalence, then refuses wrong identity') + ' before any signal', async t => {
  noNetwork(t)
  const root = mkdtempSync(join(tmpdir(), 'pa-locale-stop-'))
  const roots = { install: process.cwd(), config: join(root, 'config'), data: join(root, 'data'),
    cache: join(root, 'cache'), logs: join(root, 'logs'), workspace: join(root, 'workspaces') }
  for (const path of Object.values(roots).filter(path => path !== process.cwd())) mkdirSync(path)
  const actualBirth = await localBirth()
  const marker = changed ? actualBirth.replace(/(\d{2}:\d{2}:)(\d{2})/, (_all, prefix, seconds) =>
    prefix + String((Number(seconds) + 1) % 60).padStart(2, '0')) : chinese(actualBirth)
  instance.writeInstanceRecord(roots.config, ownRecord(marker, roots.data))
  const originalKill = process.kill, signals = []
  process.kill = (pid, signal) => {
    if (signal !== 0) { signals.push({ pid, signal }); throw new Error('Regression must not signal any process') }
    return originalKill(pid, signal)
  }
  try {
    const result = await stopInstance({ roots })
    assert.equal(result.ok, false)
    assert.equal(result.code, changed ? 'unknown_live_resource' : 'instance_identity_mismatch')
    assert.deepEqual(signals, [])
    assert.ok(instance.readInstanceRecord(roots.config))
  } finally { process.kill = originalKill; rmSync(root, { recursive: true, force: true }) }
})
