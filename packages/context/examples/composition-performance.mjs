#!/usr/bin/env node
/**
 * Deterministic composition performance probe.
 *
 * Bounded synthetic dataset (documents/decisions/conversation/artifacts), fixed `now`, repeated
 * composition. It reports bounded-output and source-completeness facts, not a billing or model claim.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContextComposer, StaticContextPort, sha256Text } from '../dist/index.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = '2026-11-11T00:00:00.000Z'
const scope = { projectId: 'perf-project', allowedPaths: ['docs', 'src'], excludedPaths: [], externalActions: [] }
const FILES = 80
const DECISIONS = 120
const MESSAGES = 60
const ARTIFACTS = 40

function sources() {
  const list = []
  for (let index = 0; index < FILES; index += 1) {
    const path = index % 2 === 0 ? `docs/doc-${index}.md` : `src/file-${index}.ts`
    const content = `# Doc ${index}\n\n${'line of content '.repeat(60)}`
    list.push({
      descriptor: {
        sourceId: `src-${index}`,
        projectId: 'perf-project',
        kind: index % 2 === 0 ? 'document' : 'source_file',
        path,
        title: path,
        bytes: Buffer.byteLength(content, 'utf8'),
        mediaType: 'text',
        baseline: { contentDigest: sha256Text(content), digestScope: 'content', capturedAt: NOW },
        validity: 'current',
      },
      content,
    })
  }
  return list
}

function decisions() {
  return Array.from({ length: DECISIONS }, (_, index) => ({
    decisionId: `decision-${index}`,
    content: `Decision ${index}: keep the validation contract before acceptance`,
    scope,
    sourceMessageId: 'msg-1',
    recordedAt: NOW,
  }))
}

function messages() {
  return Array.from({ length: MESSAGES }, (_, index) => ({
    messageId: `message-${index}`,
    conversationId: 'conv-1',
    sequence: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
    provenance: index % 2 === 0 ? 'trusted_user' : 'reasoner_reply',
    text: `message ${index} with some discussion of the validation contract`,
    createdAt: NOW,
  }))
}

function artifacts() {
  return Array.from({ length: ARTIFACTS }, (_, index) => ({
    artifactId: `artifact-${index}`,
    digest: sha256Text(`artifact-${index}`),
    bytes: 1024 + index,
    createdAt: NOW,
  }))
}

function composer() {
  return new ContextComposer(
    {
      port: new StaticContextPort({
        projectId: 'perf-project',
        baseline: { commit: 'a'.repeat(40), capturedAt: NOW },
        sources: sources(),
      }),
      decisions: { listEffective: async () => ({ decisions: decisions(), truncatedByLimit: false }) },
      conversation: { recent: async ({ limit }) => messages().slice(0, limit) },
      artifacts: { recent: async ({ limit }) => artifacts().slice(0, limit) },
    },
    { now: () => new Date(NOW) },
  )
}

const request = {
  requestId: 'perf-request',
  projectId: 'perf-project',
  purpose: 'conversation_discussion',
  query: 'validation contract decision',
  grant: {
    grantId: 'perf-grant',
    projectId: 'perf-project',
    gateway: 'conversation',
    purpose: 'conversation_discussion',
    scope,
    sourceKinds: ['project_metadata', 'work', 'contract', 'decision', 'conversation_message', 'artifact', 'document', 'source_file'],
    maxFiles: 24,
    maxBytes: 512 * 1024,
    maxTokens: 32_000,
    maxDurationMs: 5000,
    confirmedAt: '2026-11-10T00:00:00.000Z',
    confirmedBy: 'perf-user',
  },
  budget: { maxBytes: 256 * 1024, maxTokens: 24_000, maxFiles: 20, maxSlices: 20, maxDurationMs: 5000 },
  conversationId: 'conv-1',
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

async function main() {
  const engine = composer()
  const RUNS = 25
  await engine.compose(request) // warm-up
  const durations = []
  let sample
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now()
    sample = await engine.compose(request)
    durations.push(Math.round((performance.now() - started) * 1000) / 1000)
  }
  const second = await engine.compose(request)
  const signature = (composition) =>
    composition.groups.map((group) => `${group.name}:${group.status}:${group.slices.map((slice) => slice.path).join(',')}`).join('|')

  const result = {
    status:
      sample.totals.bytes <= request.budget.maxBytes &&
      sample.totals.tokens <= request.budget.maxTokens &&
      sample.totals.files <= request.budget.maxSlices &&
      signature(sample) === signature(second) &&
      sample.groups.every((group) => group.status !== 'unavailable')
        ? 'PASS'
        : 'FAIL',
    modelCalls: 0,
    networkCalls: 0,
    dataset: { files: FILES, decisions: DECISIONS, messages: MESSAGES, artifacts: ARTIFACTS },
    runs: RUNS,
    durationMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Math.max(...durations) },
    bounded: {
      maxBytes: request.budget.maxBytes,
      maxTokens: request.budget.maxTokens,
      maxSlices: request.budget.maxSlices,
      outputBytes: sample.totals.bytes,
      outputTokens: sample.totals.tokens,
      outputSlices: sample.totals.files,
    },
    groups: sample.groups.map((group) => ({ name: group.name, status: group.status, slices: group.slices.length, omitted: group.omitted.length })),
    deterministicSignature: signature(sample),
    correctness: 'bytes/tokens are conservative estimates for bounded composition, not billing guarantees',
  }
  mkdirSync(join(packageRoot, 'reports'), { recursive: true })
  writeFileSync(join(packageRoot, 'reports/composition-performance.json'), `${JSON.stringify({ protocol: 'wave07-composition-performance/1', generatedAt: new Date().toISOString(), result }, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ status: result.status, p50: result.durationMs.p50, p95: result.durationMs.p95, bytes: result.bounded.outputBytes, slices: result.bounded.outputSlices })}\n`)
  if (result.status !== 'PASS') process.exitCode = 1
}

await main()
