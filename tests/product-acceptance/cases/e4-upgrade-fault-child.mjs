#!/usr/bin/env node
/** Bounded pre-switch upgrade fault probe; only operates on its own extracted installs/roots. */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const pair = JSON.parse(process.env.PA_E_FAULT_PAIR ?? '{}')
const ports = JSON.parse(process.env.PA_E_FAULT_PORTS ?? '[]')
const mode = process.env.PA_E_FAULT_MODE ?? 'crash_after_stop'
const w = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w14-fault-')))
const target = join(w, 'target'), baseline = join(w, 'baseline')
const roots = { config: join(w, 'cfg'), data: join(w, 'data'), cache: join(w, 'cache'), logs: join(w, 'logs'), workspace: join(w, 'ws') }
const rootArgs = ['--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const env = { ...process.env, PA_CONFIG_ROOT: roots.config, PA_DATA_ROOT: roots.data, PA_CACHE_ROOT: roots.cache, PA_LOGS_ROOT: roots.logs, PA_WORKSPACE_ROOT: roots.workspace }
const result = { protocol: 'e4-upgrade-fault-child/1', mode, steps: [], ok: false }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const parse = text => {
  const raw = String(text ?? '').trim()
  try { return JSON.parse(raw) } catch {}
  for (const line of raw.split('\n').filter(Boolean).reverse()) { try { return JSON.parse(line) } catch {} }
}
const start = (install, port, apiPort) => {
  const child = spawn(join(install, 'bin/pa'), ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort), ...rootArgs], { cwd: w, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  child.stdout.on('data', chunk => { buffer += chunk })
  return new Promise(resolve => {
    const deadline = Date.now() + 40_000
    const poll = () => {
      const value = parse(buffer)
      if (value) return resolve({ child, value })
      if (Date.now() > deadline) return resolve({ child, value: undefined })
      setTimeout(poll, 120)
    }
    poll()
  })
}
const health = async url => {
  for (let i = 0; i < 20; i += 1) {
    try { const response = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(800) }); if (response.ok) return await response.json() } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  return undefined
}
const schema = () => {
  try { const db = new DatabaseSync(join(roots.data, 'state.sqlite'), { readOnly: true }); try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value) } finally { db.close() } } catch { return null }
}
const hasMessage = needle => {
  try { const db = new DatabaseSync(join(roots.data, 'state.sqlite'), { readOnly: true }); try { return db.prepare('select count(*) c from conversation_messages where value like ?').get(`%${needle}%`).c > 0 } finally { db.close() } } catch { return false }
}
const chat = async url => {
  try {
    const key = readFileSync(join(roots.data, 'api.key'), 'utf8').trim()
    const response = await fetch(`${url}/v1/commands`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ commandId: `fault-${Date.now()}`, conversationId: 'conv-fault', kind: 'chat', projectId: 'project-atlas', text: '故障前数据。' }), signal: AbortSignal.timeout(10_000) })
    return response.status
  } catch { return 0 }
}
let running
try {
  for (const dir of [target, baseline]) mkdirSync(dir, { recursive: true })
  spawnSync('tar', ['-xzf', pair.target.tarPath, '-C', target, '--strip-components=1'])
  spawnSync('tar', ['-xzf', pair.baseline.tarPath, '-C', baseline, '--strip-components=1'])
  for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const bootstrap = spawnSync(process.execPath, [join(target, 'app/apps/launcher/bin/pa.mjs'), 'first-run', '--json', '--install', join(baseline, 'app'), ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 60_000 })
  const bootstrapJson = parse(bootstrap.stdout)
  step('bootstrap', bootstrapJson?.release?.buildId === pair.baseline.buildId ? 'PASS' : 'FAIL', bootstrapJson?.release?.buildId ?? bootstrap.stderr.slice(-200))
  const base = await start(baseline, ports[0] ?? 5811, ports[1] ?? 9211)
  running = base
  const baseHealth = await health(`http://127.0.0.1:${ports[1] ?? 9211}`)
  step('baseline_start', base.value?.status === 'RUNNING' && baseHealth?.status === 'ok' ? 'PASS' : 'FAIL', JSON.stringify({ status: base.value?.status, health: baseHealth?.status }))
  step('seed', await chat(`http://127.0.0.1:${ports[1] ?? 9211}`) === 200 ? 'PASS' : 'FAIL')
  const fault = spawnSync(join(target, 'bin/pa'), ['upgrade', '--json', ...rootArgs, '--to', target, '--backup', join(w, 'pre.pab')], { cwd: w, env: { ...env, PA_UPGRADE_FAULT: mode }, encoding: 'utf8', timeout: 120_000 })
  const faultJson = parse(fault.stdout)
  result.fault = { exit: fault.status, status: faultJson?.status ?? null, code: faultJson?.code ?? null }
  const killed = mode.endsWith('_kill') && fault.signal === 'SIGKILL'
  step('fault_observed', (killed || (fault.status !== 0 && ['upgrade_interrupted', 'upgrade_target_unhealthy', 'upgrade_target_stop_unproven'].includes(faultJson?.code))) ? 'PASS' : 'FAIL', JSON.stringify({ ...result.fault, signal: fault.signal }))
  const recover = spawnSync(join(target, 'bin/pa'), ['upgrade', '--recover', '--json', ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 120_000 })
  const recoverJson = parse(recover.stdout)
  result.recover = { exit: recover.status, status: recoverJson?.status ?? null, code: recoverJson?.code ?? null, started: recoverJson?.started?.buildId ?? null }
  step('recover', (['RECOVERED_PREVIOUS', 'RECOVERED_TARGET', 'REVERTED', 'NO_OP'].includes(recoverJson?.status) || recover.status === 0) ? 'PASS' : 'FAIL', JSON.stringify(result.recover))
  let recoveredURL = recoverJson?.started?.apiURL
  let recoveredHealth = recoveredURL ? await health(recoveredURL) : undefined
  if (!recoveredHealth && ['RECOVERED_PREVIOUS', 'REVERTED', 'NO_OP'].includes(recoverJson?.status)) {
    const base2 = await start(baseline, ports[2] ?? 5812, ports[3] ?? 9212)
    running = base2
    recoveredURL = base2.value?.instance?.apiURL
    recoveredHealth = recoveredURL ? await health(recoveredURL) : undefined
  }
  result.schema = schema(); result.dataKept = hasMessage('故障前数据。')
  step('recovered_health', recoveredHealth?.status === 'ok' ? 'PASS' : 'NOT_TESTED', JSON.stringify({ url: recoveredURL ?? null, health: recoveredHealth?.status ?? null }))
  step('data_kept', result.dataKept ? 'PASS' : 'FAIL', String(result.dataKept))
  result.ok = result.steps.filter(item => item.status === 'FAIL').length === 0
} catch (error) {
  step('exception', 'FAIL', error.message)
} finally {
  try { spawnSync(join(target, 'bin/pa'), ['stop', '--json', ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 20_000 }) } catch {}
  try { spawnSync(join(baseline, 'bin/pa'), ['stop', '--json', ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 20_000 }) } catch {}
  try { running?.child?.kill('SIGKILL') } catch {}
}
writeFileSync(join(w, 'result.json'), JSON.stringify(result))
console.log(JSON.stringify(result))
