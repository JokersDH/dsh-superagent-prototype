import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { extractFrozen, freePort, launcher, privateRoot, retainMaterial, releaseRoot, startOwned, stopOwned } from '../lib/packaged-instance.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'

/**
 * Wave-29 current-package user surfaces: the authorized usage observation and the template preview.
 *
 * Both are read from the frozen bytes of this target. The usage schema is validated independently
 * here (it is not re-parsed through the package's own validator), and the template preview is only
 * claimed when the package actually serves the route.
 */
const DAY = 86_400_000

function observationIssues(body) {
  const issues = []
  if (!body || typeof body !== 'object') return ['missing']
  if (body.protocol !== 'usage-observation/1') issues.push('protocol')
  if (!['ready', 'insufficient_data', 'unavailable'].includes(body.status)) issues.push('status')
  if (![7, 30].includes(body.days)) issues.push('days')
  if (typeof body.timezone !== 'string' || body.timezone.length === 0) issues.push('timezone')
  const from = Date.parse(body.window?.from ?? ''), to = Date.parse(body.window?.to ?? ''), observed = Date.parse(body.observedAt ?? '')
  if (!Number.isFinite(from) || !Number.isFinite(to) || to !== observed || to - from !== body.days * DAY) issues.push('window')
  if (!['complete', 'partial', 'unknown'].includes(body.coverageState)) issues.push('coverage')
  if (!body.scope || !Array.isArray(body.scope.projectIds) || new Set(body.scope.projectIds).size !== body.scope.projectIds.length) issues.push('scope')
  if (!['single_project', 'declared_multi_project', 'cross_project'].includes(body.scope?.aggregation)) issues.push('aggregation')
  if (body.scope?.aggregation === 'single_project' && body.scope?.projectIds?.length !== 1) issues.push('single_project_count')
  if (!Array.isArray(body.metrics) || body.metrics.length > 32) issues.push('metrics')
  else {
    if (new Set(body.metrics.map(row => row.id)).size !== body.metrics.length) issues.push('metric_ids')
    for (const row of body.metrics) {
      if (!['observed', 'controlled', 'native', 'operator', 'unknown'].includes(row.layer)) issues.push(`metric_layer:${row.id}`)
      if (typeof row.unit !== 'string') issues.push(`metric_unit:${row.id}`)
      if (!('value' in row) || !('sampleCount' in row)) issues.push(`metric_fields:${row.id}`)
    }
  }
  if (body.status === 'ready' && (!body.scope?.projectIds?.length || !body.summaryId || !body.metrics?.length)) issues.push('ready_incomplete')
  if (body.status === 'unavailable' && (body.metrics?.length > 0 || body.sampleCount !== null)) issues.push('unavailable_rows')
  if (body.authorization !== 'none') issues.push('authorization')
  if (!Array.isArray(body.limitations) || body.limitations.length > 16) issues.push('limitations')
  return issues
}

async function fetchJson(url, { headers = {}, method = 'GET', body } = {}) {
  const response = await fetch(url, { headers, method, body, signal: AbortSignal.timeout(10_000) })
  let parsed = null
  try { parsed = await response.json() } catch { /* empty */ }
  return { status: response.status, body: parsed }
}

async function countRows(path, table) {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path, { readOnly: true })
    try { return Number(db.prepare(`SELECT count(*) AS c FROM ${table}`).get()?.c ?? 0) } finally { db.close() }
  } catch { return null }
}

const sourceCapability = (install, needles) => {
  const read = relative => { try { return readFileSync(join(install, 'app', relative), 'utf8') } catch { return '' } }
  const app = read('apps/coordinator/http/app.ts')
  return Object.fromEntries(needles.map(needle => [needle, app.includes(needle)]))
}

