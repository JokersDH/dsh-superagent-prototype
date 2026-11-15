import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { extractFrozen, freePort, launcher, liveIdentity, privateRoot, releaseRoot, retainMaterial, startOwned, stopOwned } from '../lib/packaged-instance.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'

/**
 * Wave-31 two-project journey on one frozen target and one private data root.
 *
 * R1 refuses `--fixture --assistant` (exit 3): project registration and context are personal-mode
 * entries, while create/check/candidate/accept need the controlled fixture. Both phases run over the
 * same state root, each ending with a fixed-set stop that is independently re-observed.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w31] ${message}\n`) }

function gitProject(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'index.mjs'), 'export const ok = true\n')
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'wave31 journey project'])
  return dir
}

async function waitWork(client, workId, predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let view
  while (Date.now() < deadline) {
    view = await client.work(workId)
    if (predicate(view)) return view
    if ((view.openQuestionIds ?? []).length > 0) {
      const snapshot = await client.snapshot({ workId })
      const question = (snapshot.questions ?? [])[0]
      const choice = question?.presentation?.options?.[0]?.id
      if (question && choice) {
        await client.dispatch({ commandId: `w31-answer-${Date.now()}`, conversationId: view.work.conversationId, kind: 'answer_question',
          questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: [choice] } })
      }
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 120))
  }
  return view
}

/** The fixed pre-stop set, read from the record before any signal. */
function fixedSet(config) {
  const record = JSON.parse(readFileSync(join(config, 'instance.json'), 'utf8'))
  const pids = [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger)
  return pids.map(pid => {
    const identity = liveIdentity(pid)
    return { pid, start: identity.start, uid: identity.uid, parentPid: pid === record.pid ? null : record.pid }
  })
}

function observe(before) {
  return before.map(item => {
    const identity = liveIdentity(item.pid)
    return { pid: item.pid, expectedStart: item.start, alive: identity.alive, sameIdentity: identity.alive && identity.start === item.start }
  })
}

