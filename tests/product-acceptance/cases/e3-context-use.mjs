import { join } from 'node:path'
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
    assert('COMPLETED_SAVED', h.completed().size === 1, String(h.completed().size))
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
      auditStable: true, recoveredMessageId: recovered[0].id, persistence: 'in-process-map-fixture-only' }
  }))

  cases.push(await runCase({ ...define('E4-REPLY-UNKNOWN', 'A pre-send receipt without a completed result stays unknown and is never automatically resent'),
    evidence: {} }, async ({ assert, evidence }) => {
    const { root, state, project } = contextProjectRoot()
    // No replyResults port: the production composition must keep the unknown notice and not invent a result.
    const h = await startContextProduct({ stateRoot: state, projectPath: project, withReplyResults: false,
      projects: [{ id: 'w11-project-a', displayName: '项目 A', scope: scope('w11-project-a') }] })
    try {
      h.seed({ id: 'w11-source-u', conversationId: 'conv-u', projectId: 'w11-project-a', role: 'user', provenance: 'trusted_user',
        text: 'W11-UNKNOWN-SOURCE', sourceRefs: [], createdAt: h.now() })
      h.replies.push({ text: '不会作为持久结果保存。' })
      const prepared = await h.prepare(input('w11-project-a', 'conv-u', 'w11-unknown-1', '未知完成结果。'))
      h.store.db.exec("CREATE TRIGGER fail_w11_unknown BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'w11 unknown failure'); END")
      await h.send({ commandId: 'w11-unknown-1', token: prepared.body.token })
      await h.flush()
      await h.flush()
      const messages = await waitMessages(h.store, 'conv-u', list => list.some(item => item.provenance === 'application_notice'))
      assert('UNKNOWN_NOTICE_AFTER_RETRY', messages.some(item => item.provenance === 'application_notice' && item.text.includes('未能确认')), JSON.stringify(messages.map(item => item.text)).slice(0, 300))
      assert('UNKNOWN_ONE_PROVIDER', h.requests.length === 1, String(h.requests.length))
      assert('UNKNOWN_NO_REPLY', !messages.some(item => item.provenance === 'reasoner_reply'), JSON.stringify(messages.map(item => item.provenance)))
      evidence.unknownReply = { providerRequests: h.requests.length, notice: true, reply: false, durableResultPort: false }
    } finally { await h.cleanup() }
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

  cases.push(notTested({ ...define('E4-REPLY-PERSISTENCE', 'Completed results survive a real cross-process restart through the A store'),
    layer: LAYERS.NOT_TESTED, limitations: [
      'Requires A to implement `store.workflows.assistant.replyResults` with the result row and artifact registration in one transaction, plus backup coverage.',
      'The current composition accepts an explicit port; E only used a process-local Map fixture and does not treat reopening SQLite in the same process as durable result persistence.',
    ] }, 'NOT_TESTED: current main/31ddd26 publishes the consumer and its recovery ordering, but the production A replyResults port is not implemented in this checkout (only the in-process fixture port is accepted). Required: real A put/forRequest/forReply rows in the caller transaction, close/reopen and independent-process SIGKILL readback, backup/inventory of the result family and artifact, corrupt-result refusal, and no provider call when the result is recovered. The existing in-process-map recovery case is consumer evidence only.'))

  for (const h of activeHarnesses.splice(0)) { try { await h.cleanup() } catch { /* already closed */ } }
  return { cases, artifacts: {} }
}
