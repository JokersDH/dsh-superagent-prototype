#!/usr/bin/env node
/**
 * Ordinary-install context/decision consumer. It talks only to the running product's public HTTP
 * surface (never SQL, never a private store): preview real project sources, prepare/confirm or
 * reject a proposal, record/supersede/revoke an explicit decision, and read the original frozen
 * sources after a restart. It prints exactly one JSON document and exits 0 ok / 2 usage /
 * 3 refused (4xx) / 4 failure. It never prints credentials or tokens.
 *
 * Auth: --api-token <bearer> for a local fixture, or --install <app> --state <state> to read the
 * installed instance's own api credential through its packaged local-state module.
 */
import { parseArgs } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const command = process.argv[2]
const { values } = parseArgs({ args: process.argv.slice(3), allowPositionals: false, options: {
  api: { type: 'string' }, 'api-token': { type: 'string' }, install: { type: 'string' }, state: { type: 'string' },
  project: { type: 'string' }, conversation: { type: 'string' }, message: { type: 'string' }, work: { type: 'string' },
  select: { type: 'string' }, index: { type: 'string' }, 'payload-digest': { type: 'string' },
  content: { type: 'string' }, supersedes: { type: 'string' }, revoke: { type: 'string' }, 'expected-version': { type: 'string' },
  days: { type: 'string' }, timezone: { type: 'string' }, 'command-id': { type: 'string' },
  limit: { type: 'string' }, cursor: { type: 'string' },
  'include-content': { type: 'boolean' }, reject: { type: 'boolean' }, 'prepare-only': { type: 'boolean' }, export: { type: 'boolean' },
  'timeout-ms': { type: 'string' },
} })
const protocol = 'assistant-context-cli/1'
const out = (value, exit = 0) => { process.stdout.write(JSON.stringify({ protocol, ...value }) + '\n'); process.exitCode = exit }
const usage = (message) => out({ status: 'usage', message }, 2)
const failure = (code, message, detail) => out({ status: 'failed', failure: { code, message, ...(detail === undefined ? {} : { detail }) } }, 4)
const refused = (status, body) => out({ status: 'refused', httpStatus: status,
  failure: { code: body?.error?.code ?? 'request_failed', message: body?.error?.message ?? 'Request was refused' } }, 3)
const timeoutMs = () => {
  const value = values['timeout-ms'] === undefined ? 20000 : Number(values['timeout-ms'])
  if (!Number.isInteger(value) || value <= 0) throw new Error('--timeout-ms must be a positive integer')
  return value
}

async function baseUrl() {
  if (values.api) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(values.api)) throw new Error('--api must be a loopback http://127.0.0.1:<port> endpoint')
    return values.api
  }
  if (values.install) throw new Error('--api is required (installed instances expose their loopback URL through pa status)')
  throw new Error('--api is required')
}
async function token() {
  if (values['api-token']) return values['api-token']
  if (!values.install || !values.state) throw new Error('--api-token or --install with --state is required')
  if (!isAbsolute(values.install) || !isAbsolute(values.state)) throw new Error('--install and --state must be absolute')
  const module = await import(pathToFileURL(join(values.install, 'apps/coordinator/http/local-state.ts')).href)
  return module.localCredentials(values.state)('api.key')
}
async function request(path, init = {}) {
  const url = await baseUrl()
  const headers = { authorization: `Bearer ${await token()}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) }
  let response
  try { response = await fetch(`${url}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs()) }) }
  catch (error) { failure('request_failed', String(error?.message ?? error)); return undefined }
  let body
  try { body = await response.json() } catch { body = undefined }
  if (!response.ok) { refused(response.status, body); return undefined }
  if (body === undefined) { failure('invalid_response', 'Response was not JSON'); return undefined }
  return body
}
const need = (...names) => { for (const name of names) if (!values[name]) { usage(`--${name} is required for ${command}`); return false } return true }
const sourcesOf = (value) => (value.sources ?? []).map((source) => ({
  sourceId: source.sourceId, kind: source.kind, path: source.path, bytes: source.bytes, tokens: source.estimatedTokens,
  truncated: source.truncated, sourceDigest: source.sourceDigest, ...(values['include-content'] ? { content: source.content } : {}),
}))
const newCommandId = (prefix) => values['command-id'] ?? `${prefix}-${randomBytes(8).toString('hex')}`
const messageIdOf = (commandId) => createHash('sha256').update(JSON.stringify(['message', commandId])).digest('hex').slice(0, 32)
const stop = () => process.exit(process.exitCode ?? 0)

