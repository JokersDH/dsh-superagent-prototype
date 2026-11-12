import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
if (process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave15-context.mjs <C-root>')
const candidate = resolve(process.argv[2])
const { reviewVerifiedReplyCandidates } = await import(pathToFileURL(join(candidate, 'packages/proposals/src/index.ts')).href)

const projectId = 'project-1', conversationId = 'conversation-1', sourceMessageId = 'message-1'
const principal = { userId: 'user-1', authorityRef: 'authority-1' }
const scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const bindings = { projectId, conversationId, sourceMessageId, grantId: 'grant-1', grantScope: scope, principal }
const body = { protocol: 'assistant-reply-body/1', projectId, conversationId, sourceMessageId,
  replyMessageId: 'reply-1', model: 'mock', text: 'Ordinary reply', suggestions: [] }
const identity = { requestId: 'request-1', replyMessageId: body.replyMessageId, sourceMessageId,
  projectId, conversationId, model: body.model, principal }
const cases = [
  ['NULL_BODY_RETURNS_INVALID_BODY', { verifiedBy: 'main-completed-reply', body: null, identity }, 'invalid_body'],
  ['NULL_IDENTITY_RETURNS_INVALID_BODY', { verifiedBy: 'main-completed-reply', body, identity: null }, 'invalid_body'],
  ['MISSING_PRINCIPAL_RETURNS_INVALID_BODY', { verifiedBy: 'main-completed-reply', body,
    identity: { requestId: identity.requestId, replyMessageId: identity.replyMessageId, sourceMessageId, projectId, conversationId, model: body.model } }, 'invalid_body'],
  ['VALID_PRIVATE_INPUT_REMAINS_NO_CANDIDATES', { verifiedBy: 'main-completed-reply', body, identity }, 'no_candidates'],
]
const observations = cases.map(([id, input, expected]) => {
  try {
    const result = reviewVerifiedReplyCandidates(input, bindings)
    return { id, status: result.status === expected ? 'PASS' : 'FAIL', observed: result.status, expected }
  } catch (error) {
    return { id, status: 'FAIL', exception: error.name, message: error.message, expected }
  }
})
const report = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim(), modelCalls: 0, nativeTurns: 0,
  scope: 'Unknown-input robustness only; malformed private wrapper input is not an execution grant or admitted main bypass', observations }

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave15-admission/context.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')

console.log(JSON.stringify(report, null, 2))
process.exitCode = observations.some(item => item.status === 'FAIL') ? 1 : 0
