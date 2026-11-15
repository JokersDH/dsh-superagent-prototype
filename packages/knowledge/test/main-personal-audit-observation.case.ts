import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { buildPersonalChain, principal, projectId, reviewScope } from './helpers/personal-chain.ts'

const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }

test('source audit and display observation export stay scoped, read-only and explicitly non-numeric', { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-audit-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const database = join(chain.source, 'state.sqlite')
  const runtime = createProductRuntime({ store: new ProductStore({ path: database }), principal,
    projects: [{ id: projectId, scope: reviewScope }], actionSecret: Buffer.alloc(32, 121), stateRoot: chain.source,
    scratchProject: chain.scratch, executionUnavailable: 'operator_disabled' })
  const app = createLocalHttpApp({ application: runtime.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: runtime.read, operations: runtime.operations })
  runtime.start()
  const works = async () => ((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works
  const baseline = (await works()).length
  let observations: Record<string, any>
  try {
    // Source/frozen audit remains the same original data as history/evidence.
    const context = (await (await app.request(`/v1/messages/${encodeURIComponent(chain.contextMessageId)}/context`, { headers })).json()) as Record<string, any>
    assert.equal(context.bundleDigest, chain.frozenDigest)
    const sourcesResponse = await app.request(`/v1/messages/${encodeURIComponent(chain.contextMessageId)}/context/sources`, { headers })
    assert.equal(sourcesResponse.status, 200)
    const sources = (await sourcesResponse.json()) as Record<string, any>
    assert.equal(JSON.stringify(sources).includes(root), false)
    assert.equal(JSON.stringify(sources).includes('excludedPaths'), true)
    const evidence = (await (await app.request(`/v1/works/${chain.workId}/evidence`, { headers })).json()) as Record<string, any>
    assert.equal(evidence.workId, chain.workId)

    for (const days of [7, 30]) {
      const observation = (await (await app.request(`/v1/insights?days=${days}&projectId=${projectId}&timezone=UTC`, { headers })).json()) as Record<string, any>
      assert.equal(observation.protocol, 'usage-observation/1')
      assert.equal(observation.authorization, 'none')
      assert.equal(observation.days, days)
      assert.deepEqual(observation.scope.projectIds, [projectId])
      const downloadResponse = await app.request(`/v1/insights/export?days=${days}&projectId=${projectId}&timezone=UTC`, { headers })
      assert.equal(downloadResponse.status, 200)
      assert.equal(downloadResponse.headers.get('cache-control'), 'no-store')
      const download = (await downloadResponse.json()) as Record<string, any>
      assert.equal(download.protocol, 'usage-observation-download/1')
      assert.match(download.fileName, /^observation-(7|30)d-[a-f0-9]{12}\.json$/)
      assert.equal(download.mediaType, 'application/json')
      assert.equal(createHash('sha256').update(download.text).digest('hex'), download.sha256)
      const exported = JSON.parse(download.text) as Record<string, any>
      assert.equal(exported.protocol, 'usage-insights-display-export/1')
      assert.equal(exported.authorization, 'none')
      assert.equal(exported.sourceIdentity.kind, 'display_dto')
      assert.equal(exported.sourceIdentity.numericValues, false)
      assert.deepEqual(exported.scope.projectIds, observation.scope.projectIds)
      assert.equal(exported.window.to, exported.exportedFrom.observedAt)
      assert.equal(Date.parse(exported.window.to) - Date.parse(exported.window.from), days * 86400000)
      assert.equal(exported.exportedFrom.days, days)
      assert.equal(exported.exportedFrom.observationProtocol, 'usage-observation/1')
      assert.equal(JSON.stringify(exported).includes(root), false)
      assert.equal(JSON.stringify(exported).includes('Bearer'), false)
      observations = observation
    }

    const foreign = await app.request('/v1/insights/export?days=7&projectId=not-registered', { headers })
    assert.equal(foreign.status, 403)
    const invalidWindow = await app.request(`/v1/insights/export?days=90&projectId=${projectId}`, { headers })
    assert.equal(invalidWindow.status, 400)
    assert.equal((await works()).length, baseline)
  } finally { await runtime.close().catch(() => undefined) }

  // An expired project selection cannot be used for ordinary context reads or new work.
  const past = new Date(Date.now() - 60_000).toISOString()
  const expired = createProductRuntime({ store: new ProductStore({ path: database }), principal,
    projects: [{ id: projectId, scope: { ...reviewScope, expiresAt: past } }], actionSecret: Buffer.alloc(32, 121),
    stateRoot: chain.source, scratchProject: chain.scratch, executionUnavailable: 'operator_disabled' })
  const expiredApp = createLocalHttpApp({ application: expired.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: expired.read, operations: expired.operations })
  expired.start()
  try {
    const preview = await expiredApp.request('/v1/context/preview', { method: 'POST', headers,
      body: JSON.stringify({ projectId, conversationId: chain.contextMessageId, selections: ['conversation'],
        budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } }) })
    assert.equal(preview.status >= 400, true)
    const worksAfter = ((await (await expiredApp.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works
    assert.equal(worksAfter.length, baseline)
  } finally { await expired.close().catch(() => undefined) }

  assert.equal(chain.model.requests.length, chain.modelCalls)
  assert.equal(observations!.authorization, 'none')
})