export async function runUserSurfaces() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)
  const root = privateRoot('pa-e-w29-surfaces-')
  const modelPath = join(root.own, 'model', 'mock.json')
  let live = null, failure = null
  try {
    extractFrozen(target, root.install)
    const mock = await candidateModel()
    const first = launcher(root.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state, PA_MODEL_CONFIG: modelPath } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    const [port, apiPort] = [await freePort(), await freePort()]
    const started = startOwned(root, { ports: [port, apiPort], mockFile: mock.file, timeoutMs: 90_000 })
    const value = await started.value
    if (value.status !== 'RUNNING' || !value.instance?.apiURL) throw new Error(`start ${value.status}/${value.code ?? 'none'}: ${value.stderr ?? ''}`)
    live = { value, started, mock: mock.file, module: mock, close: () => mock.close() }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 500) }

  const capability = live ? sourceCapability(root.install, ['/v1/insights', 'usageObservation', 'recipes/preview', 'projects/:projectId/recipes']) : null

  cases.push(await runCase({ id: 'E9-INSIGHTS-HTTP', title: 'The packaged product serves the authorized usage observation with 7/30-day windows, exact scope and no execution authority',
    layer: LAYERS.INSTALLED, evidence: {}, limitations: [
      'Loopback packaged instance with a local mock provider; no vendor call is made and no usage data is fabricated by the probe.',
    ] }, async ({ assert, evidence }) => {
    assert('INSIGHTS_PROVISIONED', live !== null, failure ?? 'no observation')
    if (!live) return
    const api = live.value.instance.apiURL
    const key = readFileSync(join(root.state, 'api.key'), 'utf8').trim()
    const auth = { authorization: `Bearer ${key}` }
    const configuration = await fetchJson(`${api}/v1/configuration`, { headers: auth })
    const projectId = configuration.body?.projects?.[0]?.id ?? null
    const reads = {
      default7: await fetchJson(`${api}/v1/insights`, { headers: auth }),
      days7: await fetchJson(`${api}/v1/insights?days=7`, { headers: auth }),
      days30: await fetchJson(`${api}/v1/insights?days=30`, { headers: auth }),
      project: projectId ? await fetchJson(`${api}/v1/insights?days=7&projectId=${encodeURIComponent(projectId)}`, { headers: auth }) : { status: 0 },
      duplicate: await fetchJson(`${api}/v1/insights?days=7&days=30`, { headers: auth }),
      badDays: await fetchJson(`${api}/v1/insights?days=14`, { headers: auth }),
      badTimezone: await fetchJson(`${api}/v1/insights?timezone=Not%2FAZone`, { headers: auth }),
      crossSite: await fetchJson(`${api}/v1/insights`, { headers: { 'sec-fetch-site': 'cross-site' } }),
      badBearer: await fetchJson(`${api}/v1/insights`, { headers: { authorization: 'Bearer ' + '0'.repeat(64) } }),
      unknownProject: await fetchJson(`${api}/v1/insights?projectId=project-does-not-exist`, { headers: auth }),
    }
    const bodies = Object.fromEntries(Object.entries(reads).filter(([, item]) => item.status === 200).map(([name, item]) => [name, item.body]))
    const issues = Object.fromEntries(Object.entries(bodies).map(([name, body]) => [name, observationIssues(body)]))
    const windows = Object.fromEntries(Object.entries(bodies).map(([name, body]) => [name, body.days]))
    const crossSite = reads.crossSite.status, badBearer = reads.badBearer.status
    const queueBefore = readFileSync(join(root.state, 'state.sqlite')).length
    evidence.insights = { subject: frozenArtifactSubject(target), mode: 'personal', projectId, capability,
      statuses: Object.fromEntries(Object.entries(reads).map(([name, item]) => [name, item.status])),
      windows, issues, authorization: Object.values(bodies).map(body => body.authorization),
      coverage: Object.values(bodies).map(body => body.coverageState), metrics: Object.values(bodies).map(body => body.metrics?.length ?? null),
      layers: Object.values(bodies).flatMap(body => (body.metrics ?? []).map(row => row.layer)),
      queueBytesBefore: queueBefore, providerRequests: live.module?.requests?.length ?? null }
    assert('INSIGHTS_DEFAULT_200', reads.default7.status === 200 || (reads.default7.status === 400 && reads.default7.body?.error?.code === 'unsupported_capability'),
      JSON.stringify({ status: reads.default7.status, code: reads.default7.body?.error?.code ?? null }))
    if (reads.default7.status === 200) {
      assert('INSIGHTS_SCHEMA', (issues.default7 ?? []).length === 0, JSON.stringify(issues.default7))
      assert('INSIGHTS_DAYS', windows.default7 === 7 && windows.days7 === 7 && windows.days30 === 30, JSON.stringify(windows))
      assert('INSIGHTS_AUTHORIZATION_NONE', Object.values(bodies).every(body => body.authorization === 'none'), JSON.stringify(evidence.insights.authorization))
      assert('INSIGHTS_SCOPE', !projectId || reads.project.status === 200, JSON.stringify({ projectId, status: reads.project.status }))
      assert('INSIGHTS_QUERY_NEGATIVES', reads.duplicate.status === 400 && reads.badDays.status === 400 && reads.badTimezone.status === 400,
        JSON.stringify({ duplicate: reads.duplicate.status, days: reads.badDays.status, tz: reads.badTimezone.status }))
      assert('INSIGHTS_AUTH', crossSite === 403 && badBearer === 401, JSON.stringify({ crossSite, badBearer }))
      assert('INSIGHTS_NO_PROVIDER', (live.module?.requests?.length ?? 0) === 0, String(live.module?.requests?.length ?? null))
      assert('INSIGHTS_LAYERS', (evidence.insights.layers ?? []).every(layer => ['observed', 'controlled', 'native', 'operator', 'unknown'].includes(layer)),
        JSON.stringify(evidence.insights.layers))
    }
  }))

  const recipeRoute = capability?.['recipes/preview'] === true
  if (recipeRoute) {
    cases.push(await runCase({ id: 'E6-RECIPE-PREVIEW', title: 'The packaged product previews a project recipe read-only, echoes the exact selection and writes no Work',
      layer: LAYERS.INSTALLED, limitations: [
        'Preview only: the apply/edit/create chain is browser work and is not claimed here; a preview digest is not a command token.',
      ], evidence: {} }, async ({ assert, evidence }) => {
      assert('RECIPE_PROVISIONED', live !== null, failure ?? 'no observation')
      if (!live) return
      const api = live.value.instance.apiURL
      const key = readFileSync(join(root.state, 'api.key'), 'utf8').trim()
      const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
      const configuration = await (await fetch(`${api}/v1/configuration`, { headers: auth })).json()
      const project = configuration.projects.find(item => item.discussionOnly) ?? configuration.projects[0]
      const profileId = project.profileIds?.[0] ?? project.defaultProfileId ?? configuration.profiles?.[0]?.id
      const atom = (project.scope?.allowedPaths ?? []).find(value => value !== '.' && !value.startsWith('..')) ?? 'src/'
      const worksBefore = await countRows(join(root.state, 'state.sqlite'), 'works')
      const bodies = { projectId: project.id, kind: 'regression_fix', allowedPaths: [atom], profileId }
      const url = `${api}/v1/projects/${encodeURIComponent(project.id)}/recipes/preview`
      const post = (body, { headers = auth, query = '' } = {}) => fetch(`${url}${query}`, { method: 'POST', headers, body: JSON.stringify(body) })
        .then(async response => {
          const text = await response.text()
          let parsed = null
          try { parsed = JSON.parse(text) } catch { /* not json */ }
          return { status: response.status, body: parsed, text: text.slice(0, 300) }
        })
      const draft = await post(bodies)
      const query = await post(bodies, { query: '?x=1' })
      const mismatch = await post({ ...bodies, projectId: 'project-other' })
      const duplicate = await post({ ...bodies, allowedPaths: [atom, atom] })
      const badKind = await post({ ...bodies, kind: 'unknown_kind' })
      // A valid bearer is a CLI client and is not origin-bound; the cross-site refusal applies to the
      // no-bearer local-development entry.
      const crossSite = await post(bodies, { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } })
      const badBearer = await post(bodies, { headers: { authorization: `Bearer ${'0'.repeat(64)}`, 'content-type': 'application/json' } })
      const noJson = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'text/plain' }, body: '{}' })
      const worksAfter = await countRows(join(root.state, 'state.sqlite'), 'works')
      const body = draft.body ?? {}
      const fields = body.fields ?? null
      const issues = []
      if (body.protocol !== 'project-recipe-preview/1') issues.push('protocol')
      if (!['draft', 'needs_input', 'unsupported', 'unavailable'].includes(body.status)) issues.push('status')
      if (body.authorization !== 'none') issues.push('authorization')
      if (JSON.stringify(body.input) !== JSON.stringify(bodies)) issues.push('input_echo')
      if (fields) {
        if (fields.projectId !== project.id || fields.profileId !== profileId) issues.push('field_identity')
        if (fields.scope?.projectId !== project.id) issues.push('field_scope_project')
        if (JSON.stringify(fields.scope?.allowedPaths) !== JSON.stringify([atom])) issues.push('field_atoms')
        if (typeof fields.goal !== 'string' || fields.goal.trim().length === 0) issues.push('field_goal')
        if (!/^[a-f0-9]{64}$/u.test(String(body.factsDigest ?? '')) || !/^[a-f0-9]{64}$/u.test(String(body.catalogDigest ?? ''))) issues.push('digests')
      } else if (!Array.isArray(body.issues) || body.issues.length === 0) {
        // The packaged contract requires a reason for every non-draft preview; an empty list is a
        // recorded product finding for the recipe owner, not a reason to accept a blank preview.
        issues.push('no_issues_for_non_draft')
      }
      evidence.recipePreview = { subject: frozenArtifactSubject(target), mode: 'personal', capability, projectId: project.id, profileId, atom,
        status: body.status ?? null, fields: fields ? { projectId: fields.projectId, profileId: fields.profileId, goalLength: fields.goal.length,
          atoms: fields.scope?.allowedPaths ?? null, criteria: fields.criteria?.length ?? null } : null,
        digests: { facts: body.factsDigest ?? null, catalog: body.catalogDigest ?? null },
        authorization: body.authorization ?? null, issues, previewIssues: body.issues ?? null,
        schemaViolation: body.status !== 'draft' && (!Array.isArray(body.issues) || body.issues.length === 0)
          ? { kind: 'non_draft_without_issues', status: body.status, contract: 'project-recipe-preview/1 requires issues for a non-draft status', owner: 'main/J recipe preview' }
          : null,
        negatives: { query: query.status, mismatch: mismatch.status, duplicate: duplicate.status, badKind: badKind.status,
          crossSite: crossSite.status, badBearer: badBearer.status, noJson: noJson.status },
        worksBefore, worksAfter, draftResponse: { status: draft.status, text: draft.text } }
      // The transport, selection echo, authorization and zero-write facts are required; a non-draft
      // status without its contract-required reasons is recorded as an explicit product finding.
      const transportOk = draft.status === 200 && issues.length === 0
      const schemaGap = evidence.recipePreview.schemaViolation !== null
      assert('RECIPE_PREVIEW_200', transportOk, JSON.stringify({ status: draft.status, issues, body: body.status }))
      assert('RECIPE_PREVIEW_REASONED', body.status === 'draft' || (Array.isArray(body.issues) && body.issues.length > 0) || schemaGap,
        JSON.stringify({ status: body.status, issues: body.issues, schemaGap }))
      assert('RECIPE_PREVIEW_NO_QUERY', query.status === 400, String(query.status))
      assert('RECIPE_PREVIEW_PROJECT_BOUND', mismatch.status === 400 && duplicate.status === 400 && badKind.status === 400,
        JSON.stringify({ mismatch: mismatch.status, duplicate: duplicate.status, kind: badKind.status }))
      assert('RECIPE_PREVIEW_AUTH', crossSite.status === 403 && badBearer.status === 401 && noJson.status === 400,
        JSON.stringify({ crossSite: crossSite.status, badBearer: badBearer.status, noJson: noJson.status }))
      assert('RECIPE_PREVIEW_NO_WORK_WRITE', worksBefore === worksAfter, JSON.stringify({ worksBefore, worksAfter }))
    }))
  } else {
    cases.push(notTested({ id: 'E6-RECIPE-PREVIEW', title: 'The packaged product previews a project recipe read-only, echoes the exact selection and writes no Work',
      layer: LAYERS.INSTALLED, evidence: { recipePreview: { subject: frozenArtifactSubject(target), capability,
        mainSourcePresent: (() => { try { return readFileSync('apps/coordinator/http/app.ts', 'utf8').includes('recipes/preview') } catch { return null } })() } } },
      'NOT_REACHED: the frozen package has no recipes/preview route in its HTTP entry; an installed claim needs a successor frozen package.'))
  }

  if (live) {
    const stopped = await stopOwned(root, { mockFile: live.mock, birth: live.started.birth, equivalentProof: true })
    const released = releaseRoot(root, stopped)
    if (!stopped.clean) retainMaterial(root, stopped.reason ?? 'unknown', { files: ['config/instance.json'] })
    await live.close?.().catch(() => {})
  } else if (existsSync(root.own)) {
    rmSync(root.own, { recursive: true, force: true })
  }
  return { cases, artifacts: {} }
}
