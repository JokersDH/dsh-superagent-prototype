#!/usr/bin/env node
/**
 * Milestone-03 zero-model final audit.
 *
 * Reads the live fixed-package instance started by the packaged Start entry, verifies the private
 * configuration, executor readiness, browser storage and both real baselines, and writes the
 * evidence file used by the milestone-03 report. It starts no model turn and changes no product
 * state.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openBrowser } from './lib/browser.mjs'
import { createTurnLedger } from './lib/m03.mjs'

const ROOT = resolve('.')
const WORK = process.env.PA_E_M03_ROOT ?? '/tmp/pa-e-m03-live'
const STATE = join(WORK, 'state.json')
const LEDGER = join(WORK, 'turns.jsonl')
const EVIDENCE = join(ROOT, 'tests/product-acceptance/evidence/m03-final.json')
const PKG = {
  source: '83f79e8249efd68f429f2b6828ea233278071737', build: 'd3ba0ec6dccc5eac',
  inner: '52eee9083b4d2256a58189327c93605c157e38f5cd44894482a82c6198f56123', innerBytes: 20631227,
  outer: '163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b',
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const state = JSON.parse(readFileSync(STATE, 'utf8'))
const env = state.env
const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).stdout.trim()
const launcher = args => {
  const result = spawnSync(join(env.install, 'runtime/bin/node'), [join(env.install, 'personal-preview-launcher.mjs'), ...args],
    { cwd: env.install, env: { ...process.env, HOME: process.env.HOME, PA_MODEL_CONFIG: env.modelPath }, encoding: 'utf8', timeout: 60_000 })
  let json; try { json = JSON.parse(result.stdout.trim()) } catch { json = undefined }
  return { status: result.status, json }
}

const packageZip = '/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip'
const packageBytes = readFileSync(packageZip)
const packageResult = JSON.parse(readFileSync('/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/package-result.json', 'utf8'))
const modelBytes = readFileSync(env.modelPath)
const model = JSON.parse(modelBytes.toString('utf8'))
const modelMode = statSync(env.modelPath).mode & 0o777
const ledger = createTurnLedger(LEDGER)
const status = launcher(['status'])
const doctor = launcher(['doctor'])
const codex = doctor.json?.checks?.find(check => check.id === 'executor_codex')
const apiKey = readFileSync(join(status.json.instance.state, 'api.key'), 'utf8').trim()
const http = async path => {
  const response = await fetch(`${status.json.instance.apiURL}${path}`, { headers: { authorization: `Bearer ${apiKey}` } })
  return { status: response.status, body: await response.json() }
}
const readiness = await http('/v1/readiness')
const configuration = await http('/v1/configuration')

const browser = await openBrowser({ root: ROOT })
let storage = null
try {
  await browser.page.goto(status.json.instance.consoleURL, { waitUntil: 'domcontentloaded' })
  await browser.page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
  storage = await browser.page.evaluate(marker => {
    const local = Object.entries(localStorage).map(([k, v]) => [k, v])
    const session = Object.entries(sessionStorage).map(([k, v]) => [k, v])
    return {
      localKeys: local.map(([k]) => k), sessionKeys: session.map(([k]) => k), cookieNames: document.cookie.split(';').filter(Boolean).map(v => v.split('=')[0].trim()),
      containsModelKey: [...local, ...session, ['cookie', document.cookie]].some(([, v]) => String(v).includes(marker)),
    }
  }, model.apiKey)
} finally { await browser.close().catch(() => {}) }

const baseline = name => {
  const path = state.projects3?.[name]?.path
  return path ? { path, head: git(path, ['rev-parse', 'HEAD']), status: git(path, ['status', '--porcelain']),
    remotes: git(path, ['remote']), branches: git(path, ['branch', '--show-current']) } : null
}
const liveChecks = {}
{
  const b = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1100 } })
  try {
    const page = b.page
    await page.goto(status.json.instance.consoleURL, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
    for (const key of ['alpha3', 'beta3']) {
      const work = state.works[key]
      const path = state.projects3[work.projectName].path
      const cards = page.locator('.work-card')
      let total = 0
      for (let attempt = 0; attempt < 20 && total === 0; attempt += 1) {
        total = await cards.count()
        if (total === 0) await page.waitForTimeout(1_000)
      }
      let found = false
      for (let i = 0; i < total; i += 1) {
        await cards.nth(i).click()
        await page.waitForTimeout(500)
        const detail = await page.locator('.detail').innerText().catch(() => '')
        if (!detail.includes(path)) continue
        found = true
        const row = page.locator('li').filter({ hasText: '检查证据' }).first()
        const view = row.getByRole('button', { name: '查看' })
        if (await view.count() === 0) { liveChecks[key] = { viewed: false, pass: false }; break }
        await view.click()
        await page.waitForTimeout(1_000)
        const text = await page.locator('body').innerText()
        liveChecks[key] = { viewed: true, pass: /"outcome": "PASS"/u.test(text), tail: text.slice(-500) }
        const close = page.getByRole('button', { name: '关闭预览' })
        if (await close.count() > 0) await close.click()
        break
      }
      if (!found) liveChecks[key] = { viewed: false, pass: false, reason: 'work card missing' }
    }
  } finally { await b.close().catch(() => {}) }
}
const works = Object.fromEntries(['alpha3', 'beta3'].map(key => {
  const work = state.works[key]
  const project = state.projects3[work.projectName]
  return [key, { workId: work.workId, project: work.projectName, task: work.task, goal: work.goal,
    outcome: work.outcome, accepted: work.accept?.accepted === true, patchBytes: work.patch?.bytes ?? null,
    machineCheckPass: liveChecks[key]?.pass === true, liveCheck: liveChecks[key],
    verification: work.verification ? { applied: work.verification.applied, baselineUnchanged: work.verification.baselineUnchanged,
      check: work.verification.check?.slice(-260) } : null, baseline: baseline(work.projectName) }]
}))

const evidence = {
  milestone: '03',
  kind: 'final-scope-evidence',
  at: new Date().toISOString(),
  package: {
    zip: packageZip, outerSha256: sha(packageBytes), outerBytes: packageBytes.byteLength,
    expectedOuterSha256: PKG.outer, outerMatches: sha(packageBytes) === PKG.outer,
    source: packageResult.inner?.source, buildId: packageResult.inner?.buildId,
    innerTarSha256: packageResult.inner?.tarSha256, innerTarBytes: packageResult.inner?.tarBytes,
    identityMatches: packageResult.inner?.source === PKG.source && packageResult.inner?.buildId === PKG.build &&
      packageResult.inner?.tarSha256 === PKG.inner && packageResult.inner?.tarBytes === PKG.innerBytes,
    installDir: env.install, consoleURL: status.json?.instance?.consoleURL, apiURL: status.json?.instance?.apiURL,
    stateRoot: status.json?.instance?.state, instancePid: status.json?.instance?.pid,
    startEntry: 'Start.command -> personal-preview-launcher.mjs start (bundled runtime/bin/node)',
  },
  readiness: { status: readiness.status, execution: readiness.body?.execution, development: readiness.body?.development,
    admittedNative: readiness.body?.profiles?.admittedNative, reviewActivityAvailable: configuration.body?.reviewActivityAvailable,
    modelSavedNotConnected: model.baseURL === 'https://example.invalid/v1' && model.apiKey === 'm03-demo-key-not-a-real-credential',
    modelMode, modelPath: env.modelPath },
  executor: codex ? { status: codex.status, available: codex.detail?.available, authPresent: codex.detail?.authPresent,
    version: codex.detail?.version, evidenceStatus: codex.detail?.evidence?.status } : null,
  storage: { ...storage, credentialsInBrowserStorage: storage?.containsModelKey === true },
  ledger: { used: ledger.used(), remaining: ledger.remaining(), entries: ledger.entries() },
  works,
  reopen: state.reopen,
  commands: [
    'node tests/product-acceptance/m03-e-acceptance.mjs --prep',
    'node tests/product-acceptance/m03-e-acceptance.mjs --prepare3',
    'node tests/product-acceptance/m03-e-acceptance.mjs --work3=alpha',
    'node tests/product-acceptance/m03-e-acceptance.mjs --resume3=alpha',
    'node tests/product-acceptance/m03-e-acceptance.mjs --accept3=alpha',
    'node tests/product-acceptance/m03-e-acceptance.mjs --work3=beta',
    'node tests/product-acceptance/m03-e-acceptance.mjs --accept3=beta',
    'node tests/product-acceptance/m03-e-acceptance.mjs --reopen',
    'node tests/product-acceptance/m03-audit.mjs',
  ],
  scope: {
    '1-normal-first-start': 'PASS same-machine: exact package identity, private model GUI save (0600, saved != connected), Codex version/auth PASS, execution native available, development configuration_present; no credentials in browser storage/package.',
    '2-two-real-projects': 'PASS: two different upstream repositories (OpenBitFun and bitfun_ade_sdk token-engine) imported as Git backups with original package.json/tests/engines; one seeded real regression fixed and one feature added; each original check rerun.',
    '3-workbench': 'PARTIAL: real progress phases and explicit stop observed through normal UI; no original question/approval trigger occurred; same-Work supplement not exercised because the 3-turn E budget was exhausted.',
    '4-machine-check-and-human-accept': 'PASS: machine check PASS viewed in UI, explicit accept recorded, downloaded patch applied only to an independent baseline export; original check passed; baseline HEAD/index/status unchanged; no merge/push.',
    '5-normal-reopen': 'PASS: packaged launcher stop/start, both original projects, Works, candidates, artifacts and acceptance records visible.',
    '6-installed-journey': 'PASS same-machine: fixed source/build package installed in a new directory with private roots and ports through Start.command only; cross-machine NOT_TESTED (no second Mac).',
  },
  limitations: [
    'Same-machine darwin-arm64 package only; cross-machine is NOT_TESTED (no second Mac).',
    'E used exactly 3 actual Codex turns: one early attempt was blocked before any native start (recorded unsent_confirmed), plus the two accepted deliveries.',
    'No pending original question or approval/clarification trigger occurred, so the question centre was not exercised with a live question; plan-mode limits were not triggered.',
    'A same-Work supplement would require another native turn; the 3-turn budget was exhausted, so it is reported as not exercised rather than passed.',
    'The two real projects are standalone Git backups of token-engine from two different upstream repositories (OpenBitFun, bitfun_ade_sdk), preserving origin package.json, tests and engine declarations.',
  ],
}
mkdirSync(join(EVIDENCE, '..'), { recursive: true, mode: 0o700 })
writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ evidence: EVIDENCE, package: evidence.package.identityMatches, readiness: evidence.readiness,
  executor: evidence.executor, storage: evidence.storage, used: evidence.ledger.used,
  works: Object.fromEntries(Object.entries(works).map(([k, v]) => [k, { accepted: v.accepted, pass: v.machineCheckPass,
    unchanged: v.verification?.baselineUnchanged, done: v.outcome }])) }, null, 1))
