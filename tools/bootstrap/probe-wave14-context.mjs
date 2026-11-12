import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
if (process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave14-context.mjs <C-root>')
const candidate = resolve(process.argv[2])
const { ContextComposer, createPublishedArtifactProvider, projectSourceReview } = await import(pathToFileURL(join(candidate, 'packages/context/src/index.ts')).href)

const at = '2026-11-12T00:00:00.000Z', projectId = 'project-1', conversationId = 'conversation-1', sourceMessageId = 'msg-1'
const hash = c => c.repeat(64)
const scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const observations = []
const check = (id, observed, valid) => observations.push({ id, status: valid ? 'PASS' : 'FAIL', observed })
const composition = await new ContextComposer({
  port: { projectBaseline: async () => ({ capturedAt: at }) },
  decisions: { listEffective: async () => ({ decisions: [{ decisionId: 'one', content: 'Valid decision', scope, sourceMessageId, recordedAt: at }] }) },
}, { now: () => new Date(at) }).compose({ requestId: 'probe', projectId, conversationId, query: '', purpose: 'conversation_discussion',
  grant: { grantId: 'grant-1', projectId, gateway: 'conversation', purpose: 'conversation_discussion', scope,
    sourceKinds: ['decision'], maxFiles: 8, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000,
    confirmedAt: at, confirmedBy: 'user-1' }, budget: { maxFiles: 8, maxSlices: 8, maxBytes: 8192, maxTokens: 4000 },
  groups: [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }] })

const bounded = projectSourceReview({ ...composition, omitted: Array.from({ length: 5000 }, () => ({ reason: 'missing' })) },
  { maxItems: 1, maxOmissions: 1 })
check('OMISSION_SUPPRESSION_SETS_TRUNCATED_AND_TOTAL', { omitted: bounded.omitted.length, suppressed: bounded.suppressed,
  totalsSuppressed: bounded.totals.suppressed, truncated: bounded.truncated },
  bounded.truncated && bounded.totals.suppressed >= bounded.suppressed.omissions)

const paths = ['/Library/Keychains/private.key', '/custom/team/private.env', 'Z:/Research/Secret/private.key', '\\\\server\\private\\secret.key']
for (const path of paths) {
  const output = projectSourceReview({ ...composition, omitted: [{ reason: 'missing', detail: `Cannot read ${path}` }] })
  check('REVIEW_REDACTS_DETAIL_' + path.split(/[\\/]/).filter(Boolean)[0], { detail: output.omitted[0].detail },
    !output.omitted[0].detail.includes(path))
}

const artifacts = createPublishedArtifactProvider({ get: id => ({ id, digest: hash('a'), bytes: 1,
  createdAt: id === 'old' ? '2026-01-01T00:00:00.000Z' : at }) }, { publishedArtifactIds: ['old', 'new'] })
const recent = await artifacts.recent({ projectId, limit: 1 })
check('PUBLISHED_ARTIFACT_PROVIDER_NEWEST_FIRST_CONTRACT', { returned: recent.map(item => item.artifactId), coverage: artifacts.coverage() }, recent[0]?.artifactId === 'new')

const report = { protocol: 'wave14-c-admission/1', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim(),
  modelCalls: 0, nativeTurns: 0, observations, passed: observations.filter(item => item.status === 'PASS').length, failed: observations.filter(item => item.status === 'FAIL').length,
  scope: 'Public review bounded output and published-artifact provider order; no execution or history-reader authority claim' }

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave14-admission/context.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
