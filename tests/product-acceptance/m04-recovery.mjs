#!/usr/bin/env node
/**
 * Milestone-04 independent recovery/new-root authorization consumer (zero model).
 *
 *   node tests/product-acceptance/m04-recovery.mjs
 *
 * Reuses the original App/HTTP/Store components and the default source-prepare / confirm /
 * target-prepare / target-authorize routes. Every assertion is made here against HTTP responses and
 * the target/source Stores; the consumer does not write a fabricated answer, acceptance or grant.
 * A prepared private root is retained for evidence.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { readRecoveryTargetAuthorization, verifyRecoveryTargetStartup } from '../../apps/coordinator/product/recovery-target-authorization.ts'

const ROOT = resolve('.')
const BASE = process.env.PA_E_M04_RECOVERY_ROOT ?? '/Users/hh/Desktop/joker/pa-artifacts/pa-e-m04-recovery'
const EVIDENCE = join(ROOT, 'tests/product-acceptance/evidence/m04-recovery.json')
const principal = { userId: 'm04-recovery-user', authorityRef: 'm04-recovery-authority' }
const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
const at = '2026-11-26T01:00:00.000Z'
const runRoot = join(BASE, `run-${Date.now()}`)
const checks = {}, failures = []
const check = (name, ok, detail) => { checks[name] = { ok: !!ok, detail: detail ?? null }; if (!ok) failures.push(name) }
const sqlRows = (path, sql, params = []) => {
  const db = new DatabaseSync(path, { readOnly: true })
  try { return db.prepare(sql).all(...params) } finally { db.close() }
}
const one = (path, sql, params = []) => sqlRows(path, sql, params)[0] ?? null

function setup() {
  const sourceRoot = join(runRoot, 'source'), project = join(runRoot, 'project')
  mkdirSync(sourceRoot, { recursive: true, mode: 0o700 }); mkdirSync(project, { recursive: true })
  mkdirSync(join(runRoot, 'targets'), { recursive: true, mode: 0o700 })
  writeFileSync(join(project, 'index.mjs'), 'export const ok = true\n')
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'M04 recovery fixture'])
  const marker = join(sourceRoot, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: sourceRoot,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const store = new ProductStore({ path: join(sourceRoot, 'state.sqlite') })
  store.queue.enqueue('application.execute', 'old-held-work', '{"workId":"old-held-work"}', 1, 0, at)
  const profile = { id: 'm04-recovery-profile', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: 'm04-controlled', executable: process.execPath, argv: [], expectedVersion: process.version,
    nativeConfigRef: 'm04-recovery-policy', permissionPolicyRevision: 'm04-recovery-policy-1', requiredFeatures: [] }
  let clock = at
  const product = createProductRuntime({ store, stateRoot: sourceRoot, scratchProject: project, principal,
    projects: [{ id: 'old-project', displayName: 'Old project', scope: { projectId: 'old-project',
      allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }],
    actionSecret: Buffer.alloc(32, 91), startupMode: 'recovery_readonly', now: () => clock,
    recoveryExecutor: () => structuredClone(profile) })
  const http = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64),
    bootstrapToken: 'b'.repeat(64), mode: 'personal', startupMode: 'recovery_readonly',
    allowedOrigins: ['http://127.0.0.1:4499'], read: product.read, operations: product.operations })
  return { sourceRoot, project, marker, store, profile, product, http,
    send: (path, input) => http.request('/v1/recovery/' + path, { method: 'POST', headers, body: JSON.stringify(input) }),
    setTime: value => { clock = value } }
}

async function prepare(h) {
  const inspection = await h.product.read.recovery()
  const input = { preflight: { expectedFingerprint: inspection.inspectionFingerprint,
      bindings: [{ sourceProjectId: 'old-project', project: { path: h.project, check: 'node_test' } }] },
    targetStateRoot: join(runRoot, 'targets', 'new-execution') }
  const sourcePrepared = await h.send('source/prepare', input)
  const prepared = await sourcePrepared.json()
  const confirm = await h.send('source/confirm', { token: prepared.token })
  const record = await confirm.json()
  const targetPrepared = await h.send('targets/prepare', { activationId: prepared.intent.activationId, configuration: prepared.configuration })
  const status = await targetPrepared.json()
  return { prepared, record, status, targetRoot: prepared.intent.target.stateRoot,
    command: { activationId: prepared.intent.activationId, commandId: status.authorizationCommandId,
      configuration: prepared.configuration, expectedManifestDigest: status.material.manifestDigest, confirmNewExecution: true } }
}

async function main() {
  mkdirSync(runRoot, { recursive: true, mode: 0o700 })
  const h = setup()
  const data = await prepare(h)
  const targetDb = join(data.targetRoot, 'state.sqlite')
  const sourceDb = join(h.sourceRoot, 'state.sqlite')
  const sourceBefore = {
    fingerprint: h.store.workflows.recoverySource.inspect({ ignoreCommitted: data.record.committed }).sourceFingerprint,
    cursor: h.store.events.cursor(),
    effects: sqlRows(sourceDb, 'SELECT * FROM effect ORDER BY rowid'),
    marker: readFileSync(h.marker),
    ticketCount: one(sourceDb, 'SELECT count(*) n FROM ticket')?.n,
    workCount: one(sourceDb, 'SELECT count(*) n FROM works')?.n,
  }
  const authorizedBefore = readRecoveryTargetAuthorization(data.targetRoot)
  let unauthorizedError = null
  try { verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile) } catch (error) { unauthorizedError = String(error) }
  check('target_unauthorized_before_grant', authorizedBefore === undefined && /explicit new execution authorization/u.test(unauthorizedError ?? ''), unauthorizedError)

  const grantResponse = await h.send('targets/authorize', data.command)
  const authorization = await grantResponse.json()
  check('authorize_http_granted', grantResponse.status === 200 && authorization.authorization === 'granted' &&
    authorization.started === false && authorization.startupAvailable === false, { status: grantResponse.status, authorization })
  check('grant_identity', authorization.grant?.commandId === data.command.commandId &&
    authorization.grant?.source?.intent?.activationId === data.command.activationId &&
    authorization.grant?.principal?.userId === principal.userId &&
    authorization.grant?.principal?.authorityRef === principal.authorityRef &&
    authorization.grant?.profileDigest && authorization.grant?.executableDigest &&
    authorization.targetReceipt?.commandId === data.command.commandId, authorization.grant)
  const reread = readRecoveryTargetAuthorization(data.targetRoot)
  check('grant_readback_exact', JSON.stringify(reread) === JSON.stringify(authorization), reread)

  const targetReceipts = sqlRows(targetDb, 'SELECT command_id, status, seq FROM command_receipts')
  const sourceReceipts = sqlRows(sourceDb, 'SELECT command_id FROM command_receipts')
  check('target_only_grant_receipt', targetReceipts.filter(row => row.command_id === data.command.commandId).length === 1 &&
    sourceReceipts.every(row => row.command_id !== data.command.commandId), { targetReceipts, sourceReceipts })
  check('startup_authorized', (() => { try { verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile); return true } catch { return false } })())

  const audit = await h.http.request(`/v1/recovery/targets/${data.command.activationId}/authorization`, { headers })
  const auditRecord = await audit.json()
  check('authorization_get_same_id', audit.status === 200 && JSON.stringify(auditRecord) === JSON.stringify(authorization), auditRecord)
  const replay = await h.send('targets/authorize', data.command)
  const replayRecord = await replay.json()
  const receiptsAfterReplay = sqlRows(targetDb, 'SELECT command_id FROM command_receipts').filter(row => row.command_id === data.command.commandId).length
  check('authorize_replay_no_second_effect', replay.status === 200 && JSON.stringify(replayRecord) === JSON.stringify(authorization) &&
    receiptsAfterReplay === 1, { status: replay.status, receiptsAfterReplay })
  // The audit record survives a changed executor, but it cannot grant execution to that changed profile.
  const changedProfile = { ...h.profile, revision: 2 }
  let changedProfileError = null
  try { verifyRecoveryTargetStartup(data.targetRoot, principal, changedProfile) } catch (error) { changedProfileError = String(error) }
  const auditAfterChange = await h.http.request(`/v1/recovery/targets/${data.command.activationId}/authorization`, { headers })
  const auditAfterChangeRecord = await auditAfterChange.json()
  const replayAfterChange = await h.send('targets/authorize', data.command)
  const replayAfterChangeRecord = await replayAfterChange.json()
  check('audit_survives_changed_profile_no_execution', /another host, root, principal or executor/u.test(changedProfileError ?? '') &&
    JSON.stringify(auditAfterChangeRecord) === JSON.stringify(authorization) &&
    replayAfterChange.status === 200 && JSON.stringify(replayAfterChangeRecord) === JSON.stringify(authorization) &&
    sqlRows(targetDb, 'SELECT command_id FROM command_receipts').filter(row => row.command_id === data.command.commandId).length === 1,
    { changedProfileError, audit: auditAfterChange.status, replay: replayAfterChange.status })

  const sourceAfter = {
    fingerprint: h.store.workflows.recoverySource.inspect({ ignoreCommitted: data.record.committed }).sourceFingerprint,
    cursor: h.store.events.cursor(),
    effects: sqlRows(sourceDb, 'SELECT * FROM effect ORDER BY rowid'),
    marker: readFileSync(h.marker),
    ticketCount: one(sourceDb, 'SELECT count(*) n FROM ticket')?.n,
    workCount: one(sourceDb, 'SELECT count(*) n FROM works')?.n,
  }
  check('source_unchanged_and_held', JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore) &&
    sourceAfter.effects.some(row => String(row.kind).includes('application.execute') || String(row.value ?? '').includes('old-held-work')),
    { sourceBefore, sourceAfter })
  check('no_old_business_replayed', sourceAfter.ticketCount === sourceBefore.ticketCount &&
    sourceAfter.workCount === sourceBefore.workCount &&
    one(targetDb, 'SELECT count(*) n FROM ticket')?.n === 0 && one(targetDb, 'SELECT count(*) n FROM works')?.n === 0,
    { sourceTickets: sourceAfter.ticketCount, sourceWorks: sourceAfter.workCount })

  const refuses = {}
  const attempt = async (name, fn) => { try { fn(); return false } catch (error) { refuses[name] = String(error).slice(0, 240); return true } }
  check('refuse_foreign_principal', await attempt('principal', () => verifyRecoveryTargetStartup(data.targetRoot, { ...principal, userId: 'foreign' }, h.profile)))
  check('refuse_changed_profile', await attempt('profile', () => verifyRecoveryTargetStartup(data.targetRoot, principal, { ...h.profile, revision: 2 })))
  const configPath = join(data.targetRoot, 'native-projects.json')
  const configBefore = existsSync(configPath) ? readFileSync(configPath) : null
  writeFileSync(configPath, JSON.stringify({ version: 1, projects: [] }), { mode: 0o600 })
  check('refuse_changed_config', await attempt('config', () => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile)))
  if (configBefore) writeFileSync(configPath, configBefore, { mode: 0o600 })
  const dbCopy = join(data.targetRoot, 'replacement.sqlite')
  copyFileSync(targetDb, dbCopy); renameSync(dbCopy, targetDb)
  check('refuse_replaced_database', await attempt('database', () => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile)))
  const copiedTarget = join(runRoot, 'copied-target')
  cpSync(data.targetRoot, copiedTarget, { recursive: true })
  check('refuse_copied_root', await attempt('copied_root', () => verifyRecoveryTargetStartup(copiedTarget, principal, h.profile)))
  const parent = join(runRoot, 'targets'), moved = join(runRoot, 'original-parent')
  renameSync(parent, moved); mkdirSync(parent, { mode: 0o700 }); renameSync(join(moved, 'new-execution'), data.targetRoot)
  check('refuse_replaced_parent', await attempt('parent', () => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile)))
  check('grant_remains_auditable_after_refusals', JSON.stringify(readRecoveryTargetAuthorization(data.targetRoot)) === JSON.stringify(authorization))

  const evidence = { at: new Date().toISOString(), kind: 'm04-independent-recovery-authorization',
    root: runRoot, proofRoot: data.targetRoot, principal, profile: h.profile, checks, failures,
    authorization, targetReceipts, sourceBefore: { ...sourceBefore, marker: undefined }, sourceAfter: { ...sourceAfter, marker: undefined },
    refuses, limitations: ['Controlled source/target fixture through original App/HTTP/Store routes; not a colleague machine or real recovery.',
      'No model prompt, no source authorization write, and no old Work/begin replay were performed.',
      'Replaced database/parent tests intentionally mutate this disposable controlled target to prove refusal; the original source Store is untouched.'] }
  mkdirSync(join(EVIDENCE, '..'), { recursive: true, mode: 0o700 })
  mkdirSync(join(BASE, 'evidence'), { recursive: true, mode: 0o700 })
  writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(BASE, 'evidence/m04-recovery.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ evidence: EVIDENCE, root: runRoot, ok: failures.length === 0, failures,
    checks: Object.fromEntries(Object.entries(checks).map(([name, item]) => [name, item.ok])) }, null, 1))
  if (failures.length) process.exitCode = 1
  await h.product.close(); h.store.close()
}

try { await main() } catch (error) {
  console.error(`m04-recovery failed: ${String(error?.message ?? error).slice(0, 1200)}`)
  process.exitCode = 1
}
