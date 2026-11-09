import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import {
  ApplicationConfigurationSchema,
  SnapshotSchema,
  VerificationSchema,
} from '../../../packages/contracts/dist/index.js'

const output = join(dirname(fileURLToPath(import.meta.url)), 'native-mvp')
mkdirSync(output, { recursive: true })
const origin = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5180'
const events = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'access-control-allow-origin': new URL(origin).origin,
    'access-control-allow-credentials': 'true',
  })
  response.write('event: heartbeat\ndata: {}\n\n')
  const timer = setInterval(() => response.write('event: heartbeat\ndata: {}\n\n'), 5000)
  response.once('close', () => clearInterval(timer))
})
await new Promise((resolve) => events.listen(0, '127.0.0.1', resolve))
const conversationId = `console-interface-${crypto.randomUUID()}`
const at = new Date().toISOString(),
  digest = 'a'.repeat(64)
const nativeId = 'profile-codex-native',
  fixtureId = 'profile-fixture-question'
const scope = (id) => ({ projectId: id, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] })
const criteria = [
  { id: 'tests', description: '注册检查通过', kind: 'machine', required: true, checkDefinitionRef: 'node-tests' },
  { id: 'review', description: '审阅当前变更', kind: 'human', required: true },
]
const project = (id, displayName, native = true) => ({
  id,
  displayName,
  scope: native ? scope(id) : { projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
  profileIds: [native ? nativeId : fixtureId],
  defaultProfileId: native ? nativeId : fixtureId,
  defaultCriteria: criteria,
  dispatchAllowed: true,
})
let configuration = ApplicationConfigurationSchema.parse({
  protocol: 'application-configuration/1',
  revision: digest,
  projects: [project('project-atlas', '流程测试', false), project('project-native', '我的本地项目')],
  profiles: [
    {
      id: fixtureId,
      revision: 1,
      displayName: '受控验证 · 权限提问',
      driverId: 'fixture',
      kind: 'controlled_fixture',
      readiness: 'fixture_ready',
      dispatchAllowed: true,
    },
    {
      id: nativeId,
      revision: 1,
      displayName: 'Codex · 本机开发',
      driverId: 'codex-native',
      kind: 'native',
      readiness: 'native_test_passed',
      dispatchAllowed: true,
    },
  ],
  checks: [{ id: 'node-tests', revision: 1, displayName: 'node --test' }],
})
let snapshot = SnapshotSchema.parse({
  cursor: 1,
  works: [],
  questions: [],
  conversation: { conversationId, messages: [], hasMore: false },
})
const commands = [],
  registrations = []
let failImport = true
const patch = `diff --git a/src/example.mjs b/src/example.mjs\n${'+ real change\n'.repeat(1000)}+ PATCH-END\n`
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
const page = await context.newPage(),
  errors = [],
  cases = []
page.on('pageerror', (error) => errors.push(error.message))
const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
await page.route('**/v1/**', async (route) => {
  const request = route.request(),
    url = new URL(request.url())
  if (url.pathname === '/v1/session') return json(route, { status: 'authenticated' })
  if (url.pathname === '/v1/configuration') return json(route, configuration)
  if (url.pathname === '/v1/assistant')
    return json(route, {
      protocol: 'assistant-provider/1',
      configured: false,
      baseURL: null,
      model: null,
      models: [],
      state: 'not_configured',
      secureTransport: false,
    })
  if (url.pathname === '/v1/events') return route.continue({ url: `http://127.0.0.1:${events.address().port}/events` })
  if (url.pathname === '/v1/snapshot') return json(route, snapshot)
  if (url.pathname === '/v1/projects') {
    registrations.push(request.postDataJSON())
    if (failImport) {
      failImport = false
      return json(
        route,
        { error: { code: 'conflict', message: '项目仍有未提交改动，请先提交。', retry: 'user_action' } },
        409,
      )
    }
    configuration = ApplicationConfigurationSchema.parse({
      ...configuration,
      revision: 'b'.repeat(64),
      projects: [...configuration.projects, project('project-imported', registrations.at(-1).displayName)],
    })
    return json(route, configuration)
  }
  if (url.pathname === '/v1/commands') {
    const command = request.postDataJSON()
    commands.push(command)
    if (command.kind === 'create_work') {
      const id = `work-${commands.length}`,
        ticketId = `ticket-${id}`,
        assignmentId = `assignment-${id}`
      const contract = {
        workId: id,
        revision: 1,
        digest,
        goal: command.goal,
        scope: command.scope,
        criteria: command.criteria,
        authorityRef: 'local-authority',
        createdAt: at,
      }
      const ref = { workId: id, revision: 1, digest }
      const view = {
        work: { id, projectId: command.projectId, conversationId, title: command.goal.slice(0, 120), createdAt: at },
        contract,
        links: [{ contract: ref, ticketId, role: 'primary', authorityRef: 'local-authority' }],
        phase: 'verifying',
        coreSnapshotRef: `core-${id}`,
        openQuestionIds: [],
        resourceStatus: 'quiescent',
        evidenceRefs: [],
        artifactIds:
          command.profileId === nativeId
            ? [`manifest-${id}`, `patch-${id}`, `evidence-${id}`]
            : [`manifest-${id}`, `patch-${id}`, `output-${id}`, `evidence-${id}`],
        actions: {
          dispatchHold: { paused: false, revision: 0 },
          currentAssignment: { ticketId, assignmentId, contract: ref },
          currentCandidate: { ticketId, assignmentId, contract: ref, candidateGeneration: 1 },
          currentVerificationId: `verification-${id}`,
          available: ['accept_candidate', 'stop_work'],
        },
      }
      snapshot = SnapshotSchema.parse({
        ...snapshot,
        cursor: snapshot.cursor + 1,
        works: [...snapshot.works, view],
        conversation: {
          ...snapshot.conversation,
          messages: [
            ...snapshot.conversation.messages,
            {
              id: `message-${id}`,
              conversationId,
              sequence: snapshot.cursor + 1,
              role: 'user',
              projectId: command.projectId,
              selectedProfileId: command.profileId,
              anchor: { workId: id },
              provenance: 'trusted_user',
              text: command.goal,
              sourceRefs: [],
              createdAt: at,
            },
          ],
        },
      })
      return json(route, { commandId: command.commandId, status: 'recorded', seq: snapshot.cursor, workId: id })
    }
    throw new Error(`Unexpected test command: ${command.kind}`)
  }
  if (/\/location$/.test(url.pathname))
    return json(route, {
      projectPath: '/Users/example/projects/my-app',
      workspacePath: '/Users/example/.local/share/superagent/workspaces/attempt-very-long-name',
      baseCommit: digest,
    })
  if (url.pathname.startsWith('/v1/verifications/')) {
    const work = snapshot.works.find((item) => item.actions.currentVerificationId === url.pathname.split('/').at(-1))
    return json(
      route,
      VerificationSchema.parse({
        ...work.actions.currentCandidate,
        id: work.actions.currentVerificationId,
        artifactDigest: digest,
        criteriaDigest: digest,
        environmentRef: 'node-fixture',
        verifierIdentityRef: 'verifier-fixture',
        results: [{ criterionId: 'tests', outcome: 'PASS', evidenceRefs: ['test-evidence'] }],
      }),
    )
  }
  if (url.pathname.startsWith('/v1/artifacts/'))
    return route.fulfill({ contentType: 'text/plain', body: url.pathname.includes('/patch-') ? patch : '{}' })
  return json(
    route,
    { error: { code: 'unsupported_capability', message: 'Not wired in this interface fixture', retry: 'none' } },
    422,
  )
})
const step = async (id, action) => {
  try {
    await action()
    cases.push({ id, status: 'PASS' })
  } catch (error) {
    cases.push({ id, status: 'FAIL', message: error.message })
    throw error
  }
}
try {
  await page.goto(`${origin}/?conversation=${conversationId}`)
  await page.locator('.layout').waitFor()
  await step('NATIVE-PROJECT-PREFERRED', async () => {
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    assert.equal(await page.locator('.new-work select').first().inputValue(), 'project-native')
    assert.equal(await page.locator('.new-work select').last().inputValue(), nativeId)
    await page.locator('.new-work').getByRole('button', { name: '取消', exact: true }).click()
  })
  await step('IMPORT-ERROR-KEEPS-DRAFT-AND-RETRY', async () => {
    await page.getByRole('button', { name: '导入项目', exact: true }).click()
    await page.getByLabel('Git 仓库根目录').fill('/Users/example/projects/my-app')
    await page.getByLabel('项目名称', { exact: true }).fill('我的导入项目')
    await page.getByLabel('验收命令', { exact: true }).selectOption('pnpm_test')
    await page.locator('.project-import').getByRole('button', { name: '导入项目', exact: true }).click()
    await page.locator('.project-import [role=alert]').waitFor()
    assert.equal(await page.getByLabel('Git 仓库根目录').inputValue(), '/Users/example/projects/my-app')
    await page.locator('.project-import').getByRole('button', { name: '导入项目', exact: true }).click()
    await page.locator('.new-work').waitFor()
    assert.equal(await page.locator('.new-work select').first().inputValue(), 'project-imported')
    assert.deepEqual(registrations[0], {
      path: '/Users/example/projects/my-app',
      check: 'pnpm_test',
      displayName: '我的导入项目',
    })
    await page.locator('.new-work').getByRole('button', { name: '取消', exact: true }).click()
  })
  await step('CHAT-TO-EXPLICIT-DELEGATION', async () => {
    await page
      .getByRole('textbox', { name: '发送消息', exact: true })
      .fill('实现一个保留原始错误码的重试函数，并添加边界测试。')
    await page.getByRole('button', { name: '委托执行', exact: true }).click()
    assert.equal(commands.length, 0)
    assert.match(await page.locator('.new-work textarea').inputValue(), /原始错误码/)
    await page.locator('.new-work').getByRole('button', { name: '创建委托', exact: true }).click()
    await page.getByRole('heading', { name: '当前工作', exact: true }).waitFor()
    assert.equal(commands.length, 1)
    assert.equal(commands[0].kind, 'create_work')
    assert.equal(commands[0].profileId, nativeId)
    assert.equal('actor' in commands[0], false)
  })
  await step('NATIVE-LOCATION-AND-COMPLETE-PATCH', async () => {
    await page.getByRole('region', { name: '代码位置' }).waitFor()
    assert.match(await page.locator('.work-location').innerText(), /my-app/)
    assert.equal(await page.locator('.artifacts li').count(), 3)
    assert.match(await page.locator('.artifacts').innerText(), /检查证据/)
    assert.doesNotMatch(await page.locator('.artifacts').innerText(), /输出文件/)
    await page.locator('.artifacts li').nth(1).getByRole('button', { name: '查看', exact: true }).click()
    await page.locator('.artifact-text').waitFor()
    assert.match(await page.locator('.artifact-text').innerText(), /PATCH-END/)
    assert.equal(
      await page
        .locator('.artifacts li')
        .nth(1)
        .getByRole('link', { name: '下载', exact: true })
        .getAttribute('download'),
      'changes.patch',
    )
    await page.locator('.artifact-preview').getByRole('button', { name: '关闭预览', exact: true }).click()
  })
  await step('DESKTOP-AND-NARROW', async () => {
    await page.locator('.detail').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '工作详情', exact: true }).click()
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('下一项明确委托')
    await page.getByRole('button', { name: '委托执行', exact: true }).click()
    await page.locator('.new-work').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.screenshot({ path: join(output, 'narrow-delegation.png'), fullPage: true })
  })
  await step('EXPLICIT-FIXTURE-PROJECT-REMAINS-USABLE', async () => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.locator('.new-work').getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    await page.locator('.new-work select').first().selectOption('project-atlas')
    assert.equal(await page.locator('.new-work select').last().inputValue(), fixtureId)
    await page.locator('.new-work textarea').fill('受控流程回归')
    await page.locator('.new-work').getByRole('button', { name: '创建委托', exact: true }).click()
    await page.locator('.artifacts li').filter({ hasText: '输出文件' }).waitFor()
    assert.equal(await page.locator('.artifacts li').count(), 4)
    assert.equal(commands.at(-1).profileId, fixtureId)
    assert.equal(await page.getByRole('heading', { name: '主对话', exact: true }).isVisible(), true)
  })
  await step('BLOCKED-NATIVE-DOES-NOT-FALL-BACK-TO-FIXTURE', async () => {
    configuration = ApplicationConfigurationSchema.parse({
      ...configuration,
      revision: 'c'.repeat(64),
      profiles: configuration.profiles.map((profile) =>
        profile.kind === 'native'
          ? { ...profile, readiness: 'needs_auth', dispatchAllowed: false, blockedReason: 'auth_required' }
          : profile,
      ),
      projects: [
        ...configuration.projects
          .filter((project) => project.id !== 'project-atlas')
          .map((project) => ({
            ...project,
            profileIds: [],
            defaultProfileId: undefined,
            dispatchAllowed: false,
            blockedReason: 'auth_required',
          })),
        configuration.projects.find((project) => project.id === 'project-atlas'),
      ],
    })
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    await page.locator('.new-work').getByRole('button', { name: '刷新配置', exact: true }).click()
    await page
      .locator('.new-work')
      .getByText(/需要重新认证/)
      .waitFor()
    assert.equal(await page.locator('.new-work select').first().inputValue(), 'project-native')
    assert.equal(
      await page.locator('.new-work').getByRole('button', { name: '创建委托', exact: true }).isDisabled(),
      true,
    )
    assert.equal(commands.length, 2)
  })
  assert.equal(errors.length, 0, errors.join('\n'))
} finally {
  await browser.close()
  events.closeAllConnections()
  await new Promise((resolve) => events.close(resolve))
  const report = {
    status:
      cases.length === 7 && cases.every((item) => item.status === 'PASS')
        ? 'PASS_CONSOLE_NATIVE_INTERFACE_FIXTURE'
        : 'FAIL_CONSOLE_NATIVE_INTERFACE_FIXTURE',
    checkedAt: new Date().toISOString(),
    cases,
    errors,
    modelCalls: 0,
    scope: 'Browser and HTTP interface fixture only; actual native execution belongs to main acceptance',
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
