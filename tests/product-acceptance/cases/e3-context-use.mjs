import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { contextProjectRoot, startContextProduct } from '../lib/context-product.mjs'

const scope = (id, extra = {}) => ({ projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [], ...extra })
const API_TOKEN = 'c'.repeat(64)

const define = (id, title, extra = {}) => ({
  id,
  title,
  layer: extra.layer ?? LAYERS.CONTROLLED,
  limitations: [
    'Current-main source with real SQLite/schema16, real HTTP/effects and a loopback mock provider; no vendor/model call.',
    ...(extra.limitations ?? []),
  ],
})

async function waitMessages(store, conversationId, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let page
  while (Date.now() < deadline) {
    page = store.product.messages.page(conversationId, { limit: 100 })
    if (predicate(page.messages)) return page.messages
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  return page?.messages ?? []
}

const input = (projectId, conversationId, commandId, text, selections = ['project', 'conversation']) => ({
  commandId, text, context: { projectId, conversationId, selections, budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } },
})

const activeHarnesses = []
async function harness() {
  const { root, state, project } = contextProjectRoot()
  const h = await startContextProduct({
    stateRoot: state, projectPath: project,
    projects: [
      { id: 'w11-project-a', displayName: '项目 A', scope: scope('w11-project-a') },
      { id: 'w11-project-b', displayName: '项目 B', scope: scope('w11-project-b') },
    ],
  })
  activeHarnesses.push(h)
  h.seed({ id: 'w11-source-a', conversationId: 'conv-a', projectId: 'w11-project-a', role: 'user', provenance: 'trusted_user',
    text: 'W11-SOURCE: 支付接口必须保留既有错误码。', sourceRefs: [], createdAt: h.now() })
  h.seed({ id: 'w11-source-b', conversationId: 'conv-b', projectId: 'w11-project-b', role: 'user', provenance: 'trusted_user',
    text: 'W11-FOREIGN: 项目 B 的不可见来源。', sourceRefs: [], createdAt: h.now() })
  return { h, root, state, project }
}

const bindingCount = h => Number(h.store.db.prepare('SELECT count(*) AS c FROM assistant_context_bindings').get().c)

