import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { openBrowser } from '../lib/browser.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { captureSet, createOperation, resourceBirth, rollout } from '../lib/caller-safety.mjs'
import { extractOuterZip, privateHome, verifyOuterZip, W36_ZIP_DIR, W36_ZIP_NAME } from '../lib/outer-zip.mjs'
import { freePort, launcher, privateRoot, readRecord, startOwned, stopOwned } from '../lib/packaged-instance.mjs'

/**
 * Recovery milestone 01: the fixed W36 package's classified Work history (real API + real clicks).
 *
 * Same package for every item: W36 outer 43e06d5b / inner 13798190 / build 14a6b457. The Work is
 * created, checked, accepted and delivered through the packaged fixture; the history API is read for
 * all three kinds and the Work-detail history categories are clicked in the packaged console.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w37his] ${message}\n`) }

export async function runW36History() {
  const cases = []
  const evidence = { subject: null, zip: null, work: null, api: {}, ui: null, negatives: {}, resources: {}, operation: null }
  const root = privateRoot('pa-e-w37-w36his-')
  const home = privateHome('pa-e-w37-w36home-')
  const operation = createOperation({ id: 'w37-w36-history' })
  operation.addMaterial(root.own, 'install-config-state')
  operation.addMaterial(home, 'outer-home')
  let mock = null, failure = null, browser = null
  try {
    const zip = verifyOuterZip(W36_ZIP_DIR, W36_ZIP_NAME)
    const extracted = extractOuterZip(zip, home)
    root.install = extracted.install
    evidence.zip = { sha256: zip.sha256, bytes: zip.bytes, sumsMatch: zip.sumsMatch, resultMatch: zip.resultMatch,
      buildId: zip.result?.inner?.buildId ?? null, source: zip.result?.inner?.source ?? null,
      innerTarSha256: zip.result?.inner?.tarSha256 ?? null, innerTarBytes: zip.result?.inner?.tarBytes ?? null,
      installManifestDigest: extracted.digests.installManifest, installManifestSha256: zip.result?.inner?.installManifestSha256 ?? null,
      runtimeDigest: extracted.digests.runtime, licenseDigest: extracted.digests.license,
      manifestProtocol: extracted.manifest.protocol,
      runtime: { version: extracted.manifest.runtime?.version ?? null, abi: extracted.manifest.runtime?.abi ?? null,
        platform: extracted.manifest.runtime?.platform ?? null, arch: extracted.manifest.runtime?.arch ?? null,
        sha256: extracted.manifest.runtime?.sha256 ?? null, licenseSha256: extracted.manifest.runtime?.licenseSha256 ?? null } }
    const first = launcher(root.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    mock = await candidateModel()
    const ports = [await freePort(), await freePort()]
    const started = startOwned(root, { ports, mockFile: mock.file, fixture: true, extraArgs: [] })
    operation.track({ ...started.birth, argvSha256: started.birth.argv ? (await import('node:crypto')).createHash('sha256').update(started.birth.argv).digest('hex') : null, op: 'w36his:launcher' })
    const value = await started.value
    if (value.status !== 'RUNNING') throw new Error(`start ${value.status}/${value.code ?? 'none'}: ${value.stderr ?? ''}`)
    const client = new LocalProductClient({ baseURL: value.instance.apiURL, stateDir: value.instance.state, timeoutMs: 25_000 })
    for (let index = 0; index < 60; index += 1) { try { if ((await client.health())?.status === 'ok') break } catch { /* wait */ } await new Promise(resolvePromise => setTimeout(resolvePromise, 150)) }
    const configuration = await client.configuration()
    const project = configuration.projects.find(item => item.dispatchAllowed)
    const created = await client.dispatch({ commandId: 'w37-his-work', conversationId: 'conv-w37-his', kind: 'create_work',
      projectId: project.id, profileId: project.profileIds?.[0] ?? project.defaultProfileId, goal: 'W36 分类历史独立核验。',
      scope: project.scope, criteria: (project.defaultCriteria ?? []).filter(item => item.required) })
    const workId = created.receipt?.workId ?? created.workId
    let view
    for (let index = 0; index < 200; index += 1) {
      view = await client.work(workId)
      if (view.actions.available.includes('accept_candidate') || ['delivered', 'ended', 'uncertain'].includes(view.phase)) break
      if ((view.openQuestionIds ?? []).length > 0) {
        const snapshot = await client.snapshot({ workId })
        const question = (snapshot.questions ?? [])[0]
        const choice = question?.presentation?.options?.[0]?.id
        if (question && choice) await client.dispatch({ commandId: `w37-his-answer-${index}`, conversationId: 'conv-w37-his',
          kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: [choice] } })
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 130))
    }
    const verification = view?.actions?.currentVerificationId ? await client.verification(view.actions.currentVerificationId).catch(() => null) : null
    const accepted = view?.actions?.available?.includes('accept_candidate')
      ? await client.dispatch({ commandId: 'w37-his-accept', conversationId: 'conv-w37-his', kind: 'accept_candidate', candidate: view.actions.currentCandidate })
      : null
    for (let index = 0; index < 160 && accepted; index += 1) { const latest = await client.work(workId); if (['delivered', 'ended'].includes(latest.phase)) { view = latest; break } await new Promise(resolvePromise => setTimeout(resolvePromise, 130)) }
    const results = Array.isArray(verification?.results) ? verification.results : null
    evidence.work = { workId, receipt: created.receipt?.status ?? null, phase: view?.phase ?? null,
      accepted: accepted?.receipt?.status ?? null, artifacts: view?.artifactIds?.length ?? 0,
      check: { verificationId: view?.actions?.currentVerificationId ?? null, results: results?.length ?? null,
        state: results && results.length > 0 && results.every(item => item.outcome === 'PASS') ? 'pass' : null } }
    for (const kind of ['contracts', 'verifications', 'acceptances']) {
      const response = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history?kind=${kind}&limit=10`)
      evidence.api[kind] = { status: response.status, protocol: response.body?.protocol ?? null,
        workId: response.body?.workId ?? null, projectId: response.body?.projectId ?? null,
        available: response.body?.available ?? null, returned: (response.body?.entries ?? response.body?.items ?? []).length,
        kinds: response.body?.kinds ?? response.body?.kind ?? null }
    }
    evidence.negatives.badKind = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history?kind=checks&limit=10`)
      .then(value => ({ status: value.status, code: value.body?.error?.code ?? null }))
      .catch(error => ({ status: error.status, code: error.body?.error?.code ?? null }))
    evidence.negatives.limitZero = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history?kind=contracts&limit=0`)
      .then(value => ({ status: value.status, code: value.body?.error?.code ?? null }))
      .catch(error => ({ status: error.status, code: error.body?.error?.code ?? null }))
    evidence.negatives.limitOver = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history?kind=contracts&limit=21`)
      .then(value => ({ status: value.status, code: value.body?.error?.code ?? null }))
      .catch(error => ({ status: error.status, code: error.body?.error?.code ?? null }))
    evidence.negatives.unauthenticated = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history?kind=contracts&limit=10`, { authenticated: false })
      .then(value => ({ status: value.status, code: value.body?.error?.code ?? null }))
      .catch(error => ({ status: error.status, code: error.body?.error?.code ?? null }))
    evidence.negatives.wrongToken = await client.request(`/v1/works/${encodeURIComponent(workId)}/completion-history?kind=contracts&limit=10`,
      { authenticated: false, headers: { authorization: 'Bearer 0000000000000000000000000000000000000000' } })
      .then(value => ({ status: value.status, code: value.body?.error?.code ?? null }))
      .catch(error => ({ status: error.status, code: error.body?.error?.code ?? null }))

    browser = await openBrowser({ root: process.cwd(), viewport: { width: 1400, height: 1000 } })
    const page = browser.page
    await page.goto(`${value.instance.consoleURL}?conversation=conv-w37-his&work=${workId}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
    await page.waitForTimeout(900)
    const expand = page.getByRole('button', { name: '展开工作历史', exact: true })
    const ui = { expanded: false, categories: {}, screenshot: null }
    if (await expand.count() > 0) { await expand.first().click(); await page.waitForTimeout(800); ui.expanded = true }
    // The packaged Work detail renders the category switch as a select of history kinds.
    const historySelect = await (async () => {
      const selects = page.locator('select')
      const count = await selects.count()
      for (let index = 0; index < count; index += 1) {
        const values = await selects.nth(index).locator('option').evaluateAll(els => els.map(el => el.value))
        if (values.some(value => ['verifications', 'acceptances', 'contracts'].includes(value))) return { index, values }
      }
      return null
    })()
    ui.select = historySelect
    for (const [label, key, value] of [['检查记录', 'checks', 'verifications'], ['标准验收', 'acceptances', 'acceptances'], ['合同版本', 'contracts', 'contracts']]) {
      ui.categories[key] = { present: historySelect !== null && historySelect.values.includes(value), via: historySelect === null ? null : `select[${historySelect.index}]`,
        clicked: false, value, text: null, sourceLine: null }
      if (!ui.categories[key].present) continue
      await page.locator('select').nth(historySelect.index).selectOption(value)
      await page.waitForTimeout(700)
      ui.categories[key].clicked = true
      const panelText = await page.locator('body').innerText()
      const start = panelText.indexOf('工作历史')
      ui.categories[key].text = start >= 0 ? panelText.slice(start, start + 420) : null
      const match = ui.categories[key].text?.match(/本类来源\s*(\d+)\s*条\s*·\s*已显示\s*(\d+)\s*条/u)
      ui.categories[key].sourceLine = match ? { source: Number(match[1]), shown: Number(match[2]) } : null
    }
    const shot = join(home, 'w36-history.png')
    await page.screenshot({ path: shot }).catch(() => {})
    ui.screenshot = shot
    evidence.ui = ui
    const record = readRecord(root.config).value ?? null
    const pids = record ? [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger) : []
    const recordDir = join(home, 'Library/Application Support/PersonalAgent', `Preview-${zip.result?.inner?.buildId}`)
    for (const pid of pids) operation.track(resourceBirth(pid, { root: root.install, config: join(recordDir, 'config'), state: join(recordDir, 'data'), op: 'w36his:instance' }))
    const set = captureSet(pids, { root: root.install, config: join(recordDir, 'config'), state: join(recordDir, 'data'), op: 'w36his:instance' })
    const stop = await stopOwned(root, { mockFile: mock.file, birth: started.birth })
    evidence.resources = { before: set, after: rollout(set), stop: { clean: stop.clean, package: stop.packageStop?.json?.status ?? null, reason: stop.reason ?? null } }
    if (stop.clean !== true) throw new Error(`stop not clean: ${stop.reason}`)
    evidence.subject = { source: evidence.zip.source, buildId: evidence.zip.buildId, schema: 18,
      tarSha256: evidence.zip.innerTarSha256, tarBytes: evidence.zip.innerTarBytes,
      platform: evidence.zip.runtime?.platform ?? 'darwin', arch: evidence.zip.runtime?.arch ?? 'arm64', abi: evidence.zip.runtime?.abi ?? '137' }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600); operation.fail('case', error); operation.retain(`case:${failure}`) }
  await browser?.close?.().catch(() => {})
  await mock?.close?.().catch(() => {})

  const productCase = await runCase({ id: 'E37-W36-HISTORY',
    title: 'The fixed W36 package serves classified Work history through its API and console categories',
    layer: LAYERS.INSTALLED, evidence: { w36History: evidence }, limitations: [
      'Same W36 package for every item; the model endpoint is a loopback mock and no vendor model/native run is claimed.',
      'The history metadata is not a grant; execution/approval stay with the original Work actions.',
    ] }, async ({ assert }) => {
    assert('HISTORY_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('HISTORY_ZIP_IDENTITY', evidence.zip?.sumsMatch === true && evidence.zip?.resultMatch === true &&
      evidence.zip?.installManifestDigest === evidence.zip?.installManifestSha256 &&
      evidence.zip?.runtimeDigest === evidence.zip?.runtime?.sha256, JSON.stringify({ sums: evidence.zip?.sumsMatch, result: evidence.zip?.resultMatch }))
    assert('HISTORY_WORK_DELIVERED', evidence.work?.phase === 'delivered' && evidence.work?.accepted === 'recorded' &&
      evidence.work?.check?.state === 'pass' && (evidence.work?.artifacts ?? 0) >= 1, JSON.stringify(evidence.work))
    for (const kind of ['contracts', 'verifications', 'acceptances']) {
      const api = evidence.api[kind] ?? {}
      assert(`HISTORY_API_${kind.toUpperCase()}`, api.status === 200 && api.protocol === 'work-completion-history/1' &&
        api.workId === evidence.work.workId && api.projectId === 'project-atlas' && Number.isInteger(api.available) && api.available >= 1,
        JSON.stringify(api))
    }
    assert('HISTORY_BAD_KIND', evidence.negatives.badKind?.status === 400, JSON.stringify(evidence.negatives.badKind))
    assert('HISTORY_LIMIT_BOUNDS', evidence.negatives.limitZero?.status === 400 && evidence.negatives.limitOver?.status === 400,
      JSON.stringify({ zero: evidence.negatives.limitZero, over: evidence.negatives.limitOver }))
    // Loopback local-access serves a header-less GET; a present-but-wrong bearer must be refused.
    assert('HISTORY_UNAUTHENTICATED', [401, 403].includes(evidence.negatives.unauthenticated?.status) ||
      (evidence.negatives.unauthenticated?.status === 200 && [401, 403].includes(evidence.negatives.wrongToken?.status)),
      JSON.stringify({ unauth: evidence.negatives.unauthenticated, wrong: evidence.negatives.wrongToken }))
    assert('HISTORY_UI_CLICKED', evidence.ui?.expanded === true &&
      ['checks', 'acceptances', 'contracts'].every(key => evidence.ui.categories[key]?.present === true && evidence.ui.categories[key]?.clicked === true),
      JSON.stringify(evidence.ui?.categories))
    assert('HISTORY_UI_ROWS', ['checks', 'acceptances', 'contracts'].every(key => {
      const line = evidence.ui.categories[key]?.sourceLine
      return line && Number.isInteger(line.source) && Number.isInteger(line.shown) && line.shown <= line.source
    }), JSON.stringify(Object.fromEntries(Object.entries(evidence.ui?.categories ?? {}).map(([k, v]) => [k, v.sourceLine]))))
    assert('HISTORY_STOP_COMPLETE', evidence.resources?.stop?.clean === true &&
      evidence.resources.after.every(item => item.alive === false || item.sameIdentity === false), JSON.stringify(evidence.resources?.stop))
  })
  if (productCase.status !== 'PASS') operation.retain('product_assertion_failure')
  const observation = operation.observe()
  const verdict = operation.releaseAllowed(observation)
  if (failure === null && productCase.status === 'PASS' && verdict.allowed === true) {
    const released = operation.release({ observation })
    evidence.operation = { verdict, released: released.released, retained: [], observation, signals: operation.signals }
  } else {
    operation.retain(failure ?? verdict.reason ?? 'unknown')
    const kept = operation.retainAll(failure ?? verdict.reason ?? 'unknown')
    evidence.operation = { verdict, released: [], retained: kept.retained, reason: kept.reason, observation, signals: operation.signals, failures: operation.failures }
  }
  return { cases: [productCase], artifacts: {} }
}
