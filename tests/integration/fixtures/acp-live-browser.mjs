/** Actual App/HttpTransport UI consumer. Importing this module never creates or sends a Work. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, lstatSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CommandReceiptSchema, CandidateRefSchema, IdSchema, UserCommandSchema, UserQuestionSchema } from '../../../packages/contracts/src/index.ts'
import { listenLocalHttp } from '../../../apps/coordinator/http/server.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(new URL('../../../apps/console/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const portOf = server => {
  const address = server.address()
  assert(address && typeof address !== 'string', 'Private loopback server has no port')
  assert(!((address.port >= 5180 && address.port <= 5191) || (address.port >= 8796 && address.port <= 8807)), 'Private consumer port is reserved')
  return address.port
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

/**
 * Caller owns the ProductRuntime, credentials and the one send ledger. createApp receives this
 * private browser origin and returns the original Hono app, usually with localDevelopmentAccess.
 * onCreateCommand is synchronous and runs before the original unmodified request is continued;
 * throwing refuses the send. It must durably reserve the exact UI command in the caller's ledger.
 * No failed/unknown business command is retried by this helper.
 */
export async function openAcpLiveBrowser({ createApp, onCreateCommand, outputRoot, conversationId = 'conv-main' }) {
  assert.equal(typeof createApp, 'function')
  assert.equal(typeof onCreateCommand, 'function')
  assert(isAbsolute(outputRoot), 'Private screenshot root must be absolute')
  IdSchema.parse(conversationId)
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 })
  const outputStat = lstatSync(outputRoot)
  assert(outputStat.isDirectory() && !outputStat.isSymbolicLink() && !(outputStat.mode & 0o077) &&
    (!process.getuid || outputStat.uid === process.getuid()), 'Screenshot root must be a private owned directory')
  const output = realpathSync(outputRoot)
  let application, api, vite, browser, page, active, closed = false, uncertain = false, captureIndex = 0
  const forwarded = new Set()
  const screenshots = []
  const capture = async label => {
    assert(/^[a-z0-9-]+$/.test(label), 'Invalid screenshot label')
    const path = join(output, `app-${String(++captureIndex).padStart(2, '0')}-${label}.png`)
    await page.screenshot({ path, fullPage: true, animations: 'disabled' })
    screenshots.push(path)
    return path
  }
  const close = async () => {
    if (closed) return
    closed = true
    // Only this helper's browser and servers. The caller retains all product/native ownership.
    try { await browser?.close() }
    finally {
      try { await vite?.close() }
      finally {
        if (api) {
          const ended = new Promise((resolveClose, reject) => api.close(error => error ? reject(error) : resolveClose()))
          api.closeAllConnections()
          await ended
        }
      }
    }
  }
  try {
    api = listenLocalHttp({ fetch: (...args) => application ? application.fetch(...args)
      : new Response('Private UI consumer is preparing', { status: 503 }) }, 0)
    await once(api, 'listening')
    const apiOrigin = `http://127.0.0.1:${portOf(api)}`
    const { createServer } = await import(require.resolve('vite'))
    vite = await createServer({ root: resolve(repository, 'apps/console'), configFile: false,
      define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
      server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null,
        proxy: { '/v1': { target: apiOrigin, changeOrigin: true } } },
    })
    await vite.listen()
    const origin = `http://127.0.0.1:${portOf(vite.httpServer)}`
    application = await createApp(origin)
    assert(application && typeof application.fetch === 'function', 'createApp must return the original Hono app')
    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' })
    page = await context.newPage()
    page.setDefaultTimeout(30000)
    await page.route('**/v1/commands', async route => {
      const request = route.request()
      if (request.method() !== 'POST') return route.continue()
      try {
        const command = UserCommandSchema.parse(request.postDataJSON())
        if (!active || active.captured || !active.matches(command)) throw new Error('Unexpected UI business command; request was not forwarded')
        if (forwarded.has(command.commandId)) throw new Error('The original UI command was already forwarded; reconcile it instead')
        active.captured = structuredClone(command)
        if (command.kind === 'create_work') {
          const copy = structuredClone(command), result = onCreateCommand(copy)
          if (result && typeof result.then === 'function') throw new Error('The create command reservation hook must be synchronous')
          assert.deepEqual(copy, command, 'Reservation must preserve the original UI command and identity')
        }
        forwarded.add(command.commandId)
        await route.continue()
      } catch (error) {
        active?.reject(error)
        await route.abort('failed')
      }
    })
    const locationFor = workId => {
      const url = new URL('/', origin)
      url.searchParams.set('conversation', conversationId)
      if (workId) url.searchParams.set('work', IdSchema.parse(workId))
      return url.href
    }
    const openWork = async workId => {
      await page.goto(locationFor(workId), { waitUntil: 'domcontentloaded' })
      await page.getByRole('region', { name: '工作详情', exact: true }).waitFor()
    }
    const perform = async ({ matches, click, label, workRequired = false, afterRecorded }) => {
      assert(!closed && !active && !uncertain, 'A previous UI business result needs reconciliation before another action')
      let rejectBlocked
      const blocked = new Promise((_resolve, reject) => { rejectBlocked = reject })
      void blocked.catch(() => undefined)
      const operation = { matches, captured: undefined, reject: rejectBlocked }
      active = operation
      const response = page.waitForResponse(value => {
        if (new URL(value.url()).pathname !== '/v1/commands' || value.request().method() !== 'POST' || !operation.captured) return false
        try { return value.request().postDataJSON().commandId === operation.captured.commandId } catch { return false }
      }, { timeout: 30000 })
      void response.catch(() => undefined)
      try {
        await capture(`${label}-before`)
        await click()
        const received = await Promise.race([response, blocked])
        assert.equal(received.status(), 200, 'Original product command HTTP status was not 200; do not resend')
        const receipt = CommandReceiptSchema.parse(await received.json())
        assert.equal(receipt.commandId, operation.captured?.commandId, 'Response must name the original UI command')
        if (receipt.status !== 'recorded') throw new Error(`Original UI command was rejected: ${receipt.error.code}`)
        if (workRequired) IdSchema.parse(receipt.workId)
        await afterRecorded?.(receipt)
        await capture(`${label}-recorded`)
        return receipt
      } catch (error) {
        if (operation.captured && forwarded.has(operation.captured.commandId)) uncertain = true
        await capture(`${label}-unconfirmed`).catch(() => undefined)
        throw error
      } finally { active = undefined }
    }
    await page.goto(locationFor(), { waitUntil: 'domcontentloaded' })
    await page.locator('.workspace-rail').waitFor()
    assert.equal(await page.locator('html').getAttribute('data-console-mode'), 'http', 'The live consumer must use HttpTransport')
    await capture('opened')
    return {
      screenshots,
      async delegate({ goal, projectId, profileId }) {
        assert.equal(typeof goal, 'string'); assert(goal.trim())
        IdSchema.parse(projectId); IdSchema.parse(profileId)
        assert(!active && !uncertain && !closed, 'No new delegation until the original result is reconciled')
        await page.getByRole('button', { name: '新建委托', exact: true }).click()
        const form = page.getByRole('form', { name: '新建委托', exact: true })
        await form.getByRole('combobox', { name: '项目', exact: true }).selectOption(projectId)
        await form.getByRole('combobox', { name: '开发执行器', exact: true }).selectOption(profileId)
        await form.getByRole('textbox', { name: '目标', exact: true }).fill(goal)
        const create = form.getByRole('button', { name: '创建委托', exact: true })
        await expect(create).toBeEnabled()
        return perform({ label: 'delegate', workRequired: true,
          matches: command => command.kind === 'create_work' && command.projectId === projectId && command.profileId === profileId && command.goal === goal.trim(),
          click: () => create.click(), afterRecorded: () => form.waitFor({ state: 'hidden' }) })
      },
      async answerPermission(rawQuestion, semantic) {
        const question = UserQuestionSchema.parse(rawQuestion)
        assert.equal(question.kind, 'permission', 'Only original native permission questions use this consumer')
        const presentation = question.presentation
        assert(presentation.kind === 'choices' || presentation.kind === 'review', 'Permission must retain its original options')
        const matches = presentation.options.filter(option => option.semantic === semantic)
        assert.equal(matches.length, 1, 'Choose exactly one original permission semantic; no label or question guessing')
        const option = matches[0]
        await openWork(question.contract.workId)
        const card = page.locator(`.question-card[aria-labelledby="q-${question.id}"]`)
        const button = card.getByRole('button', { name: option.label, exact: true })
        await expect(button).toHaveCount(1); await expect(button).toBeEnabled()
        return perform({ label: 'permission', matches: command => command.kind === 'answer_question' &&
          command.questionId === question.id && command.expectedVersion === question.version && command.answer.kind === 'choices' &&
          same(command.answer.optionIds, [option.id]),
          click: async () => {
            await button.click()
            if (presentation.kind === 'choices' && presentation.multiple)
              await card.getByRole('button', { name: '提交选择', exact: true }).click()
          } })
      },
      async acceptCandidate(rawCandidate) {
        const candidate = CandidateRefSchema.parse(rawCandidate)
        await openWork(candidate.contract.workId)
        const accept = page.getByRole('region', { name: '工作详情', exact: true }).getByRole('button', { name: '接受当前候选', exact: true })
        await expect(accept).toBeEnabled()
        return perform({ label: 'accept', matches: command => command.kind === 'accept_candidate' && same(command.candidate, candidate),
          click: () => accept.click(), afterRecorded: () => expect(page.locator('.detail .section-head .phase')).toHaveText('已交付') })
      },
      close,
    }
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }
}