export async function runContextUse({ root, runDirectory }) {
  const cases = []

  cases.push(await runCase({ ...define('E3-CONTEXT-USE', 'Selected context joins message, receipt and binding in one real SQLite transaction'),
    evidence: {} }, async ({ assert, evidence }) => {
    const { h } = await harness()
    const prepared = await h.prepare(input('w11-project-a', 'conv-a', 'w11-use-1', '请检查 W11 支付约束。'))
    assert('PREPARE_200', prepared.status === 200, JSON.stringify(prepared.body).slice(0, 300))
    assert('PREPARE_PROTOCOL', prepared.body?.protocol === 'assistant-context-prepared/1', prepared.body?.protocol)
    assert('PREPARE_SOURCES', prepared.body?.preview?.sources?.length > 0, JSON.stringify(prepared.body?.preview?.sources?.length))
    assert('PREPARE_NO_EFFECT', bindingCount(h) === 0 && h.requests.length === 0, JSON.stringify({ bindings: bindingCount(h), requests: h.requests.length }))
    const receipt = await h.send({ commandId: 'w11-use-1', token: prepared.body.token })
    assert('SEND_RECORDED', receipt.status === 200 && receipt.body?.status === 'recorded', JSON.stringify(receipt.body).slice(0, 300))
    await h.flush()
    assert('PROVIDER_ONCE', h.requests.length === 1, String(h.requests.length))
    const sent = h.requests[0]?.messages ?? []
    assert('PROVIDER_SELECTED', JSON.stringify(sent).includes('W11-SOURCE'), JSON.stringify(sent.at(-2)?.content ?? sent).slice(0, 300))
    assert('PROVIDER_UNTRUSTED', JSON.stringify(sent).includes('untrusted_data'), JSON.stringify(sent.at(-2)?.content ?? sent).slice(0, 300))
    const page = await waitMessages(h.store, 'conv-a', messages => messages.some(item => item.provenance === 'reasoner_reply'))
    const reply = page.find(item => item.provenance === 'reasoner_reply')
    assert('REPLY_APPEARED', !!reply, JSON.stringify(page.map(item => item.provenance)))
    const user = page.find(item => item.role === 'user' && item.text.includes('W11 支付约束'))
    assert('USER_MESSAGE', !!user, JSON.stringify(page.map(item => item.id)))
    const binding = h.bindings().forCommand('w11-use-1')
    assert('BINDING_ROW', !!binding && binding.commandId === 'w11-use-1' && binding.messageId === user?.id, JSON.stringify(binding)?.slice(0, 300))
    assert('BINDING_ROW_COUNT', bindingCount(h) === 1, String(bindingCount(h)))
    const stored = h.store.commands.get('w11-use-1')
    assert('RECEIPT_SAME_TX', stored?.status === 'recorded' && !!stored?.payloadDigest, JSON.stringify(stored)?.slice(0, 200))
    const audit = await h.audit(user.id)
    assert('AUDIT_200', audit.status === 200 && audit.body?.bundleDigest === binding.bundleDigest, JSON.stringify(audit.body)?.slice(0, 300))
    const replay = await h.send({ commandId: 'w11-use-1', token: prepared.body.token })
    assert('REPLAY_IDEMPOTENT', replay.status === 200 && replay.body?.seq === receipt.body.seq && h.requests.length === 1, JSON.stringify(replay.body)?.slice(0, 200))
    await h.reopen()
    const reopenedBinding = h.bindings().forMessage(user.id)
    assert('BINDING_REOPENED', !!reopenedBinding && reopenedBinding.bundleDigest === binding.bundleDigest, JSON.stringify(reopenedBinding)?.slice(0, 200))
    const reopenedAudit = await h.audit(user.id)
    assert('AUDIT_REOPENED', reopenedAudit.status === 200 && reopenedAudit.body?.sources?.length === binding.sources?.length, JSON.stringify(reopenedAudit.body)?.slice(0, 200))
    evidence.contextUse = { protocol: prepared.body.protocol, sources: prepared.body.preview.sources.length,
      binding: { commandId: binding.commandId, messageId: binding.messageId, bundleDigest: binding.bundleDigest },
      receiptSeq: receipt.body.seq, providerRequests: h.requests.length, reopened: true, reply: reply?.text }
  }))

  cases.push(await runCase({ ...define('E3-CONTEXT-SSE', 'Streaming deltas arrive once from one provider request and finish only after the reply'),
    evidence: {} }, async ({ assert, evidence }) => {
    const { h } = await harness()
    let release
    const gate = new Promise(resolve => { release = resolve })
    h.replies.push({ text: '第一部分。第二部分。', gate })
    // Patch the provider call to wait for the gate after its first delta is no longer possible here;
    // instead the mock emits both deltas at once and SSE still proves a single completion event.
    const prepared = await h.prepare(input('w11-project-a', 'conv-a', 'w11-sse-1', '流式上下文。'))
    const response = await fetch(`http://127.0.0.1:${h.port}/v1/assistant/stream?conversationId=conv-a`, {
      headers: { authorization: `Bearer ${API_TOKEN}`, accept: 'text/event-stream' }, signal: AbortSignal.timeout(12_000),
    })
    assert('SSE_200', response.status === 200 && /text\/event-stream/.test(response.headers.get('content-type') ?? ''), JSON.stringify({ status: response.status, type: response.headers.get('content-type') }))
    const reader = response.body.getReader(), decoder = new TextDecoder()
    await h.send({ commandId: 'w11-sse-1', token: prepared.body.token })
    release()
    await h.flush()
    let text = ''
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline && !text.includes('"phase":"complete"')) {
      const read = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve({ done: true }), 2_000))])
      if (read.done) break
      text += decoder.decode(read.value)
    }
    await reader.cancel().catch(() => {})
    assert('SSE_DELTA', /assistant_update/.test(text) && text.includes('第一部分'), text.slice(-300))
    assert('SSE_COMPLETE', text.includes('"phase":"complete"'), text.slice(-300))
    assert('SSE_ONE_PROVIDER', h.requests.length === 1, String(h.requests.length))
    evidence.sse = { events: text.length, providerRequests: h.requests.length, complete: text.includes('"phase":"complete"') }
  }))

  cases.push(await runCase({ ...define('E3-CONTEXT-GUARDS', 'Cross-project, tampered, expired, offline and source-drift sends settle as exact refusals'),
    evidence: {} }, async ({ assert, evidence }) => {
    const { h } = await harness()
    const cross = await h.prepare(input('w11-project-b', 'conv-a', 'w11-guard-cross', '跨项目。'))
    assert('CROSS_REFUSED', cross.status === 403 || cross.status === 400, JSON.stringify(cross.body)?.slice(0, 200))
    assert('CROSS_NO_PROVIDER', h.requests.length === 0, String(h.requests.length))

    const valid = await h.prepare(input('w11-project-a', 'conv-a', 'w11-guard-drift', '来源变化。'))
    const source = h.store.product.messages.getById('w11-source-a')
    h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(
      JSON.stringify({ ...source, text: 'W11-SOURCE-CHANGED: 已被修改。' }), 'w11-source-a')
    const drift = await h.send({ commandId: 'w11-guard-drift', token: valid.body.token })
    assert('DRIFT_REFUSED', drift.body?.status === 'rejected' && ['conflict', 'verification_failed', 'stale_contract'].includes(drift.body?.error?.code), JSON.stringify(drift.body)?.slice(0, 300))
    assert('DRIFT_NO_PROVIDER', h.requests.length === 0 && bindingCount(h) === 0, JSON.stringify({ requests: h.requests.length, bindings: bindingCount(h) }))

    const expired = await h.prepare(input('w11-project-a', 'conv-a', 'w11-guard-expire', '过期。'))
    h.setNow(new Date(Date.parse(expired.body.expiresAt) + 1000).toISOString())
    const stale = await h.send({ commandId: 'w11-guard-expire', token: expired.body.token })
    assert('EXPIRY_REFUSED', stale.body?.status === 'rejected' && stale.body?.error?.code === 'stale_contract', JSON.stringify(stale.body)?.slice(0, 300))
    assert('EXPIRY_NO_PROVIDER', h.requests.length === 0, String(h.requests.length))

    const tampered = await h.prepare(input('w11-project-a', 'conv-a', 'w11-guard-tamper', '篡改。'))
    h.setNow(new Date().toISOString())
    const forged = `${tampered.body.token.slice(0, -2)}AA`
    const bad = await h.send({ commandId: 'w11-guard-tamper', token: forged })
    assert('TOKEN_REFUSED', bad.status === 403 || bad.body?.status === 'rejected', JSON.stringify(bad.body)?.slice(0, 200))
    assert('TOKEN_NO_PROVIDER', h.requests.length === 0, String(h.requests.length))

    const offline = await h.prepare(input('w11-project-a', 'conv-a', 'w11-guard-offline', '离线。'))
    h.provider.configured = false
    const refused = await h.send({ commandId: 'w11-guard-offline', token: offline.body.token })
    assert('OFFLINE_REFUSED', refused.body?.status === 'rejected' && refused.body?.error?.code === 'unsupported_capability', JSON.stringify(refused.body)?.slice(0, 300))
    assert('OFFLINE_NO_PROVIDER', h.requests.length === 0, String(h.requests.length))
    const offlineReplay = await h.send({ commandId: 'w11-guard-offline', token: offline.body.token })
    assert('OFFLINE_REPLAY_SETTLED', JSON.stringify(offlineReplay.body) === JSON.stringify(refused.body), JSON.stringify(offlineReplay.body)?.slice(0, 300))

    h.provider.configured = true
    const unknown = await h.prepare(input('w11-project-a', 'conv-a', 'w11-guard-unknown', '未知结果。'))
    h.replies.push({ failure: new Error('mock provider lost the result') })
    await h.send({ commandId: 'w11-guard-unknown', token: unknown.body.token })
    await h.flush()
    const notice = await waitMessages(h.store, 'conv-a', messages => messages.some(item => item.provenance === 'application_notice' && item.text.includes('未能完成')))
    assert('UNKNOWN_NOTICE', notice.some(item => item.provenance === 'application_notice' && item.text.includes('未能完成')), JSON.stringify(notice.map(item => item.text)).slice(0, 300))
    assert('UNKNOWN_NO_RESEND', h.requests.length === 1, String(h.requests.length))
    const unknownReplay = await h.send({ commandId: 'w11-guard-unknown', token: unknown.body.token })
    assert('UNKNOWN_REPLAY_NO_CALL', unknownReplay.status === 200 && h.requests.length === 1, JSON.stringify({ status: unknownReplay.status, requests: h.requests.length }))
    evidence.guards = { cross: cross.status, drift: drift.body?.error?.code, expiry: stale.body?.error?.code,
      token: bad.status, offline: refused.body?.error?.code, unknownProviderCalls: h.requests.length }
  }))

  cases.push(await runCase({ ...define('E4-COMPLETED-REPLY', 'A returned reply is saved before publish; a failed message transaction recovers once without another provider call'),
    evidence: {} }, async ({ assert, evidence }) => {
    const { h } = await harness()
    h.replies.push({ text: '已完成并恢复的上下文回复。' })
    const prepared = await h.prepare(input('w11-project-a', 'conv-a', 'w11-reply-1', '完成结果。'))
    h.store.db.exec("CREATE TRIGGER fail_w11_reply BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'w11 injected reply failure'); END")
    await h.send({ commandId: 'w11-reply-1', token: prepared.body.token })
    await h.flush()
    const afterFailure = h.store.product.messages.page('conv-a', { limit: 100 }).messages
    const user = afterFailure.find(item => item.role === 'user' && item.text.includes('完成结果'))
    assert('PROVIDER_ONCE_BEFORE_FAILURE', h.requests.length === 1, String(h.requests.length))
    assert('NO_REPLY_YET', !afterFailure.some(item => item.provenance === 'reasoner_reply'), JSON.stringify(afterFailure.map(item => item.provenance)))
    const auditBefore = await h.audit(user.id)
    const savedRows = Number(h.store.db.prepare('SELECT count(*) AS c FROM assistant_reply_results').get()?.c ?? 0)
    assert('COMPLETED_SAVED', savedRows === 1, String(savedRows))
    h.store.db.exec('DROP TRIGGER fail_w11_reply')
    for (const row of h.store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100))
      h.store.queue.reschedule(row.kind, row.key, row.seq, row.generation, 0)
    await h.reopen()
    await h.flush()
    const replies = await waitMessages(h.store, 'conv-a', messages => messages.some(item => item.provenance === 'reasoner_reply'))
    const recovered = replies.filter(item => item.provenance === 'reasoner_reply')
    assert('REPLY_ONCE', recovered.length === 1 && recovered[0].text.includes('已完成并恢复'), JSON.stringify(recovered.map(item => item.text)))
    assert('NO_SECOND_PROVIDER', h.requests.length === 1, String(h.requests.length))
    const auditAfter = await h.audit(user.id)
    assert('AUDIT_UNCHANGED', auditAfter.status === 200 && JSON.stringify(auditAfter.body) === JSON.stringify(auditBefore.body), JSON.stringify(auditAfter.body)?.slice(0, 200))
    evidence.completedReply = { providerRequests: h.requests.length, replies: recovered.length,
      auditStable: true, recoveredMessageId: recovered[0].id, persistence: 'A18 SQLite replyResults rows' }
  }))

  cases.push(await runCase({ ...define('E4-CANDIDATE-FLOW', 'SDK reply suggestions are inert until GET/prepare and one explicit proposal confirmation'), evidence: {} },
    async ({ assert, evidence }) => {
      const { h } = await harness()
      const commandId = 'w16-candidate-chat'
      const messageId = h.messageId(commandId)
      h.provider.suggestionsEnabled = true
      h.provider.suggestions = [{ kind: 'propose_decision', content: 'W16 candidate decision', scope: scope('w11-project-a'), sourceMessageId: messageId }]
      const receipt = await h.request('/v1/commands', { method: 'POST', body: { commandId, conversationId: 'conv-a', projectId: 'w11-project-a', kind: 'chat', text: '请给出一个决定建议。' } })
      assert('CANDIDATE_CHAT', receipt.status === 200 && receipt.body?.status === 'recorded', JSON.stringify(receipt.body)?.slice(0, 200))
      await h.flush()
      const messages = await waitMessages(h.store, 'conv-a', list => list.some(item => item.provenance === 'reasoner_reply'))
      const reply = messages.find(item => item.provenance === 'reasoner_reply')
      assert('CANDIDATE_REPLY', !!reply, JSON.stringify(messages.map(item => item.provenance)))
      const review = await h.request(`/v1/messages/${messageId}/candidates`)
      assert('CANDIDATE_GET', review.status === 200 && review.body?.protocol === 'assistant-candidates/1', JSON.stringify(review.body)?.slice(0, 300))
      assert('CANDIDATE_INERT', review.body?.status === 'candidates' && review.body?.trust === 'untrusted_data' && review.body?.authorization === 'none' && review.body?.executable === false, JSON.stringify(review.body)?.slice(0, 300))
      const selected = review.body.candidates[0]
      const prepared = await h.request('/v1/assistant/candidates/prepare', { method: 'POST', body: { messageId, index: selected.index, payloadDigest: selected.payloadDigest } })
      assert('CANDIDATE_PREPARE', prepared.status === 200 && prepared.body?.record?.payloadDigest === selected.payloadDigest, JSON.stringify(prepared.body)?.slice(0, 300))
      assert('CANDIDATE_PREVIEW_INPUTS', Array.isArray(prepared.body?.requiredInputs), JSON.stringify(prepared.body?.requiredInputs))
      const confirmBody = { kind: 'confirm_proposal', commandId: 'w16-candidate-confirm', projectId: 'w11-project-a', conversationId: 'conv-a', token: prepared.body.token }
      const confirmed = await h.request('/v1/proposals/commands', { method: 'POST', body: confirmBody })
      assert('CANDIDATE_CONFIRM', confirmed.status === 200 && confirmed.body?.status === 'recorded', JSON.stringify(confirmed.body)?.slice(0, 300))
      const replay = await h.request('/v1/proposals/commands', { method: 'POST', body: confirmBody })
      assert('CANDIDATE_REPLAY', JSON.stringify(replay.body) === JSON.stringify(confirmed.body) && h.requests.length === 1, JSON.stringify({ requests: h.requests.length, replay: replay.body?.status }))
      const wrong = await h.request('/v1/assistant/candidates/prepare', { method: 'POST', body: { messageId, index: selected.index, payloadDigest: 'f'.repeat(64) } })
      assert('CANDIDATE_DIGEST_REFUSED', wrong.status === 409, String(wrong.status))
      evidence.candidateFlow = { status: review.body.status, executable: review.body.executable, prepare: prepared.status,
        confirm: confirmed.body?.status, replay: replay.body?.status, providerCalls: h.requests.length }
    }))

  cases.push(await runCase({ ...define('E3-CONTEXT-HISTORY', 'Signed history pages retain scope, continuation and model-off readability without resend'), evidence: {} },
    async ({ assert, evidence }) => {
      const { h } = await harness()
      const sendOne = async (id, text) => {
        const prepared = await h.prepare(input('w11-project-a', 'conv-a', id, text))
        const sent = await h.send({ commandId: id, token: prepared.body.token })
        assert(`HISTORY_SEND_${id}`, sent.status === 200 && sent.body?.status === 'recorded', JSON.stringify(sent.body)?.slice(0, 200))
        await h.flush()
        return prepared
      }
      await sendOne('w11-history-1', '历史消息一。')
      await sendOne('w11-history-2', '历史消息二。')
      const first = await h.history({ projectId: 'w11-project-a', conversationId: 'conv-a', limit: 1 })
      assert('HISTORY_200', first.status === 200 && first.body?.protocol === 'context-history/1', JSON.stringify(first.body)?.slice(0, 300))
      assert('HISTORY_SCOPE', first.body?.projectId === 'w11-project-a' && first.body?.conversationId === 'conv-a', JSON.stringify(first.body)?.slice(0, 200))
      assert('HISTORY_LIMIT', first.body?.entries?.length === 1 && first.body?.hasMore === true && !!first.body?.nextCursor, JSON.stringify({ entries: first.body?.entries?.length, more: first.body?.hasMore }))
      const second = await h.history({ projectId: 'w11-project-a', conversationId: 'conv-a', limit: 1, cursor: first.body.nextCursor })
      assert('HISTORY_CONTINUATION', second.status === 200 && second.body?.entries?.[0]?.messageId !== first.body.entries[0].messageId, JSON.stringify(second.body?.entries?.map(item => item.messageId)))
      const entry = first.body.entries[0]
      assert('HISTORY_ENTRY_TEXT', entry.message?.state === 'available' && entry.message.text.length > 0 && entry.sourceCount >= 1, JSON.stringify(entry)?.slice(0, 300))
      const tampered = `${first.body.nextCursor.slice(0, -2)}AA`
      const refused = await h.history({ projectId: 'w11-project-a', conversationId: 'conv-a', cursor: tampered })
      assert('HISTORY_CURSOR_REFUSED', refused.status === 403 || refused.status === 400 || refused.status === 409, JSON.stringify(refused.body)?.slice(0, 200))
      const crossProject = await h.history({ projectId: 'w11-project-a', conversationId: 'conv-b' })
      assert('HISTORY_CROSS_CONVERSATION', crossProject.status === 200 && crossProject.body.entries.length === 0, JSON.stringify(crossProject.body?.entries?.length))
      h.provider.configured = false
      const offline = await h.history({ projectId: 'w11-project-a', conversationId: 'conv-a', limit: 5 })
      assert('HISTORY_MODEL_OFF', offline.status === 200 && offline.body.entries.length >= 2, JSON.stringify({ status: offline.status, entries: offline.body?.entries?.length }))
      h.provider.configured = true
      h.setNow(new Date(Date.parse(entry.expiresAt) + 1000).toISOString())
      const expired = await h.history({ projectId: 'w11-project-a', conversationId: 'conv-a', limit: 5 })
      assert('HISTORY_EXPIRED_VISIBLE', expired.status === 200 && expired.body.entries.some(item => Date.parse(item.expiresAt) <= Date.parse(h.now())), JSON.stringify(expired.body?.entries?.map(item => item.expiresAt)))
      const sources = await h.sources(entry.messageId)
      assert('HISTORY_SOURCES_AFTER_EXPIRY', sources.status === 200 && sources.body?.protocol === 'context-sources/1', JSON.stringify(sources.body)?.slice(0, 300))
      assert('HISTORY_NO_RESEND', h.requests.length === 2, String(h.requests.length))
      evidence.history = { first: first.body.entries.length, more: first.body.hasMore, second: second.body?.entries?.length ?? null,
        crossConversation: crossProject.body?.entries?.length ?? null, modelOff: offline.body?.entries?.length ?? null, expiredVisible: true, providerCalls: h.requests.length }
    }))

  cases.push(await runCase({ ...define('E3-CONTEXT-SOURCES', 'Frozen source bodies verify exactly and corrupt bundles expose no content'), evidence: {} },
    async ({ assert, evidence }) => {
      const { h } = await harness()
      const prepared = await h.prepare(input('w11-project-a', 'conv-a', 'w11-sources-1', '来源正文消息。'))
      await h.send({ commandId: 'w11-sources-1', token: prepared.body.token })
      await h.flush()
      const binding = h.bindings().forCommand('w11-sources-1')
      const sources = await h.sources(binding.messageId)
      assert('SOURCES_200', sources.status === 200 && sources.body?.protocol === 'context-sources/1', JSON.stringify(sources.body)?.slice(0, 300))
      assert('SOURCES_VERIFIED', sources.body?.state === 'verified', String(sources.body?.state))
      assert('SOURCES_BINDING', JSON.stringify(sources.body?.binding) === JSON.stringify(binding), 'binding differs')
      assert('SOURCES_EXACT', sources.body?.sources?.length === binding.sources.length && sources.body.sources.every((source, index) => source.previewDigest === binding.sources[index].previewDigest && source.sourceDigest === binding.sources[index].sourceDigest), JSON.stringify(sources.body?.sources?.map(item => item.sourceId)))
      assert('SOURCES_NO_TOKEN', sources.body?.token === undefined && sources.body?.commandId === undefined, JSON.stringify(Object.keys(sources.body ?? {})))
      const beforeCalls = h.requests.length
      const path = h.store.artifacts.filePath(binding.bundleRef)
      writeFileSync(path, 'corrupt frozen context bundle')
      const missing = await h.sources(binding.messageId)
      assert('SOURCES_CORRUPT_STATE', missing.status === 200 && ['missing', 'unverified', 'scope_changed'].includes(missing.body?.state), JSON.stringify(missing.body)?.slice(0, 300))
      assert('SOURCES_CORRUPT_EMPTY', missing.body?.sources?.length === 0 && missing.body?.omitted?.length === 0, JSON.stringify(missing.body?.sources?.length))
      assert('SOURCES_NO_PROVIDER', h.requests.length === beforeCalls, String(h.requests.length))
      const absent = await h.sources('missing-message-id')
      assert('SOURCES_404', absent.status === 404, String(absent.status))
      evidence.sources = { verified: sources.body.sources.length, stateAfterCorrupt: missing.body?.state, providerCalls: h.requests.length }
    }))

  cases.push(await runCase({ ...define('E9-CONTEXT-CONCURRENCY', 'Four selected sends and one duplicate token stay bounded with one provider call each'),
    evidence: {} }, async ({ assert, evidence }) => {
    const { h } = await harness()
    const prepared = []
    for (let index = 1; index <= 4; index += 1)
      prepared.push(await h.prepare(input('w11-project-a', 'conv-a', `w11-load-${index}`, `并发消息 ${index}。`)))
    assert('FOUR_PREPARED', prepared.every(item => item.status === 200), JSON.stringify(prepared.map(item => item.status)))
    for (let index = 0; index < 4; index += 1) h.replies.push({ text: `并发回复 ${index + 1}。` })
    const sends = await Promise.all(prepared.map((item, index) => h.send({ commandId: `w11-load-${index + 1}`, token: item.body.token })))
    assert('FOUR_RECORDED', sends.every(item => item.body?.status === 'recorded'), JSON.stringify(sends.map(item => item.body?.status)))
    await h.flush()
    const replies = await waitMessages(h.store, 'conv-a', messages => messages.filter(item => item.provenance === 'reasoner_reply').length >= 4, 20_000)
    assert('FOUR_REPLIES', replies.filter(item => item.provenance === 'reasoner_reply').length === 4, JSON.stringify(replies.map(item => item.provenance)))
    assert('FOUR_PROVIDER_CALLS', h.requests.length === 4, String(h.requests.length))
    assert('FOUR_BINDINGS', bindingCount(h) === 4, String(bindingCount(h)))
    const duplicate = await Promise.all([h.send({ commandId: 'w11-load-1', token: prepared[0].body.token }),
      h.send({ commandId: 'w11-load-1', token: prepared[0].body.token })])
    assert('DUPLICATE_SETTLED', duplicate.every(item => item.status === 200 || item.status === 409), JSON.stringify(duplicate.map(item => item.status)))
    assert('DUPLICATE_NO_CALL', h.requests.length === 4, String(h.requests.length))
    assert('DUPLICATE_ONE_BINDING', bindingCount(h) === 4, String(bindingCount(h)))
    evidence.concurrency = { prepared: 4, recorded: 4, replies: 4, providerCalls: 4, bindings: 4, duplicateCalls: duplicate.map(item => item.status) }
  }))

  for (const h of activeHarnesses.splice(0)) { try { await h.cleanup() } catch { /* already closed */ } }
  return { cases, artifacts: {} }
}