try {
  if (command === 'preview') {
    if (!need('project', 'conversation')) stop()
    const selections = (values.select ?? 'conversation').split(',').map((value) => value.trim()).filter(Boolean)
    const body = await request('/v1/context/preview', { method: 'POST', body: JSON.stringify({
      projectId: values.project, conversationId: values.conversation, selections,
      ...(values.work ? { workId: values.work } : {}),
      budget: { maxFiles: 32, maxBytes: 65536, maxTokens: 16000 },
    }) })
    if (body) out({ status: 'ok', operation: 'preview', result: {
      requestId: body.requestId, status: body.status, trust: body.trust, observedAt: body.observedAt, expiresAt: body.expiresAt,
      groups: body.groups, sources: sourcesOf(body), omitted: body.omitted, issues: body.issues,
      budgetClamped: body.budgetClamped, authorization: 'none',
    } })
  } else if (command === 'candidates') {
    if (!need('message')) stop()
    const body = await request(`/v1/messages/${encodeURIComponent(values.message)}/candidates`)
    if (body) out({ status: 'ok', operation: 'candidates', result: { candidates: (body.candidates ?? []).map((candidate) => ({
      index: candidate.index, payloadDigest: candidate.payloadDigest, kind: candidate.payload?.kind })) } })
  } else if (command === 'propose') {
    if (!need('message', 'index')) stop()
    const index = Number(values.index)
    if (!Number.isInteger(index) || index < 0) { usage('--index must be a non-negative integer'); stop() }
    let digest = values['payload-digest']
    if (!digest) {
      const reviewed = await request(`/v1/messages/${encodeURIComponent(values.message)}/candidates`)
      if (!reviewed) stop()
      digest = (reviewed.candidates ?? [])[index]?.payloadDigest
      if (!digest) { failure('candidate_missing', `No candidate at index ${index}`); stop() }
    }
    const prepared = await request('/v1/assistant/candidates/prepare', { method: 'POST', body: JSON.stringify({
      messageId: values.message, index, payloadDigest: digest }) })
    if (!prepared) stop()
    if (values['prepare-only']) { out({ status: 'ok', operation: 'propose', phase: 'prepared', candidate: { index, payloadDigest: digest } }); stop() }
    const receipt = await request('/v1/proposals/commands', { method: 'POST', body: JSON.stringify({
      kind: values.reject ? 'reject_proposal' : 'confirm_proposal', commandId: newCommandId(values.reject ? 'cli-reject' : 'cli-confirm'),
      projectId: values.project ?? prepared.projectId, conversationId: values.conversation ?? prepared.conversationId, token: prepared.token }) })
    if (receipt) out({ status: 'ok', operation: values.reject ? 'reject-proposal' : 'confirm-proposal', phase: 'recorded',
      result: { commandId: receipt.commandId, receiptStatus: receipt.status, candidate: { index, payloadDigest: digest } } })
  } else if (command === 'decide') {
    if (values.revoke) {
      if (!need('project', 'conversation', 'expected-version')) stop()
      const version = Number(values['expected-version'])
      if (!Number.isInteger(version) || version < 1) { usage('--expected-version must be a positive integer'); stop() }
      const receipt = await request('/v1/decisions/commands', { method: 'POST', body: JSON.stringify({
        kind: 'revoke_decision', commandId: newCommandId('cli-revoke'), projectId: values.project,
        conversationId: values.conversation, decisionId: values.revoke, expectedVersion: version }) })
      if (receipt) out({ status: 'ok', operation: 'revoke-decision', result: { commandId: receipt.commandId, receiptStatus: receipt.status } })
    } else {
      if (!need('project', 'conversation', 'message', 'content')) stop()
      const prepared = await request('/v1/decisions/prepare', { method: 'POST', body: JSON.stringify({
        projectId: values.project, conversationId: values.conversation, sourceMessageId: values.message,
        content: values.content, scope: { projectId: values.project, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] },
        ...(values.supersedes ? { supersedes: values.supersedes } : {}) }) })
      if (!prepared) stop()
      const receipt = await request('/v1/decisions/commands', { method: 'POST', body: JSON.stringify({
        kind: 'record_decision', commandId: newCommandId('cli-decision'), projectId: values.project,
        conversationId: values.conversation, token: prepared.token }) })
      if (receipt) out({ status: 'ok', operation: 'record-decision', result: { decisionId: prepared.decision.id,
        version: prepared.decision.version, commandId: receipt.commandId, receiptStatus: receipt.status } })
    }
  } else if (command === 'send') {
    if (!need('project', 'conversation', 'content')) stop()
    const selections = (values.select ?? 'conversation').split(',').map((value) => value.trim()).filter(Boolean)
    const commandId = newCommandId('cli-context')
    const prepared = await request('/v1/assistant/context/prepare', { method: 'POST', body: JSON.stringify({
      commandId, text: values.content,
      context: { projectId: values.project, conversationId: values.conversation, selections,
        budget: { maxFiles: 32, maxBytes: 65536, maxTokens: 16000 } },
    }) })
    if (!prepared) stop()
    const receipt = await request('/v1/assistant/context/send', { method: 'POST', body: JSON.stringify({ commandId: prepared.commandId, token: prepared.token }) })
    if (receipt) out({ status: 'ok', operation: 'send-context', result: { commandId: prepared.commandId,
      messageId: messageIdOf(prepared.commandId), receiptStatus: receipt.status, selections } })
  } else if (command === 'sources') {
    if (!need('message')) stop()
    const context = await request(`/v1/messages/${encodeURIComponent(values.message)}/context`)
    if (!context) stop()
    const listed = await request(`/v1/messages/${encodeURIComponent(values.message)}/context/sources`)
    if (!listed) stop()
    out({ status: 'ok', operation: 'sources', result: {
      messageId: values.message, bundleDigest: context.bundleDigest, scope: context.scope, frozenAt: context.frozenAt ?? context.createdAt,
      sources: (listed.sources ?? []).map((source) => ({ sourceId: source.sourceId, kind: source.kind, path: source.path,
        sourceDigest: source.sourceDigest, bytes: source.bytes,
        ...(values['include-content'] ? { content: source.content } : {}) })),
    } })
  } else if (command === 'history') {
    if (!need('work')) stop()
    const query = new URLSearchParams()
    if (values.limit) query.set('limit', values.limit)
    if (values.cursor) query.set('cursor', values.cursor)
    const body = await request(`/v1/works/${encodeURIComponent(values.work)}/evidence/history${query.size ? `?${query}` : ''}`)
    if (body) out({ status: 'ok', operation: 'history', result: {
      workId: body.workId, window: body.window, hasMore: body.hasMore, nextCursor: body.nextCursor,
      sourcesCapped: body.sourcesCapped, entries: (body.entries ?? []).map((entry) => ({ at: entry.at, kind: entry.kind,
        sourceRef: entry.sourceRef })) } })
  } else if (command === 'observe') {
    if (!need('project')) stop()
    const days = values.days ?? '7'
    if (!['7', '30'].includes(days)) { usage('--days must be 7 or 30'); stop() }
    const query = new URLSearchParams({ days, projectId: values.project, timezone: values.timezone ?? 'UTC' })
    const body = await request(`/v1/insights${values.export ? '/export' : ''}?${query}`)
    if (body) out({ status: 'ok', operation: values.export ? 'observe-export' : 'observe', result: values.export
      ? { fileName: body.fileName, sha256: body.sha256, observation: { days: body.observation.days, coverageState: body.observation.coverageState,
        unknownCount: body.observation.unknownCount, authorization: body.observation.authorization } }
      : { days: body.days, windowLabel: body.windowLabel, coverageState: body.coverageState, unknownCount: body.unknownCount,
        authorization: body.authorization, metrics: body.metrics } })
  } else if (command === 'status') {
    const health = await request('/v1/health')
    if (!health) stop()
    const readiness = await request('/v1/readiness')
    if (readiness) out({ status: 'ok', operation: 'status', result: { mode: health.mode, startupMode: health.startupMode,
      authorization: readiness.authorization, discussion: readiness.discussion, startupAvailable: readiness.startupAvailable } })
  } else {
    usage('commands: preview | candidates | propose | send | decide | sources | history | observe | status')
  }
} catch (error) {
  failure('cli_error', String(error?.message ?? error))
}