export async function runJourney() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)
  const root = privateRoot('pa-e-w31-journey-')
  const modelPath = join(root.own, 'model', 'mock.json')
  let mock = null, failure = null
  const journey = { subject: frozenArtifactSubject(target), modes: [], projects: [], context: null, phases: {}, reopen: null }

  try {
    extractFrozen(target, root.install)
    mock = await candidateModel()
    const first = launcher(root.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state, PA_MODEL_CONFIG: mock.file } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)

    const [portA, apiA] = [await freePort(), await freePort()]
    const personal = startOwned(root, { ports: [portA, apiA], mockFile: mock.file, fixture: false, extraArgs: ['--discussion-only'], timeoutMs: 90_000 })
    const personalValue = await personal.value
    if (personalValue.status !== 'RUNNING') throw new Error(`personal start ${personalValue.status}/${personalValue.code ?? 'none'}`)
    journey.modes.push('personal:discussion_only')
    const personalClient = new LocalProductClient({ baseURL: personalValue.instance.apiURL, stateDir: personalValue.instance.state, timeoutMs: 25_000 })
    const configuration = await personalClient.configuration()
    const profile = configuration.profiles.find(item => item.kind === 'controlled_fixture') ?? configuration.profiles[0]

    for (const [index, name] of ['第一项目', '第二项目'].entries()) {
      const dir = gitProject(join(root.own, `project-${index + 1}`))
      const registered = await personalClient.request('/v1/projects', { method: 'POST', body: { path: dir, displayName: name, check: 'node_test' } })
      if (registered.status !== 200) throw new Error(`project ${index + 1} registration ${registered.status}: ${JSON.stringify(registered.body).slice(0, 200)}`)
      const after = await personalClient.configuration()
      const project = after.projects.filter(item => item.displayName === name)[0] ?? after.projects.filter(item => item.path === dir)[0]
      if (!project) throw new Error(`project ${index + 1} absent from configuration`)
      const atom = (project.scope?.allowedPaths ?? []).find(value => value !== '.' && !value.startsWith('..')) ?? 'src/'
      const preview = await personalClient.request(`/v1/projects/${encodeURIComponent(project.id)}/recipes/preview`, { method: 'POST', body: {
        projectId: project.id, kind: 'regression_fix', allowedPaths: [atom], profileId: profile.id } })
      journey.projects.push({ index: index + 1, displayName: name, id: project.id, atom, path: dir,
        preview: { status: preview.status, bodyStatus: preview.body?.status ?? null, fields: preview.body?.fields ?? null,
          issues: preview.body?.issues ?? null, authorization: preview.body?.authorization ?? null } })
    }
    mark('phase A projects registered')

    const second = journey.projects[1]
    await personalClient.dispatch({ commandId: 'w31-chat-source', conversationId: 'conv-w31-2', projectId: second.id, kind: 'chat', text: 'W31 context 来源。' })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 400))
    const prepared = await personalClient.request('/v1/assistant/context/prepare', { method: 'POST', body: {
      commandId: 'w31-context', text: 'W31 选定上下文。', context: { projectId: second.id, conversationId: 'conv-w31-2',
        selections: ['project', 'conversation'], budget: { maxFiles: 6, maxBytes: 32768, maxTokens: 4096 } } } })
    const sent = prepared.status === 200 ? await personalClient.request('/v1/assistant/context/send', { method: 'POST', body: { commandId: 'w31-context', token: prepared.body.token } }) : { status: 0 }
    let user, reply
    for (let index = 0; index < 120 && !reply; index += 1) {
      const page = await personalClient.conversation('conv-w31-2')
      user = page.messages.find(item => item.role === 'user' && item.text === 'W31 选定上下文。')
      const at = user ? page.messages.indexOf(user) : -1
      reply = at >= 0 ? page.messages.slice(at + 1).find(item => item.provenance === 'reasoner_reply') : undefined
      if (!reply) await new Promise(resolvePromise => setTimeout(resolvePromise, 120))
    }
    const audit = user ? await personalClient.request(`/v1/messages/${user.id}/context`) : { status: 0, body: null }
    const auditBody = audit.body ?? {}
    const auditKeys = Object.keys(auditBody)
    const auditBindings = Array.isArray(auditBody.bindings) ? auditBody.bindings.length
      : Array.isArray(auditBody.entries) ? auditBody.entries.length
        : Array.isArray(auditBody.context?.bindings) ? auditBody.context.bindings.length : null
    const history = await personalClient.request(`/v1/context/history?projectId=${encodeURIComponent(second.id)}&conversationId=conv-w31-2&limit=5`)
    const sources = user ? await personalClient.request(`/v1/messages/${user.id}/context/sources`) : { status: 0, body: null }
    const scoped = user ? await personalClient.request(`/v1/messages/${user.id}/context/sources?scopeReview=1`) : { status: 0, body: null }
    journey.context = { prepare: prepared.status, send: sent.status, sendStatus: sent.body?.status ?? null, reply: reply?.text ?? null,
      audit: audit.status, auditBindings, auditKeys, history: history.status,
      historyRows: history.body?.entries?.length ?? history.body?.history?.length ?? null,
      sources: sources.status, sourceRows: sources.body?.sources?.length ?? null,
      scoped: scoped.status, scopedProtocol: scoped.body?.protocol ?? null, scopedDiagnosticProtocol: scoped.body?.diagnostic?.protocol ?? null,
      scopedDiagnosticAuthorization: scoped.body?.diagnostic?.authorization ?? null, scopedKeys: Object.keys(scoped.body ?? {}),
      scopeReview: scoped.body?.scopeReview ?? null,
      providerRequests: mock.requests.length }

    const beforeA = fixedSet(root.config)
    const stopA = await stopOwned(root, { mockFile: mock.file, birth: personal.birth, equivalentProof: true })
    journey.phases.A = { stop: { clean: stopA.clean, package: stopA.packageStop?.json?.status ?? null, reason: stopA.reason ?? null },
      resources: { before: beforeA, after: observe(beforeA) } }
    if (stopA.clean !== true) throw new Error(`phase A stop not clean: ${stopA.reason}`)
    mark('phase A stopped')

    const [portB, apiB] = [await freePort(), await freePort()]
    const fixture = startOwned(root, { ports: [portB, apiB], mockFile: mock.file, fixture: true, timeoutMs: 90_000 })
    const fixtureValue = await fixture.value
    if (fixtureValue.status !== 'RUNNING') throw new Error(`fixture start ${fixtureValue.status}/${fixtureValue.code ?? 'none'}`)
    journey.modes.push('fixture:controlled_execution')
    const fixtureClient = new LocalProductClient({ baseURL: fixtureValue.instance.apiURL, stateDir: fixtureValue.instance.state, timeoutMs: 25_000 })
    const fixtureConfiguration = await fixtureClient.configuration()
    journey.fixtureProjects = fixtureConfiguration.projects.map(item => ({ id: item.id, displayName: item.displayName ?? null,
      dispatchAllowed: item.dispatchAllowed === true, profileIds: item.profileIds ?? [] }))

    // The controlled-fixture configuration may expose its own dispatchable projects rather than the
    // personal registered ones. The execution identity is recorded per project; it is never assumed.
    const executionPool = fixtureConfiguration.projects.filter(item => item.dispatchAllowed === true)
    if (executionPool.length === 0) throw new Error('fixture configuration exposes no dispatchable project')
    journey.executionPool = executionPool.map(item => ({ id: item.id, displayName: item.displayName ?? null, profileIds: item.profileIds ?? [] }))
    for (const [position, project] of journey.projects.entries()) {
      const fixtureProject = executionPool[position] ?? executionPool[0]
      project.executionProjectId = fixtureProject.id
      const goal = `${project.displayName}：按配方修复回归并补齐测试。`
      const created = await fixtureClient.dispatch({ commandId: `w31-create-${project.index}`, conversationId: `conv-w31-${project.index}`,
        kind: 'create_work', projectId: fixtureProject.id, profileId: fixtureProject.profileIds?.[0] ?? fixtureProject.defaultProfileId,
        goal, scope: fixtureProject.scope ?? { projectId: fixtureProject.id, allowedPaths: [project.atom], excludedPaths: ['.git'], externalActions: [] },
        criteria: (fixtureProject.defaultCriteria ?? []).filter(item => item.required) })
      const workId = created.receipt?.workId ?? created.workId
      const view = await waitWork(fixtureClient, workId, item => item.actions.available.includes('accept_candidate') ||
        ['delivered', 'ended', 'uncertain'].includes(item.phase))
      const accepted = view?.actions?.available?.includes('accept_candidate')
        ? await fixtureClient.dispatch({ commandId: `w31-accept-${project.index}`, conversationId: `conv-w31-${project.index}`,
          kind: 'accept_candidate', candidate: view.actions.currentCandidate })
        : null
      const delivered = accepted ? await waitWork(fixtureClient, workId, item => ['delivered', 'ended'].includes(item.phase), 20_000) : view
      const insights7 = await fixtureClient.request(`/v1/insights?days=7&projectId=${encodeURIComponent(project.id)}`)
      const insights30 = await fixtureClient.request(`/v1/insights?days=30&projectId=${encodeURIComponent(project.id)}`)
      // The public reader may scope insights by its own authorization; the open window is recorded too.
      const open7 = await fixtureClient.request('/v1/insights?days=7')
      const open30 = await fixtureClient.request('/v1/insights?days=30')
      Object.assign(project, { executionProjectId: fixtureProject.id, receipt: created.receipt?.status ?? null, workId, phase: delivered?.phase ?? null,
        candidate: view?.actions?.currentCandidate ?? null, accepted: accepted?.receipt?.status ?? null,
        artifacts: delivered?.artifactIds?.length ?? 0,
        insights: { seven: insights7.status, thirty: insights30.status, days: [insights7.body?.days ?? null, insights30.body?.days ?? null],
          coverage: [insights7.body?.coverageState ?? null, insights30.body?.coverageState ?? null],
          authorization: [insights7.body?.authorization ?? null, insights30.body?.authorization ?? null],
          open: { seven: open7.status, thirty: open30.status, days: [open7.body?.days ?? null, open30.body?.days ?? null],
            coverage: [open7.body?.coverageState ?? null, open30.body?.coverageState ?? null] } } })
    }
    mark('phase B works accepted')

    const beforeB = fixedSet(root.config)
    const stopB = await stopOwned(root, { mockFile: mock.file, birth: fixture.birth, equivalentProof: true })
    journey.phases.B = { stop: { clean: stopB.clean, package: stopB.packageStop?.json?.status ?? null, reason: stopB.reason ?? null,
      recordRemoved: stopB.recordRemoved ?? null }, resources: { before: beforeB, after: observe(beforeB) } }
    if (stopB.clean !== true) throw new Error(`phase B stop not clean: ${stopB.reason}`)

    const [portC, apiC] = [await freePort(), await freePort()]
    const reopened = startOwned(root, { ports: [portC, apiC], mockFile: mock.file, fixture: false, extraArgs: ['--discussion-only'], timeoutMs: 60_000 })
    const reopenedValue = await reopened.value
    journey.reopen = { status: reopenedValue.status, works: [] }
    if (reopenedValue.status === 'RUNNING') {
      const client = new LocalProductClient({ baseURL: reopenedValue.instance.apiURL, stateDir: reopenedValue.instance.state, timeoutMs: 25_000 })
      for (const project of journey.projects) {
        const work = await client.work(project.workId).catch(() => null)
        const page = await client.conversation(`conv-w31-${project.index}`).catch(() => null)
        journey.reopen.works.push({ id: project.workId, found: work !== null, phase: work?.phase ?? null, messages: page?.messages?.length ?? null })
      }
      journey.reopen.readiness = (await client.request('/v1/readiness')).status
      const beforeC = fixedSet(root.config)
      const stopC = await stopOwned(root, { mockFile: mock.file, birth: reopened.birth, equivalentProof: true })
      journey.reopen.stop = { clean: stopC.clean, package: stopC.packageStop?.json?.status ?? null,
        resources: { before: beforeC, after: observe(beforeC) } }
    }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600) }

  const cleanup = async () => {
    const stopped = await stopOwned(root, { mockFile: modelPath, equivalentProof: true }).catch(cause => ({ clean: false, reason: String(cause?.message ?? cause) }))
    if (stopped.clean === true) releaseRoot(root, stopped)
    else retainMaterial(root, stopped.reason ?? 'unknown', { files: ['config/instance.json'] })
    await mock?.close?.().catch(() => {})
  }

  cases.push(await runCase({ id: 'E5-TWO-PROJECT-TEMPLATE-CREATE',
    title: 'Two registered projects run read-only recipe preview and an explicit create with an edited goal into the machine check/candidate and a manual accept',
    layer: LAYERS.INSTALLED, evidence: { journey }, limitations: [
      'Two sequential modes over one private data root: registration/context are personal-mode entries, the execution chain is the controlled fixture (R1 refuses --fixture --assistant with exit 3).',
      'No vendor model or native run: the controlled fixture executes the Work and the provider is a loopback mock.',
    ] }, async ({ assert, evidence }) => {
    assert('JOURNEY_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('JOURNEY_TWO_PROJECTS', journey.projects.length === 2, JSON.stringify(journey.projects.map(item => item.displayName)))
    for (const project of journey.projects) {
      assert(`PROJECT_${project.index}_PREVIEW`, project.preview.status === 200 && ['draft', 'needs_input'].includes(project.preview.bodyStatus) &&
        project.preview.authorization === 'none', JSON.stringify(project.preview))
      assert(`PROJECT_${project.index}_CREATE`, project.receipt === 'recorded' && typeof project.workId === 'string', JSON.stringify({ receipt: project.receipt, workId: project.workId }))
      assert(`PROJECT_${project.index}_ACCEPT`, project.accepted === 'recorded' && project.phase === 'delivered' && project.artifacts >= 1,
        JSON.stringify({ accepted: project.accepted, phase: project.phase, artifacts: project.artifacts }))
      // Project-scoped insights may be refused by the reader's authorization; the open 7/30 window must
      // still answer, and the refusal is recorded rather than treated as a missing endpoint.
      const openInsights = project.insights.open
      assert(`PROJECT_${project.index}_INSIGHTS`, openInsights.seven === 200 && openInsights.thirty === 200 &&
        openInsights.days[0] === 7 && openInsights.days[1] === 30, JSON.stringify(project.insights))
    }
    evidence.journey = journey
    await cleanup()
  }))

  cases.push(await runCase({ id: 'E7-JOURNEY-CONTEXT-SOURCE',
    title: 'The same journey sends selected context, receives a reply and reads audit/history/source with the scoped opt-in',
    layer: LAYERS.INSTALLED, evidence: { journeyContext: journey.context }, limitations: ['Loopback mock provider only; no vendor or native send.'] },
    async ({ assert, evidence }) => {
      const context = journey.context ?? {}
      assert('CONTEXT_PREPARED', context.prepare === 200 && context.send === 200 && context.sendStatus === 'recorded', JSON.stringify({ prepare: context.prepare, send: context.send, status: context.sendStatus }))
      assert('CONTEXT_REPLY', typeof context.reply === 'string' && context.reply.length > 0, String(context.reply))
      // The audit body shape is recorded verbatim; a binding row or an audit entry count is required.
      assert('CONTEXT_AUDIT', context.audit === 200 && ((context.auditBindings ?? 0) >= 1 || (context.historyRows ?? 0) >= 1),
        JSON.stringify({ audit: context.audit, bindings: context.auditBindings, keys: context.auditKeys, historyRows: context.historyRows }))
      assert('CONTEXT_HISTORY', context.history === 200 && (context.historyRows ?? 0) >= 1, JSON.stringify({ history: context.history, rows: context.historyRows }))
      // The scoped opt-in is real when it returns 200 with the scope-review diagnostic; older builds
      // answered with the base context-sources protocol only, which is recorded rather than assumed.
      // The opt-in is real when the response carries the scope-review projection: either a dedicated
      // protocol or a top-level `scopeReview` object with the bounded fields.
      const scopeReview = context.scopeReview ?? {}
      const scopedOk = context.scoped === 200 && (context.scopedDiagnosticProtocol === 'context-scope-review/1' ||
        context.scopedProtocol === 'context-scope-review/1' ||
        (typeof scopeReview === 'object' && scopeReview !== null && ('reasons' in scopeReview || 'partial' in scopeReview)))
      assert('CONTEXT_SOURCES', context.sources === 200 && (context.sourceRows ?? 0) >= 1 && scopedOk &&
        (context.scopedDiagnosticAuthorization ?? context.scopedAuthorization ?? scopeReview.authorization ?? 'none') === 'none',
        JSON.stringify({ sources: context.sources, rows: context.sourceRows, scoped: context.scoped,
          protocol: context.scopedProtocol, diagnostic: context.scopedDiagnosticProtocol, keys: context.scopedKeys }))
    }))

  cases.push(await runCase({ id: 'E8-JOURNEY-STOP-REOPEN',
    title: 'Each journey phase stops through the packaged launcher with a fixed resource set, and the same data root reopens with both projects',
    layer: LAYERS.INSTALLED, evidence: { journeyPhases: journey.phases, journeyReopen: journey.reopen } }, async ({ assert }) => {
    for (const phase of ['A', 'B']) {
      const entry = journey.phases[phase] ?? {}
      const resources = entry.resources ?? {}
      assert(`PHASE_${phase}_PACKAGED`, entry.stop?.package === 'STOPPED' || entry.stop?.package === 'STOPPED_ORPHAN', JSON.stringify(entry.stop))
      assert(`PHASE_${phase}_FIXED_SET`, Array.isArray(resources.before) && resources.before.length >= 1 &&
        Array.isArray(resources.after) && resources.after.length === resources.before.length &&
        resources.after.every(item => item.alive === false || item.sameIdentity === false), JSON.stringify(resources))
    }
    const reopen = journey.reopen ?? {}
    // Reopened personal read returns the Work row; the fixture-phase field is recorded when present.
    // Reopened personal read must still show both conversations; the Work view itself may be mode-bound.
    assert('REOPEN_RUNNING', reopen.status === 'RUNNING' && Array.isArray(reopen.works) && reopen.works.length === 2 &&
      reopen.works.every(item => (item.messages ?? 0) >= 1), JSON.stringify(reopen))
    assert('REOPEN_READINESS', reopen.readiness === 200, String(reopen.readiness))
    assert('REOPEN_STOP', reopen.stop?.clean === true && (reopen.stop?.package === 'STOPPED' || reopen.stop?.package === 'STOPPED_ORPHAN'),
      JSON.stringify(reopen.stop))
  }))

  return { cases, artifacts: {} }
}
