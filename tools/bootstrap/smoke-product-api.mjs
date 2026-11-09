import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8791' },
    state: { type: 'string', default: '.local-state/product-demo' },
    report: { type: 'string' },
  },
})
const url = new URL(values.url)
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    url.protocol === 'http:' &&
    url.pathname === '/' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash,
)
const token = readFileSync(join(resolve(values.state), 'api.key'), 'utf8')
assert.match(token, /^[a-f0-9]{64}$/)
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
async function request(path, options = {}) {
  const response = await fetch(new URL(path, url), { ...options, headers, signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200, `HTTP request failed: ${path} ${response.status}`)
  return response.json()
}
const command = (value) =>
  request('/v1/commands', {
    method: 'POST',
    body: JSON.stringify({ commandId: `smoke-${randomUUID()}`, conversationId: 'conv-main', ...value }),
  })
const configuration = await request('/v1/configuration')
assert.equal(configuration.protocol, 'application-configuration/1')
const project = configuration.projects.find((project) => project.dispatchAllowed)
assert.ok(project, 'A dispatchable controlled scratch project is required')
const profile = configuration.profiles.find((profile) => profile.id === project.defaultProfileId)
assert.equal(profile?.kind, 'controlled_fixture', 'This smoke never dispatches a vendor agent')
assert.equal(profile?.dispatchAllowed, true)
const created = await command({
  kind: 'create_work',
  projectId: project.id,
  profileId: profile.id,
  goal: 'Produce a reviewed scratch artifact',
  scope: project.scope,
  criteria: project.defaultCriteria,
})
assert.equal(created.status, 'recorded')
async function until(read, predicate) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const result = await read()
    if (predicate(result)) return result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Controlled product API condition timed out')
}
const snapshot = await until(
  () => request(`/v1/snapshot?workId=${created.workId}`),
  (snapshot) => snapshot.questions.length === 1,
)
const question = snapshot.questions[0]
assert.deepEqual(question.targets[0].nativeRequestId, { kind: 'integer', decimal: '9223372036854775807' })
assert.equal(
  (
    await command({
      kind: 'answer_question',
      questionId: question.id,
      expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] },
    })
  ).status,
  'recorded',
)
const ready = await until(
  () => request(`/v1/works/${created.workId}`),
  (work) => work.actions.available.includes('accept_candidate'),
)
const verification = await request(`/v1/verifications/${ready.actions.currentVerificationId}`)
assert.ok(verification.results.every((result) => result.outcome === 'PASS'))
const artifact = await fetch(new URL(`/v1/artifacts/${ready.artifactIds[2]}`, url), {
  headers,
  signal: AbortSignal.timeout(5000),
})
assert.equal(await artifact.text(), 'approved product output\n')
assert.equal(
  (await command({ kind: 'accept_candidate', candidate: ready.actions.currentCandidate })).status,
  'recorded',
)
const delivered = await request(`/v1/works/${created.workId}`)
assert.equal(delivered.phase, 'delivered')
assert.deepEqual(delivered.artifactIds, ready.artifactIds)
const report = {
  status: 'PASS_REAL_LOOPBACK_CONTROLLED_PRODUCT',
  checkedAt: new Date().toISOString(),
  node: process.version,
  url: url.origin,
  configurationRevision: configuration.revision,
  workId: created.workId,
  questionId: question.id,
  verificationId: verification.id,
  phase: delivered.phase,
  resourceStatus: delivered.resourceStatus,
  artifactIds: delivered.artifactIds,
  vendorCalls: 0,
}
if (values.report) {
  const path = resolve(values.report)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
