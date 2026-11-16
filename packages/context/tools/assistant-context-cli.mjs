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
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join as joinPath } from 'node:path'

const command = process.argv[2]
const { values, positionals } = parseArgs({ args: process.argv.slice(3), allowPositionals: true, options: {
  api: { type: 'string' }, 'api-token': { type: 'string' }, install: { type: 'string' }, state: { type: 'string' },
  project: { type: 'string' }, conversation: { type: 'string' }, message: { type: 'string' }, work: { type: 'string' },
  select: { type: 'string' }, index: { type: 'string' }, 'payload-digest': { type: 'string' },
  content: { type: 'string' }, supersedes: { type: 'string' }, revoke: { type: 'string' }, 'expected-version': { type: 'string' },
  days: { type: 'string' }, timezone: { type: 'string' }, 'command-id': { type: 'string' },
  limit: { type: 'string' }, cursor: { type: 'string' }, file: { type: 'string' },
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
const MAX_DRAFT_BYTES = 64 * 1024
const DRAFT_PROTOCOL = 'assistant-context-draft/1'
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const digestPattern = /^[a-f0-9]{64}$/
const draftFailure = (code, message) => Object.assign(new Error(message), { code })
function privateOwner(info) { return typeof process.getuid !== 'function' || info.uid === process.getuid() }
function inspectDraftPath(file) {
  let info
  try { info = lstatSync(file) } catch (error) { if (error?.code === 'ENOENT') return undefined; throw draftFailure('draft_unreadable', `Draft cannot be inspected: ${String(error?.message ?? error)}`) }
  if (info.isSymbolicLink()) throw draftFailure('draft_symlink', 'A draft file must not be a symbolic link')
  if (!info.isFile()) throw draftFailure('draft_not_regular', 'A draft path must be an ordinary file')
  if (!privateOwner(info)) throw draftFailure('draft_owner', 'A draft file must belong to the current user')
  if ((info.mode & 0o777) !== 0o600) throw draftFailure('draft_permissions', 'A draft file must be owner-private (0600)')
  if (info.size <= 0 || info.size > MAX_DRAFT_BYTES) throw draftFailure('draft_size', `A draft file must be 1..${MAX_DRAFT_BYTES} bytes`)
  return info
}
function readPrivateDraft(file) {
  inspectDraftPath(file)
  let raw
  try { raw = readFileSync(file, 'utf8') } catch (error) { throw draftFailure('draft_unreadable', `Draft cannot be read: ${String(error?.message ?? error)}`) }
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw draftFailure('draft_invalid', 'Draft is not valid JSON') }
  if (parsed?.protocol !== DRAFT_PROTOCOL) throw draftFailure('draft_invalid', `Draft protocol must be ${DRAFT_PROTOCOL}`)
  if (typeof parsed.projectId !== 'string' || !ID_PATTERN.test(parsed.projectId)) throw draftFailure('draft_invalid', 'Draft projectId is invalid')
  if (typeof parsed.conversationId !== 'string' || !ID_PATTERN.test(parsed.conversationId)) throw draftFailure('draft_invalid', 'Draft conversationId is invalid')
  if (!Array.isArray(parsed.selections) || parsed.selections.length < 1 || parsed.selections.length > 5 ||
    new Set(parsed.selections).size !== parsed.selections.length ||
    !parsed.selections.every((value) => ['work', 'decisions', 'project', 'conversation', 'artifacts'].includes(value)))
    throw draftFailure('draft_invalid', 'Draft selections are invalid')
  if (typeof parsed.requestId !== 'string' || parsed.requestId.length < 1 || parsed.requestId.length > 256)
    throw draftFailure('draft_invalid', 'Draft requestId is invalid')
  if (typeof parsed.observedAt !== 'string' || !Number.isFinite(Date.parse(parsed.observedAt)))
    throw draftFailure('draft_invalid_time', 'Draft observedAt is not a valid timestamp')
  if (typeof parsed.expiresAt !== 'string' || !Number.isFinite(Date.parse(parsed.expiresAt)))
    throw draftFailure('draft_invalid_expiry', 'Draft expiresAt is not a valid timestamp')
  if (parsed.sources !== undefined) {
    if (!Array.isArray(parsed.sources) || parsed.sources.length > 64 ||
      !parsed.sources.every((source) => source && typeof source.sourceId === 'string' &&
        typeof source.path === 'string' && typeof source.sourceDigest === 'string' && digestPattern.test(source.sourceDigest)))
      throw draftFailure('draft_invalid', 'Draft sources are invalid')
  }
  return parsed
}
function writePrivateDraft(file, draft) {
  const existed = inspectDraftPath(file) !== undefined
  const directory = dirname(file)
  const temp = joinPath(directory, `.${basename(file)}.${randomBytes(6).toString('hex')}.tmp`)
  const fd = openSync(temp, 'wx', 0o600)
  try {
    writeSync(fd, JSON.stringify(draft, null, 2) + String.fromCharCode(10))
    fsyncSync(fd)
  } finally { closeSync(fd) }
  try {
    // A final pre-rename snapshot keeps the policy explicit; the rename itself replaces the path
    // atomically and can never follow a symlink target.
    inspectDraftPath(file)
    renameSync(temp, file)
  } catch (error) {
    try { unlinkSync(temp) } catch { /* private temporary file already gone */ }
    throw error
  }
  const after = lstatSync(file)
  if (!after.isFile() || after.isSymbolicLink() || (after.mode & 0o777) !== 0o600)
    throw draftFailure('draft_write_policy', 'Draft write left an unexpected file type or mode')
}

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
  } else if (command === 'draft') {
    if (!values.file) { usage('--file is required for draft'); stop() }
    if (!isAbsolute(values.file)) { usage('--file must be absolute'); stop() }
    try {
      if (positionals[0] === 'load') {
        const parsed = readPrivateDraft(values.file)
        const stale = Date.parse(parsed.expiresAt) <= Date.now()
        out({ status: 'ok', operation: 'draft-load', result: { ...parsed, usable: !stale, stale, authorization: 'none' } })
      } else if (positionals[0] === undefined || positionals[0] === 'save') {
        if (!need('project', 'conversation')) stop()
        const selections = (values.select ?? 'conversation').split(',').map((value) => value.trim()).filter(Boolean)
        const body = await request('/v1/context/preview', { method: 'POST', body: JSON.stringify({
          projectId: values.project, conversationId: values.conversation, selections,
          ...(values.work ? { workId: values.work } : {}), budget: { maxFiles: 32, maxBytes: 65536, maxTokens: 16000 } }) })
        if (!body) stop()
        const draft = { protocol: DRAFT_PROTOCOL, authorization: 'none', projectId: values.project,
          conversationId: values.conversation, selections, requestId: body.requestId, observedAt: body.observedAt,
          expiresAt: body.expiresAt, status: body.status, sources: sourcesOf(body).map((source) => ({
            sourceId: source.sourceId, path: source.path, sourceDigest: source.sourceDigest })) }
        writePrivateDraft(values.file, draft)
        out({ status: 'ok', operation: 'draft-save', result: { file: values.file, expiresAt: draft.expiresAt,
          status: draft.status, sources: draft.sources.length, authorization: 'none' } })
      } else {
        usage('draft subcommands: save | load')
      }
    } catch (error) {
      if (String(error?.code ?? '').startsWith('draft_')) { refused(0, { error: { code: error.code, message: String(error.message) } }); stop() }
      throw error
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
    usage('commands: preview | candidates | propose | send | draft save|load | decide | sources | history | observe | status')
  }
} catch (error) {
  failure('cli_error', String(error?.message ?? error))
}
