#!/usr/bin/env node
/**
 * Bounded child probe for D's managed upgrade. It is a separate process so a hang in the shipped
 * launcher cannot stall the whole acceptance suite; the parent kills it at a fixed deadline and
 * records BLOCKED instead of waiting forever.
 *
 * Inputs come from PA_E_MANAGED_PAIR (baseline/target tar tuples). It prints one JSON line.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const pair = JSON.parse(process.env.PA_E_MANAGED_PAIR ?? '{}')
const ports = JSON.parse(process.env.PA_E_MANAGED_PORTS ?? '[]')
const basePorts = ports.slice(0, 4)
const rollbackPorts = ports.slice(4, 6)
const crossCheck = process.env.PA_E_CROSS_CHECK === '1'
const result = { protocol: 'e4-managed-upgrade-child/1', steps: [], ok: false }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const w = realpathSync(mkdtempSync(join(tmpdir(), 'pa-e-managed-')))
const target = join(w, 'target')
const baseline = join(w, 'baseline')
const roots = { config: join(w, 'cfg'), data: join(w, 'data'), cache: join(w, 'cache'), logs: join(w, 'logs'), workspace: join(w, 'ws') }
const rootArgs = ['--config-root', roots.config, '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
const env = { ...process.env, PA_CONFIG_ROOT: roots.config, PA_DATA_ROOT: roots.data, PA_CACHE_ROOT: roots.cache, PA_LOGS_ROOT: roots.logs, PA_WORKSPACE_ROOT: roots.workspace }
let running
const cleanup = () => {
  try { spawnSync(join(target, 'bin/pa'), ['stop', '--json', ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 20_000 }) } catch { /* best effort */ }
  try { spawnSync(join(baseline, 'bin/pa'), ['stop', '--json', ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 20_000 }) } catch { /* best effort */ }
}
const start = (install, port, apiPort) => {
  const child = spawn(join(install, 'bin/pa'), ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort), ...rootArgs], { cwd: w, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let buffer = ''
  child.stdout.on('data', (chunk) => { buffer += chunk })
  return new Promise((resolve) => {
    const deadline = Date.now() + 40_000
    const finish = () => {
      try { return resolve({ child, value: JSON.parse(buffer.trim()) }) } catch { /* multi-line fallback */ }
      try { return resolve({ child, value: JSON.parse(buffer.trim().split('\n').filter(Boolean).at(-1)) }) } catch { return resolve({ child, value: undefined }) }
    }
    child.once('exit', finish)
    const poll = () => {
      const line = buffer.split('\n').find((item) => item.trim().startsWith('{'))
      if (line) { try { return resolve({ child, value: JSON.parse(line) }) } catch { /* keep */ } }
      if (Date.now() > deadline) return finish()
      setTimeout(poll, 120)
    }
    poll()
  })
}
const health = async (url, attempts = 20) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return await response.json()
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return undefined
}
const chat = async (apiURL, text) => {
  const key = readFileSync(join(roots.data, 'api.key'), 'utf8').trim()
  const response = await fetch(`${apiURL}/v1/commands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: `managed-${Date.now()}`, conversationId: 'conv-managed', kind: 'chat', projectId: 'project-atlas', text }),
    signal: AbortSignal.timeout(10_000),
  })
  return { status: response.status, body: await response.text() }
}
const schema = () => {
  try {
    const db = new DatabaseSync(join(roots.data, 'state.sqlite'), { readOnly: true })
    try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value) } finally { db.close() }
  } catch { return null }
}
const hasMessage = (needle) => {
  try {
    const db = new DatabaseSync(join(roots.data, 'state.sqlite'), { readOnly: true })
    try { return db.prepare('select count(*) as c from conversation_messages where value like ?').get(`%${needle}%`).c > 0 } finally { db.close() }
  } catch { return false }
}

try {
  mkdirSync(target, { recursive: true }); mkdirSync(baseline, { recursive: true })
  spawnSync('tar', ['-xzf', pair.target.tarPath, '-C', target, '--strip-components=1'])
  spawnSync('tar', ['-xzf', pair.baseline.tarPath, '-C', baseline, '--strip-components=1'])
  for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })

  const bootstrap = spawnSync(process.execPath, [join(target, 'app/apps/launcher/bin/pa.mjs'), 'first-run', '--json', '--install', join(baseline, 'app'), ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 60_000 })
  const bootstrapJson = (() => { try { return JSON.parse(bootstrap.stdout) } catch { return undefined } })()
  step('bootstrap', bootstrapJson?.release?.buildId === pair.baseline.buildId ? 'PASS' : 'FAIL', bootstrapJson?.release?.buildId ?? bootstrap.stderr.slice(-200))
  result.bootstrap = bootstrapJson?.release?.buildId ?? null

  const base = await start(baseline, basePorts[0] ?? 5571, basePorts[1] ?? 8971)
  running = base
  const baseHealth = await health(`http://127.0.0.1:${basePorts[1] ?? 8971}`)
  step('baseline_start', base.value?.status === 'RUNNING' && baseHealth?.status === 'ok' ? 'PASS' : 'FAIL', JSON.stringify({ value: base.value?.status, health: baseHealth?.status }))
  result.baseline = base.value?.instance?.buildId ?? null
  await chat(`http://127.0.0.1:${basePorts[1] ?? 8971}`, '托管升级前的数据')

  const upgrade = spawnSync(join(target, 'bin/pa'), ['upgrade', '--json', ...rootArgs, '--to', target, '--backup', join(w, 'pre.pab')], { cwd: w, env, encoding: 'utf8', timeout: 120_000 })
  const upgradeJson = (() => { try { return JSON.parse(upgrade.stdout) } catch { return undefined } })()
  step('upgrade', upgradeJson?.status === 'CONFIRMED' ? 'PASS' : 'FAIL', JSON.stringify({ status: upgradeJson?.status, code: upgradeJson?.code ?? null, from: upgradeJson?.plan?.from?.buildId, to: upgradeJson?.plan?.to?.buildId }))
  result.upgrade = upgradeJson ? { status: upgradeJson.status, from: upgradeJson.plan?.from?.buildId, to: upgradeJson.plan?.to?.buildId, started: upgradeJson.started?.buildId, backup: upgradeJson.backup?.path, code: upgradeJson.code } : null

  if (upgradeJson?.status === 'CONFIRMED') {
    const apiURL = upgradeJson.started.apiURL
    const upgradedHealth = await health(apiURL)
    step('upgraded_health', upgradedHealth?.status === 'ok' ? 'PASS' : 'FAIL', upgradedHealth?.status ?? 'none')
    const post = await chat(apiURL, '托管升级后的新数据')
    step('post_upgrade_write', post.status === 200 && post.body.includes('"status":"recorded"') ? 'PASS' : 'FAIL', String(post.status))
    result.health = upgradedHealth?.status ?? null
    result.schema = schema()
    result.postKept = hasMessage('托管升级后的新数据')

    // Tamper a copy and require target_tampered without touching the running instance.
    const tampered = join(w, 'tampered-target')
    spawnSync('cp', ['-R', target, tampered])
    const release = JSON.parse(readFileSync(join(tampered, 'var/config/release.json'), 'utf8'))
    const victim = join(tampered, 'app', release.artifacts.find((item) => item.path.endsWith('.js')).path)
    const bytes = Buffer.from(readFileSync(victim)); bytes[bytes.length - 1] ^= 0xff; writeFileSync(victim, bytes)
    const tamperedUpgrade = spawnSync(join(target, 'bin/pa'), ['upgrade', '--json', ...rootArgs, '--to', tampered, '--backup', join(w, 'tampered.pab')], { cwd: w, env, encoding: 'utf8', timeout: 60_000 })
    const tamperedJson = (() => { try { return JSON.parse(tamperedUpgrade.stdout) } catch { return undefined } })()
    result.tampered = { code: tamperedJson?.code ?? null, exit: tamperedUpgrade.status }
    step('tampered_target', tamperedJson?.code === 'target_tampered' ? 'PASS' : 'FAIL', JSON.stringify(result.tampered))

    spawnSync(join(target, 'bin/pa'), ['stop', '--json', ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 30_000 })
    const rollback = spawnSync(join(target, 'bin/pa'), ['rollback-install', '--json', ...rootArgs], { cwd: w, env, encoding: 'utf8', timeout: 60_000 })
    const rollbackJson = (() => { try { return JSON.parse(rollback.stdout) } catch { return undefined } })()
    result.rollback = rollbackJson ? { status: rollbackJson.status, from: rollbackJson.from, to: rollbackJson.to, dataRolledBack: rollbackJson.dataRolledBack } : null
    step('rollback_install', rollbackJson?.status === 'BINARY_ROLLED_BACK' && rollbackJson?.dataRolledBack === false ? 'PASS' : 'FAIL', JSON.stringify(result.rollback))
    if (crossCheck && pair.baseline.productSchema < pair.target.productSchema) {
      // Pointer is back on the older binary; its start must now fail on the newer schema, not on assets.
      const oldOnNew = await start(baseline, rollbackPorts[0] ?? 5582, rollbackPorts[1] ?? 8982)
      const refused = oldOnNew.value
      result.crossSchema = {
        baselineSchema: pair.baseline.productSchema,
        targetSchema: pair.target.productSchema,
        status: refused?.status ?? null,
        code: refused?.code ?? null,
        migrationRefusal: /MigrationIntegrityError|Applied migration|is not registered|schema/.test(JSON.stringify(refused?.detail ?? {})),
        dataSchema: schema(),
      }
      step('cross_schema_refusal', refused?.status === 'BLOCKED' && ['daemon_start_failed', 'schema_unsupported', 'runtime_mismatch', 'state_schema_newer_than_binary'].includes(refused?.code) && result.crossSchema.dataSchema === pair.target.productSchema ? 'PASS' : 'FAIL', JSON.stringify(result.crossSchema))
      try { oldOnNew.child.kill('SIGKILL') } catch { /* gone */ }
      result.ok = result.steps.every((item) => item.status === 'PASS')
      throw Object.assign(new Error('cross_schema_probe_done'), { crossDone: true })
    }
    const base2 = await start(baseline, rollbackPorts[0] ?? 5572, rollbackPorts[1] ?? 8972)
    running = base2
    const base2Health = await health(`http://127.0.0.1:${rollbackPorts[1] ?? 8972}`)
    result.rollbackBuild = base2.value?.instance?.buildId ?? null
    result.rollbackKeptPost = hasMessage('托管升级后的新数据')
    step('rollback_start', base2.value?.status === 'RUNNING' && base2Health?.status === 'ok' && result.rollbackBuild === pair.baseline.buildId ? 'PASS' : 'FAIL', JSON.stringify({ build: result.rollbackBuild, health: base2Health?.status }))
  }
  result.ok = result.steps.every((item) => item.status === 'PASS')
} catch (error) {
  if (error?.crossDone !== true) result.error = String(error?.message ?? error).slice(0, 500)
} finally {
  cleanup()
  try { running?.child?.kill('SIGKILL') } catch { /* gone */ }
}
process.stdout.write(`${JSON.stringify(result)}\n`)
process.exit(0)
