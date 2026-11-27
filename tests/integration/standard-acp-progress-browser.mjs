/** Actual App + FixtureAdapter over an isolated progress stream; no backend or vendor session. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const { createServer } = await import(require.resolve('vite'))
const evidenceRoot = process.env.PA_ACP_UI_EVIDENCE_ROOT ?? join(tmpdir(), 'pa-acp-client-ui')
mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 })
const evidenceStat = statSync(evidenceRoot)
assert.equal(evidenceStat.mode & 0o077, 0, 'Browser evidence requires a private directory')
const output = join(evidenceRoot, `run-${Date.now()}`)
mkdirSync(output, { mode: 0o700 })

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controlled ACP progress consumer</title></head>
<body><div id="root"></div><script type="module">
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '/src/App.tsx'
import { FixtureAdapter, seedState } from '/src/fixture.ts'
import { ApplicationConfigurationSchema, ChangeSchema, ExecutorTrialInspectionSchema, ProgressUpdateSchema, WorkExecutionSchema } from '@personal-agent/contracts'
import '/src/styles.css'
import '/src/workbench.css'
import '/src/attention.css'
import '/src/decisions.css'
import '/src/proposals.css'
import '/src/evidence.css'
import '/src/context.css'

const seed = seedState()
const permission = seed.questions.find(question => question.id === 'q-free')
permission.kind = 'permission'
permission.prompt = 'Controlled ACP permission remains an independent decision.'
permission.presentation = { kind: 'choices', multiple: false, options: [
  { id: 'allow-controlled', label: '允许本次受控请求', semantic: 'allow_once' },
  { id: 'deny-controlled', label: '拒绝本次受控请求', semantic: 'deny' },
] }
const storage = { getItem: () => JSON.stringify(seed), setItem: () => undefined }
const fixture = new FixtureAdapter(storage)
let sequence = (await fixture.snapshot({})).cursor
const fixtureSnapshot = fixture.snapshot.bind(fixture)
fixture.snapshot = async query => ({ ...await fixtureSnapshot(query), cursor: sequence })
const history = [], listeners = new Set()
const observed = { deliveredSeq: sequence, emitted: 0, subscriptions: 0, workExecutionReads: 0, inspectionRequests: [], consentCalls: 0 }
const diagnosticProfile = (id, driverId, displayName, version, char) => ({
  id, revision: 1, driverId, displayName, kind: 'native', readiness: 'inspection_passed',
  dispatchAllowed: false, blockedReason: 'unsupported_capability',
  compatibility: { classification: 'compatible_unverified', nativeVersion: version,
    protocol: driverId === 'acp-v1' ? 'acp-v1' : 'codex-app-server-json-schema',
    schemaDigest: char.repeat(64), checkedAt: '2026-11-27T01:00:00.000Z',
    operations: [{ operation: 'begin', supported: true, validation: 'protocol', enabled: false }],
  },
})
const diagnosticProfiles = [
  diagnosticProfile('profile-controlled-codex', 'codex-native', 'Controlled Codex 配置', 'controlled-codex-version', 'c'),
  diagnosticProfile('profile-controlled-acp', 'acp-v1', 'Controlled ACP 配置', 'controlled-acp-version', 'a'),
]
const fixtureConfiguration = fixture.configuration.bind(fixture)
fixture.configuration = async () => {
  const original = await fixtureConfiguration()
  return ApplicationConfigurationSchema.parse({ ...original, profiles: [...original.profiles, ...diagnosticProfiles] })
}
fixture.inspectExecutorTrial = async profileId => {
  observed.inspectionRequests.push(profileId)
  const profile = diagnosticProfiles.find(value => value.id === profileId)
  if (!profile) throw new Error('Unexpected controlled inspection profile')
  return ExecutorTrialInspectionSchema.parse({ protocol: 'executor-trial-inspection/1', profile,
    identityDigest: (profileId === 'profile-controlled-acp' ? 'a' : 'c').repeat(64),
    policyDigest: (profileId === 'profile-controlled-acp' ? 'b' : 'd').repeat(64),
    confirmationCommandId: 'controlled-consent-' + profileId,
    authorization: 'not_granted', confirmationAvailable: true, observedAt: '2026-11-27T01:00:00.000Z',
  })
}
fixture.confirmExecutorTrial = async () => { observed.consentCalls += 1; throw new Error('Consent is outside this controlled browser consumer') }
const runningInput = new Map()
fixture.workExecution = async workId => {
  const work = (await fixture.snapshot({ workId })).works[0]
  if (!work) return undefined
  observed.workExecutionReads += 1
  return WorkExecutionSchema.parse({ protocol: 'work-execution/1',
    contract: { workId, revision: work.contract.revision, digest: work.contract.digest },
    profileId: 'profile-controlled-acp', revision: 1, driverId: 'acp-v1',
    displayName: 'Controlled ACP Client', runningInput: runningInput.get(workId) ?? 'native_steer',
  })
}
const publish = change => {
  history.push(change); observed.emitted += 1
  for (const listener of listeners) listener(change)
  return change.seq
}
fixture.changes = async function* (after, signal) {
  const queue = history.filter(change => change.seq > after)
  let wake, ended = signal?.aborted === true
  const listener = change => { queue.push(change); wake?.() }
  const abort = () => { ended = true; wake?.() }
  listeners.add(listener); observed.subscriptions = listeners.size
  signal?.addEventListener('abort', abort)
  try {
    while (!ended) {
      const change = queue.shift()
      if (change) { observed.deliveredSeq = Math.max(observed.deliveredSeq, change.seq); yield change; continue }
      await new Promise(resolve => { wake = resolve })
      wake = undefined
    }
  } finally {
    listeners.delete(listener); observed.subscriptions = listeners.size
    signal?.removeEventListener('abort', abort)
  }
}
window.__controlledAcpProgress = {
  observed,
  setRunningInput({ workId = 'work-alpha', mode }) {
    if (!['native_steer', 'unsupported'].includes(mode)) throw new Error('Unknown controlled input capability')
    runningInput.set(workId, mode)
    return publish(ChangeSchema.parse({ seq: ++sequence, topic: 'application.execution.prepared',
      entityRef: workId, payload: { workId } }))
  },
  async emit({ workId = 'work-alpha', text, contractPatch, entityRef, seq } = {}) {
    const work = (await fixture.snapshot({ workId })).works[0]
    if (!work) throw new Error('Unknown controlled Work')
    const assignment = work.actions.currentAssignment
    if (!assignment) throw new Error('Controlled Work has no current assignment')
    const update = ProgressUpdateSchema.parse({
      ticketId: assignment.ticketId, assignmentId: assignment.assignmentId,
      attemptId: 'controlled-progress-' + workId, fenceEpoch: 1,
      contract: { workId, revision: work.contract.revision, digest: work.contract.digest, ...contractPatch },
      text, observedAt: '2026-11-27T01:00:00.000Z',
    })
    const change = ChangeSchema.parse({ seq: seq ?? ++sequence, topic: 'application.execution.progress',
      entityRef: entityRef ?? workId, payload: update })
    sequence = Math.max(sequence, change.seq)
    return publish(change)
  },
}
document.documentElement.dataset.consoleMode = 'fixture'
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, React.createElement(App, { transport: fixture })))
</script></body></html>`

const cases = [], errors = [], screenshots = []
let browser, vite, page
const step = async (id, run) => {
  try { await run(); cases.push({ id, status: 'PASS' }) }
  catch (error) {
    cases.push({ id, status: 'FAIL', message: String(error?.message ?? error) })
    if (page && !page.isClosed()) await capture(`failure-${id.toLowerCase()}.png`).catch(() => undefined)
  }
}
const capture = async name => {
  const path = join(output, name)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  screenshots.push(path)
}
try {
  vite = await createServer({ root: resolve(repository, 'apps/console'), configFile: false,
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null },
    plugins: [{ name: 'controlled-acp-progress-page', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__controlled_acp_progress') return next()
        try {
          const body = await server.transformIndexHtml(request.url, html)
          response.statusCode = 200; response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(body)
        } catch (error) { next(error) }
      })
    } }],
  })
  await vite.listen()
  const address = vite.httpServer.address()
  assert(address && typeof address !== 'string')
  assert(!((address.port >= 5180 && address.port <= 5191) || (address.port >= 8796 && address.port <= 8807)), 'Ephemeral test port must be separate')
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', reducedMotion: 'reduce' })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/__controlled_acp_progress`)
  await page.waitForFunction(() => window.__controlledAcpProgress?.observed.subscriptions > 0)
  await page.locator('.work-card').filter({ hasText: '支付错题重试' }).click()
  const outputText = page.locator('.detail .execution-progress .artifact-text')
  const emit = async payload => {
    const seq = await page.evaluate(value => window.__controlledAcpProgress.emit(value), payload)
    await page.waitForFunction(value => window.__controlledAcpProgress.observed.deliveredSeq >= value, seq)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return seq
  }

  await step('ACTUAL-APP-DISPLAYS-CURRENT-WORK-PROGRESS', async () => {
    await emit({ text: 'Controlled snapshot A: inspecting source.' })
    await expect(outputText).toHaveText('Controlled snapshot A: inspecting source.')
    await expect(page.locator('.detail .execution-progress')).toHaveCount(1)
  })
  await step('SNAPSHOT-REPLACEMENT-AND-EVENT-REPLAY-DO-NOT-CONCATENATE', async () => {
    const text = 'Controlled snapshot A: inspecting source.\nControlled snapshot B: preparing patch.'
    const seq = await emit({ text })
    await expect(outputText).toHaveText(text)
    await emit({ text: 'REPLAYED_EVENT_MUST_NOT_REPLACE_CURRENT_OUTPUT', seq })
    await expect(outputText).toHaveText(text)
  })
  await step('WRONG-CONTRACT-CANNOT-REPLACE-THE-CURRENT-WORK-SNAPSHOT', async () => {
    await emit({ text: 'Current contract output remains visible.' })
    await expect(outputText).toHaveText('Current contract output remains visible.')
    await emit({ text: 'WRONG_CONTRACT_OUTPUT', contractPatch: { revision: 2, digest: 'f'.repeat(64) } })
    // Stale input must neither appear nor erase the latest output for the current contract.
    await expect(outputText).toHaveText('Current contract output remains visible.')
    await expect(page.locator('.detail')).not.toContainText('WRONG_CONTRACT_OUTPUT')
  })
  await step('OTHER-WORK-AND-MISMATCHED-ENTITY-ARE-ISOLATED', async () => {
    await emit({ text: 'Alpha belongs only to the current Work.' })
    await emit({ workId: 'work-beta', text: 'Beta belongs only to the second Work.' })
    await expect(outputText).toHaveText('Alpha belongs only to the current Work.')
    await emit({ text: 'MISMATCHED_ENTITY_OUTPUT', entityRef: 'work-beta' })
    await expect(outputText).toHaveText('Alpha belongs only to the current Work.')
    await page.locator('.work-card').filter({ hasText: '发布前只读检查' }).click()
    await expect(outputText).toHaveText('Beta belongs only to the second Work.')
    await expect(page.locator('.detail')).not.toContainText('Alpha belongs only')
    await page.locator('.work-card').filter({ hasText: '支付错题重试' }).click()
    await expect(outputText).toHaveText('Alpha belongs only to the current Work.')
  })
  await step('WORK-CAPABILITY-DISABLES-ONLY-RUNNING-INPUT-AND-REFRESHES-THROUGH-CHANGES', async () => {
    const currentWork = page.getByRole('group', { name: '消息上下文', exact: true }).getByRole('button', { name: '当前工作', exact: true })
    const mainConversation = page.getByRole('group', { name: '消息上下文', exact: true }).getByRole('button', { name: '主对话', exact: true })
    const send = page.getByRole('button', { name: '发送消息', exact: true })
    await expect(currentWork).toBeEnabled()
    await expect(page.locator('.detail')).toContainText('Controlled ACP Client')
    const setCapability = async mode => {
      const before = await page.evaluate(() => window.__controlledAcpProgress.observed.workExecutionReads)
      const seq = await page.evaluate(value => window.__controlledAcpProgress.setRunningInput({ mode: value }), mode)
      await page.waitForFunction(value => window.__controlledAcpProgress.observed.deliveredSeq >= value, seq)
      await page.waitForFunction(value => window.__controlledAcpProgress.observed.workExecutionReads > value, before)
    }
    await setCapability('unsupported')
    await expect(currentWork).toBeDisabled()
    await expect(mainConversation).toBeEnabled()
    await expect(page.locator('.detail')).toContainText('本次运行不支持补充指令')
    await mainConversation.click()
    await page.locator('#composer-input').fill('Controlled discussion stays available; this message will not be sent.')
    await expect(send).toBeEnabled()
    const permissionCard = page.locator('.detail .question-card').filter({ hasText: 'Controlled ACP permission remains an independent decision.' })
    const allow = permissionCard.getByRole('button', { name: '允许本次受控请求', exact: true })
    await expect(allow).toBeEnabled()
    await expect(permissionCard.getByRole('button', { name: '拒绝本次受控请求', exact: true })).toBeEnabled()
    await expect(page.locator('.detail').getByRole('button', { name: '停止工作', exact: true })).toBeEnabled()
    await capture('desktop-running-input-unsupported.png')
    await setCapability('native_steer')
    await expect(currentWork).toBeEnabled()
    await expect(page.locator('.detail')).not.toContainText('本次运行不支持补充指令')
    await currentWork.click()
    await expect(currentWork).toHaveAttribute('aria-pressed', 'true')
    await expect(send).toBeEnabled()
    await capture('desktop-running-input-restored.png')
    await mainConversation.click()
    await page.locator('#composer-input').fill('')
  })
  await step('EXECUTOR-INSPECTION-SELECTION-KEEPS-ACP-AND-CODEX-IDENTITIES-SEPARATE', async () => {
    const navigation = page.getByRole('navigation', { name: '工作台导航', exact: true })
    await navigation.getByRole('button', { name: '执行器目录', exact: true }).click()
    const panel = page.getByRole('region', { name: '执行器版本检查', exact: true })
    const select = panel.getByRole('combobox', { name: '检查执行器', exact: true })
    const inspect = panel.getByRole('button', { name: '检查版本兼容', exact: true })
    await expect(select).toHaveValue('profile-controlled-codex')
    await select.selectOption('profile-controlled-acp')
    await expect(select.locator('option:checked')).toHaveText('Controlled ACP 配置')
    await expect(panel).toContainText('标准 ACP v1')
    await inspect.click()
    await expect(panel.locator('.executor-trial-facts')).toContainText('controlled-acp-version')
    assert.deepEqual(await page.evaluate(() => window.__controlledAcpProgress.observed.inspectionRequests), ['profile-controlled-acp'])
    await panel.getByRole('checkbox').check()
    await expect(panel.getByRole('checkbox')).toBeChecked()
    await expect(panel.getByRole('button', { name: '记录此版本的试用同意', exact: true })).toBeEnabled()
    await capture('desktop-acp-inspection-selection.png')
    await select.selectOption('profile-controlled-codex')
    await expect(panel.locator('.executor-trial-facts')).toHaveCount(0)
    await expect(panel.getByRole('checkbox')).toHaveCount(0)
    await expect(panel).not.toContainText('controlled-acp-version')
    await expect(panel).not.toContainText('标准 ACP v1')
    await inspect.click()
    await expect(panel.locator('.executor-trial-facts')).toContainText('controlled-codex-version')
    await expect(panel.getByRole('checkbox')).not.toBeChecked()
    await expect(panel.getByRole('button', { name: '记录此版本的试用同意', exact: true })).toBeDisabled()
    assert.deepEqual(await page.evaluate(() => window.__controlledAcpProgress.observed.inspectionRequests),
      ['profile-controlled-acp', 'profile-controlled-codex'])
    assert.equal(await page.evaluate(() => window.__controlledAcpProgress.observed.consentCalls), 0)
    await capture('desktop-codex-inspection-selection.png')
    await navigation.getByRole('button', { name: '主对话视图', exact: true }).click()
    await page.locator('.work-card').filter({ hasText: '支付错题重试' }).click()
    await expect(outputText).toHaveText('Alpha belongs only to the current Work.')
  })
  await step('HTML-PROGRESS-IS-LITERAL-TEXT', async () => {
    const text = '<img src="x" onerror="window.__progressExecuted=true"><script>window.__progressExecuted=true</script>'
    await emit({ text })
    await expect(outputText).toHaveText(text)
    assert.equal(await outputText.locator('img,script').count(), 0)
    assert.equal(await page.evaluate(() => window.__progressExecuted), undefined)
    await capture('desktop-literal-progress.png')
  })
  await step('NARROW-WORK-DETAIL-HAS-NO-HORIZONTAL-OVERFLOW', async () => {
    await emit({ text: '长动态与连续标识符：' + 'snapshot_'.repeat(650) + '\n第二行保持正常换行。' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(outputText).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const geometry = await page.evaluate(() => {
      const detail = document.querySelector('.detail'), pre = document.querySelector('.detail .execution-progress .artifact-text')
      return { viewport: innerWidth, document: document.documentElement.scrollWidth,
        detail: detail ? { client: detail.clientWidth, scroll: detail.scrollWidth } : null,
        text: pre ? { client: pre.clientWidth, scroll: pre.scrollWidth } : null }
    })
    await capture('narrow-progress.png')
    assert(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry))
    assert(geometry.detail && geometry.detail.scroll <= geometry.detail.client + 1, JSON.stringify(geometry))
    assert(geometry.text && geometry.text.scroll <= geometry.text.client + 1, JSON.stringify(geometry))
  })
  await step('NO-UNCAUGHT-ERRORS', async () => assert.deepEqual(errors, []))
} catch (error) {
  cases.push({ id: 'SETUP-OR-CONSUMER', status: 'FAIL', message: String(error?.stack ?? error) })
} finally {
  if (page && !page.isClosed()) await capture('final-state.png').catch(() => undefined)
  await browser?.close()
  await vite?.close()
  const report = { status: cases.length === 9 && cases.every(value => value.status === 'PASS') ? 'PASS' : 'FAIL',
    cases, errors, screenshots, source: 'Actual App and FixtureAdapter; controlled progress, WorkExecution capability reads and profile-specific trial inspection',
    vendorCliCalls: 0, modelTurns: 0, nativeSessions: 0, signals: 0,
    limits: ['No backend/ACP vendor execution or installed/native release admission', 'Ephemeral own Vite/browser only; existing services and tabs are not used'] }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.status === 'PASS' ? 0 : 1
}
