import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'
import { freePort } from '../lib/packaged-instance.mjs'

/**
 * Wave-34 same-cohort managed upgrade and binary rollback.
 *
 * The pair is the previous locked cohort (W32 inner 88eb/65c3) and the current locked cohort (W33
 * inner f880/ee45), both schema 18. The bounded child probe drives the frozen `bin/pa` of each
 * package: bootstrap, baseline start, managed upgrade, post-upgrade write, tampered target refusal,
 * rollback-install and baseline restart. D's separately submitted rollback summary contradicts its
 * raw BLOCKED result; that input is recorded as NOT_ADMITTED and only this probe's own result is used.
 */
const here = resolve(join(resolve('.'), 'tests/product-acceptance/cases'))

export async function runCohortUpgrade() {
  const cases = []
  const baseline = loadFrozenArtifact('w32', DEFAULT_FROZEN_DIRS.w32)
  const target = loadFrozenArtifact('w33', DEFAULT_FROZEN_DIRS.w33)
  const evidence = { pair: { baseline: { role: baseline.role, name: baseline.name, buildId: baseline.buildId,
      source: baseline.sourceCommit, schema: baseline.productSchema, tarSha256: baseline.tarSha256, tarBytes: baseline.tarBytes },
      target: { role: target.role, name: target.name, buildId: target.buildId,
        source: target.sourceCommit, schema: target.productSchema, tarSha256: target.tarSha256, tarBytes: target.tarBytes } },
    child: null, steps: [], upgrade: null, rollback: null, dSubmitted: null }
  let failure = null

  try {
    if (!existsSync(baseline.tarPath) || !existsSync(target.tarPath))
      throw new Error(`frozen pair tar missing: ${baseline.tarPath} / ${target.tarPath}`)
    if (baseline.productSchema !== target.productSchema)
      throw new Error(`pair is not same-schema: ${baseline.productSchema} -> ${target.productSchema}`)
    const ports = []
    for (let index = 0; index < 6; index += 1) ports.push(await freePort())
    const child = spawnSync(process.execPath, [join(here, 'e4-managed-upgrade-child.mjs')], {
      env: { ...process.env,
        PA_E_MANAGED_PAIR: JSON.stringify({ baseline: { ...baseline }, target: { ...target } }),
        PA_E_MANAGED_PORTS: JSON.stringify(ports) },
      encoding: 'utf8', timeout: 300_000,
    })
    let probe
    try { probe = JSON.parse(String(child.stdout).trim().split('\n').filter(Boolean).at(-1)) } catch { probe = undefined }
    evidence.child = { exit: child.status, signal: child.signal ?? null, stdoutTail: String(child.stdout).slice(-600),
      stderrTail: String(child.stderr).slice(-600) }
    evidence.steps = probe?.steps ?? []
    evidence.upgrade = probe?.upgrade ?? null
    evidence.rollback = { raw: probe?.rollback ?? null, build: probe?.rollbackBuild ?? null,
      postDataKept: probe?.rollbackKeptPost ?? null, schema: probe?.schema ?? null, postKept: probe?.postKept ?? null }
    evidence.probe = probe ?? null
    // D's submitted rollback claim is an input, not authority.
    const delivery = join(resolve('.'), 'reports/releases/wave34-admission/delivery.json')
    if (existsSync(delivery)) {
      const admission = JSON.parse(readFileSync(delivery, 'utf8'))
      const conflict = admission?.DNonemptyBusiness?.rollbackEvidenceConflict ?? admission?.DTrueProgress?.rollbackOldConflict ?? null
      evidence.dSubmitted = conflict
      const text = JSON.stringify(conflict ?? {})
      const retryMatch = /BINARY_ROLLED_BACK/u.test(text)
      evidence.dRetry = conflict === null ? null : { source: delivery, successRawMentioned: retryMatch,
        oldBlockedPreserved: /BLOCKED/iu.test(text), admission: 'SEPARATE_FROM_ORIGINAL_BLOCKED' }
    }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600) }

  const step = id => evidence.steps.find(item => item.id === id)
  const subject = frozenArtifactSubject(target)

  cases.push(await runCase({ id: 'E5-COHORT-UPGRADE',
    title: 'The previous locked cohort upgrades into the current locked cohort, keeps post-upgrade data and reports its own rollback result',
    layer: LAYERS.INSTALLED, evidence: { cohortUpgrade: { ...evidence, subject } }, limitations: [
      'Bounded child probe over the two frozen tars; the child owns its temporary roots and is not a caller-lifecycle subject.',
      'D’s submitted rollback summary contradicts its raw BLOCKED result and is recorded as NOT_ADMITTED; only this probe’s raw result is used.',
      'No vendor model or native run: the probe writes ordinary chat messages through the frozen CLI.',
    ] }, async ({ assert }) => {
    assert('UPGRADE_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('UPGRADE_PAIR', evidence.pair.baseline.buildId !== evidence.pair.target.buildId &&
      evidence.pair.baseline.schema === evidence.pair.target.schema && subject.tarSha256 === evidence.pair.target.tarSha256,
      JSON.stringify(evidence.pair))
    for (const id of ['bootstrap', 'baseline_start', 'upgrade', 'upgraded_health', 'post_upgrade_write', 'tampered_target', 'rollback_install', 'rollback_start']) {
      assert(`STEP_${id.toUpperCase()}`, step(id)?.status === 'PASS', JSON.stringify(step(id) ?? null))
    }
    assert('UPGRADE_FROM_TO', evidence.upgrade?.from === evidence.pair.baseline.buildId && evidence.upgrade?.to === evidence.pair.target.buildId,
      JSON.stringify(evidence.upgrade))
    assert('UPGRADE_POST_DATA', evidence.probe?.postKept === true && evidence.rollback?.postDataKept === true,
      JSON.stringify({ postKept: evidence.probe?.postKept, rollbackKept: evidence.rollback?.postDataKept }))
    assert('ROLLBACK_BINARY_ONLY', evidence.rollback?.raw?.status === 'BINARY_ROLLED_BACK' && evidence.rollback?.raw?.dataRolledBack === false &&
      evidence.rollback?.build === evidence.pair.baseline.buildId, JSON.stringify(evidence.rollback))
    assert('TAMPERED_REFUSED', evidence.probe?.tampered?.code === 'target_tampered', JSON.stringify(evidence.probe?.tampered))
    assert('D_CLAIM_NOT_USED', evidence.dSubmitted === null || /BLOCKED/iu.test(JSON.stringify(evidence.dSubmitted ?? {})),
      JSON.stringify(evidence.dSubmitted).slice(0, 400))
    assert('D_RETRY_SEPARATE', evidence.dRetry === null || (evidence.dRetry.successRawMentioned === true &&
      evidence.dRetry.oldBlockedPreserved === true), JSON.stringify(evidence.dRetry))
  }))

  return { cases, artifacts: {} }
}
