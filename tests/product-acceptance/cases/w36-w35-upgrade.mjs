import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'
import { freePort } from '../lib/packaged-instance.mjs'

/**
 * Wave-36 closure 3: current W35 managed upgrade from the locked W33 baseline.
 *
 * The target is the W35 outer ZIP's verified inner install directory (the package was published as an
 * outer ZIP only); the child probe binds it by install-manifest digest. D reports the W35 upgrade raw
 * result as BLOCKED, so a non-successful rollback is recorded as HELD, never as a confirmed rollback.
 */
const here = resolve('tests/product-acceptance/cases')
const W35_INSTALL = '/Users/hh/Desktop/joker/pa-artifacts/wave35-preview-599de3e/PersonalAgent-Preview-599de3e/install'
const W35_INSTALL_MANIFEST = 'd8677d1e313b232ab30026b67e478cdd8f49e72436f01cd1ad454b30641effac'

export async function runW35Upgrade() {
  const cases = []
  const baseline = loadFrozenArtifact('w33', DEFAULT_FROZEN_DIRS.w33)
  const target = { role: 'w35', name: 'wave35-outer-inner', buildId: '599de3e98c02de0b', productSchema: 18,
    sourceCommit: 'edfe5e14f2f8fbc7f395a84520c781c7f07ce9e7', tarSha256: '11027a375848c25c2d2ae8e18755f65fa77272db533dcee7bb9ff27ba8ba50db',
    tarBytes: 20598155, installPath: W35_INSTALL, installManifestSha256: W35_INSTALL_MANIFEST, platform: 'darwin', arch: 'arm64', abi: '137' }
  const evidence = { pair: { baseline: { buildId: baseline.buildId, source: baseline.sourceCommit, schema: baseline.productSchema,
      tarSha256: baseline.tarSha256, tarBytes: baseline.tarBytes },
      target: { buildId: target.buildId, source: target.sourceCommit, schema: target.productSchema,
        tarSha256: target.tarSha256, tarBytes: target.tarBytes, installManifestSha256: target.installManifestSha256 } },
    steps: [], upgrade: null, rollback: null, probe: null, child: null }
  let failure = null
  try {
    if (!existsSync(baseline.tarPath)) throw new Error(`baseline tar absent: ${baseline.tarPath}`)
    if (!existsSync(join(W35_INSTALL, 'install.json'))) throw new Error(`W35 inner install absent: ${W35_INSTALL}`)
    const ports = []
    for (let index = 0; index < 6; index += 1) ports.push(await freePort())
    const child = spawnSync(process.execPath, [join(here, 'e4-managed-upgrade-child.mjs')], {
      env: { ...process.env, PA_E_MANAGED_PAIR: JSON.stringify({ baseline: { ...baseline }, target: { ...target } }),
        PA_E_MANAGED_PORTS: JSON.stringify(ports) },
      encoding: 'utf8', timeout: 300_000,
    })
    let probe
    try { probe = JSON.parse(String(child.stdout).trim().split('\n').filter(Boolean).at(-1)) } catch { probe = undefined }
    evidence.child = { exit: child.status, signal: child.signal ?? null, stdoutTail: String(child.stdout).slice(-500), stderrTail: String(child.stderr).slice(-500) }
    evidence.steps = probe?.steps ?? []
    evidence.upgrade = probe?.upgrade ?? null
    evidence.probe = probe ?? null
    const rollbackRaw = probe?.rollback ?? null
    evidence.rollback = { raw: rollbackRaw, build: probe?.rollbackBuild ?? null, postDataKept: probe?.rollbackKeptPost ?? null,
      held: rollbackRaw?.status !== 'BINARY_ROLLED_BACK', reason: rollbackRaw === null ? 'no_raw_result' : null }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600) }
  const step = id => evidence.steps.find(item => item.id === id)
  const subject = frozenArtifactSubject({ ...target, sourceCommit: target.sourceCommit, productSchema: target.productSchema })

  cases.push(await runCase({ id: 'E36-W35-UPGRADE',
    title: 'The locked W33 baseline upgrades into the current W35 install; a non-successful rollback stays HELD',
    layer: LAYERS.INSTALLED, evidence: { cohortUpgradeW35: { ...evidence, subject } }, limitations: [
      'Bounded child probe over the frozen W33 tar and the W35 outer ZIP inner install directory (bound by manifest digest).',
      'D reports the W35 upgrade raw rollback as BLOCKED; this case accepts a HELD rollback only with that raw result retained.',
    ] }, async ({ assert }) => {
    assert('W35_UPGRADE_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('W35_UPGRADE_MATERIALIZED', step('materialize')?.status === 'PASS', JSON.stringify(step('materialize') ?? null))
    for (const id of ['bootstrap', 'baseline_start', 'upgrade', 'upgraded_health', 'post_upgrade_write', 'tampered_target']) {
      assert(`STEP_${id.toUpperCase()}`, step(id)?.status === 'PASS', JSON.stringify(step(id) ?? null))
    }
    assert('W35_UPGRADE_CONFIRMED', evidence.upgrade?.status === 'CONFIRMED' && evidence.upgrade?.from === evidence.pair.baseline.buildId &&
      evidence.upgrade?.to === evidence.pair.target.buildId, JSON.stringify(evidence.upgrade))
    assert('W35_POST_DATA', evidence.probe?.postKept === true, JSON.stringify({ postKept: evidence.probe?.postKept }))
    assert('W35_TAMPERED_REFUSED', evidence.probe?.tampered?.code === 'target_tampered', JSON.stringify(evidence.probe?.tampered))
    if (evidence.rollback?.held === true) {
      assert('W35_ROLLBACK_HELD', step('rollback_install')?.status !== 'PASS' && evidence.rollback?.raw?.status !== 'BINARY_ROLLED_BACK' &&
        typeof evidence.rollback?.raw?.status === 'string', JSON.stringify(evidence.rollback))
    } else {
      assert('W35_ROLLBACK_BINARY_ONLY', step('rollback_install')?.status === 'PASS' &&
        evidence.rollback?.raw?.status === 'BINARY_ROLLED_BACK' && evidence.rollback?.raw?.dataRolledBack === false &&
        evidence.rollback?.build === evidence.pair.baseline.buildId, JSON.stringify(evidence.rollback))
    }
  }))
  return { cases, artifacts: {} }
}
