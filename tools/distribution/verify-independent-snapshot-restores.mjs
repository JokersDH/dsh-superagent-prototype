#!/usr/bin/env node
/** Each snapshot format is materialized independently, bundled independently and restored by the package CLI. */
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'

const { values } = parseArgs({ options: { install: { type: 'string' }, business: { type: 'string' }, message: { type: 'string' }, project: { type: 'string', default: 'project-personal-dialogue' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-snapshot-restores-')); chmodSync(root, 0o700)
const result = { protocol: 'wave24-independent-snapshot-restores/1', status: 'FAIL', steps: [] }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...opts })
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
let seed = null
try {
  const install = resolve(values.install), business = resolve(values.business)
  const cli = join(install, 'bin/pa')
  const seedState = join(root, 'seed-state'); cpSync(business, seedState, { recursive: true }); chmodSync(seedState, 0o700)
  // Remove WAL sidecars from the read-only copy so SQLite sees a quiescent snapshot.
  for (const suffix of ['-wal', '-shm']) { try { rmSync(join(seedState, `state.sqlite${suffix}`)) } catch {} }
  const storage = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  const workflows = await import(pathToFileURL(join(install, 'app/packages/workflows/dist/index.js')).href)
  seed = new storage.ProductStore({ path: join(seedState, 'state.sqlite') })
  const snap = new workflows.WorkflowSnapshots(seed)
  const setup = join(root, 'setup'); mkdirSync(setup, { mode: 0o700 })
  const setupArgs = ['--install', install, '--config-root', join(setup, 'config'), '--data-root', join(setup, 'unused-state'), '--cache-root', join(setup, 'cache'), '--logs-root', join(setup, 'logs'), '--workspace-root', join(setup, 'workspace')]
  const first = run(cli, ['first-run', '--json', ...setupArgs]); if (first.status !== 0) throw new Error(`setup first-run failed: ${first.stderr}`)
  const original = { works: seed.db.prepare('SELECT id FROM works ORDER BY id').all().map((r) => ({ id: String(r.id) })), questions: seed.db.prepare('SELECT id, work_id FROM user_questions ORDER BY id').all().map((r) => ({ id: String(r.id), workId: String(r.work_id) })), answers: seed.db.prepare('SELECT answer_id, question_id FROM answers ORDER BY answer_id').all().map((r) => ({ id: String(r.answer_id), questionId: String(r.question_id) })) }
  const portability = await import(pathToFileURL(join(install, 'app/packages/portability/dist/index.js')).href)
  for (const version of [1, 2]) {
    const destination = join(root, `snapshot-v${version}`)
    const created = await snap.create({ destination, formatVersion: version })
    if (created.manifest.protocol !== `workflow-snapshot/${version}`) throw new Error(`snapshot v${version} protocol`)
    const verified = snap.verify(destination); if (verified.status !== 'ok') throw new Error(`snapshot v${version} verify ${verified.status}`)
    // Materialize the exact snapshot bytes as a new state directory, independent per format.
    const material = join(root, `material-v${version}`); mkdirSync(material, { mode: 0o700 })
    cpSync(destination, material, { recursive: true })
    for (const extra of ['native-projects.json', 'receipts', 'runners']) { try { cpSync(join(seedState, extra), join(material, extra), { recursive: true }) } catch {} }
    renameSync(join(material, 'product.sqlite'), join(material, 'state.sqlite')); try { rmSync(join(material, 'snapshot.json')) } catch {}
    const bundleDir = join(root, `bundle-v${version}`); mkdirSync(bundleDir, { mode: 0o700 })
    const bundle = await portability.createBundle({ stateDir: material, stagingRoot: bundleDir, outputPath: join(bundleDir, 'bundle.tar.gz') })
    step(`snapshot-v${version}-materialized`, 'PASS', { snapshotProtocol: created.manifest.protocol, snapshotDbSha: created.manifest.database.sha256, bundleEvidenceFormat: bundle.manifest.evidence.formatVersion })
    const restoredState = join(root, `restored-v${version}-state`)
    const restored = run(cli, ['restore', '--json', '--bundle', bundle.bundlePath, '--to', restoredState, ...setupArgs])
    if (restored.status !== 0) throw new Error(`v${version} package restore failed: ${restored.stdout} ${restored.stderr}`)
    const restoredFirst = run(cli, ['first-run', '--json', '--install', install, '--config-root', join(root, `restored-v${version}-config`), '--data-root', restoredState, '--cache-root', join(root, `restored-v${version}-cache`), '--logs-root', join(root, `restored-v${version}-logs`), '--workspace-root', join(root, `restored-v${version}-workspace`)])
    let firstJson; try { firstJson = JSON.parse(restoredFirst.stdout) } catch { firstJson = null }
    if (restoredFirst.status !== 0 || !['READY', 'OK', 'RESTORED'].includes(firstJson?.status)) throw new Error(`v${version} restored first-run failed: ${restoredFirst.status} ${(restoredFirst.stdout||'').slice(0,400)}`)
    const db = join(restoredState, 'state.sqlite')
    const restoredDbSha = sha(db), snapshotDbSha = created.manifest.database.sha256
    if (restoredDbSha !== snapshotDbSha) throw new Error(`v${version} restored DB sha differs from snapshot DB sha`)
    let cDriver = null
    if (values.message) {
      const appCfg = join(root, `c-v${version}-config`), appCache = join(root, `c-v${version}-cache`), appLogs = join(root, `c-v${version}-logs`), appWs = join(root, `c-v${version}-ws`)
      for (const p of [appCfg, appCache, appLogs, appWs]) { mkdirSync(p, { mode: 0o700 }); chmodSync(p, 0o700) }
      try { rmSync(join(restoredState, 'instance.json')) } catch {}
      const appInstall = join(install, 'app'), paEntry = join(appInstall, 'apps/launcher/bin/pa.mjs')
      const firstApp = run(process.execPath, [paEntry, 'first-run', '--json', '--install', appInstall, '--config-root', appCfg, '--data-root', restoredState, '--cache-root', appCache, '--logs-root', appLogs, '--workspace-root', appWs])
      if (firstApp.status !== 0) throw new Error(`v${version} app first-run failed`)
      const model = join(root, `c-v${version}-model.json`); writeFileSync(model, JSON.stringify({ baseURL: 'http://127.0.0.1:59999/v1', apiKey: 'wave24-driver-key', model: 'fixture-model', allowedModels: ['fixture-model'], allowInsecureHttp: true }), { mode: 0o600 })
      const driver = '/Users/hh/Desktop/joker/superagent-agent-c/packages/context/tools/personal-review-driver.mjs'
      const out = run(process.execPath, [driver, '--dialect', 'package', '--install', appInstall, '--state', restoredState, '--data-root', restoredState, '--config-root', appCfg, '--cache-root', appCache, '--logs-root', appLogs, '--workspace-root', appWs, '--project', values.project, '--allow-path', '.', '--message', values.message, '--console-port', String(57200 + version), '--api-port', String(57210 + version), '--model-config', model, '--pa-entry', paEntry, '--identity-module', join(appInstall, 'apps/coordinator/product/restored-review.ts'), '--deadline-ms', '180000', '--readiness-ms', '60000'])
      let parsed = null; try { parsed = JSON.parse(out.stdout) } catch {}
      if (out.status !== 0 || parsed?.status !== 'verified-flow') throw new Error(`v${version} C driver failed: ${out.status} code=${parsed?.code ?? parsed?.failure?.code ?? '?'} message=${parsed?.message ?? parsed?.failure?.message ?? '?'} assertions=${JSON.stringify(parsed?.assertions?.filter((a) => !a.ok) ?? []).slice(0,400)} stderr=${String(out.stderr).slice(0,300)}`)
      cDriver = { status: parsed.status, bound: parsed.identity?.bound, requestedDigest: parsed.identity?.requestedDigest, actualHealthDigest: parsed.identity?.actualHealthDigest, assertions: parsed.assertions?.length ?? 0, cleanup: parsed.cleanup }
    }
    const store = new storage.ProductStore({ path: db })
    const got = { works: store.db.prepare('SELECT id FROM works ORDER BY id').all().map((r) => String(r.id)), questions: store.db.prepare('SELECT id FROM user_questions ORDER BY id').all().map((r) => String(r.id)), answers: store.db.prepare('SELECT answer_id FROM answers ORDER BY answer_id').all().map((r) => String(r.answer_id)) }
    store.close()
    if (JSON.stringify(got.works) !== JSON.stringify(original.works.map((r) => r.id)) || JSON.stringify(got.questions) !== JSON.stringify(original.questions.map((r) => r.id)) || JSON.stringify(got.answers) !== JSON.stringify(original.answers.map((r) => r.id))) throw new Error(`v${version} original IDs not preserved`)
    step(`snapshot-v${version}-independent-restore`, 'PASS', { formatVersion: version, restoredDbSha: restoredDbSha.slice(0, 16), snapshotDbSha: snapshotDbSha.slice(0, 16), works: got.works.length, questions: got.questions.length, answers: got.answers.length, bundleIndependent: true, cDriver })
  }
  result.status = result.steps.every((s) => s.status === 'PASS') ? 'PASS' : 'FAIL'
} catch (error) { result.error = String(error?.stack ?? error) }
finally { try { seed?.close() } catch {} rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify({ ...result, steps: result.steps }, null, 2)}\n`); process.exitCode = result.status === 'PASS' ? 0 : 1
