import { join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { countRows } from '../lib/product-db.mjs'
import { cleanup, pickPort, tempState } from '../lib/instance.mjs'
import { scratchProject, startFaultProduct } from '../lib/fault-product.mjs'

const define = (id, title, extra = {}) => ({
  id,
  title,
  layer: extra.layer ?? LAYERS.CONTROLLED,
  limitations: [
    'Controlled fixture product with real SQLite; context is untrusted data and no model is called.',
    ...(extra.limitations ?? []),
  ],
})

async function waitWork(client, workId, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await client.work(workId)
    if (predicate(latest)) return latest
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`work ${workId} did not reach the expected state: ${JSON.stringify(latest)?.slice(0, 240)}`)
}

/**
 * Wave-10 independent acceptance of main's read-only context preview and work-evidence history.
 * The preview must bind an exact project/conversation/work, clamp a caller budget to its own
 * ceiling, report truncation/omission honestly and create no execution effect. Context use
 * (sending a message with selected sources) has no product entry and stays NOT_TESTED.
 */
export async function runContext({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const { root: stateRoot, state } = tempState('pa-w10-context-')
  const { project: projectPath } = scratchProject()
  const scopeA = { projectId: 'project-ctx-a', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
  const scopeB = { projectId: 'project-ctx-b', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
  let runtime
  let sequence = 0
  const commandId = (kind) => `w10ctx-${kind}-${++sequence}`

  try {
    runtime = await startFaultProduct({
      stateRoot: state,
      projectPath,
      projects: [
        { id: scopeA.projectId, scope: scopeA },
        { id: scopeB.projectId, scope: scopeB },
      ],
    })
    const client = runtime.client
    const configuration = await client.configuration()
    const project = configuration.projects.find((item) => item.id === scopeA.projectId)
    const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)
    const profileId = project.profileIds.find((id) => id.endsWith('-pass')) ?? project.defaultProfileId
    await client.dispatch({ commandId: commandId('chat'), conversationId: 'conv-ctx-a', kind: 'chat', projectId: scopeA.projectId, text: '上下文预览来源：实现支付幂等校验。' })
    const created = await client.dispatch({
      commandId: commandId('work'),
      conversationId: 'conv-ctx-a',
      kind: 'create_work',
      projectId: scopeA.projectId,
      profileId,
      goal: '上下文预览的受控工作',
      scope: scopeA,
      criteria: [machine],
    })
    const workId = created.receipt.workId
    let view = await waitWork(client, workId, (item) => item.actions.available.includes('accept_candidate') || item.phase === 'delivered')
    if (view.actions.available.includes('accept_candidate')) {
      await client.dispatch({ commandId: commandId('accept'), conversationId: 'conv-ctx-a', kind: 'accept_candidate', candidate: view.actions.currentCandidate })
      view = await waitWork(client, workId, (item) => item.phase === 'delivered')
    }
    await client.dispatch({ commandId: commandId('chat-b'), conversationId: 'conv-ctx-b', kind: 'chat', projectId: scopeB.projectId, text: '项目 B 的消息不应出现在项目 A 的上下文。' })

    const preview = (body) => client.request('/v1/context/preview', { method: 'POST', body })

    cases.push(
      await runCase(
        { ...define('E3-CONTEXT-PREVIEW', 'Context preview is bounded, project/work bound and free of execution effects'), evidence: {} },
        async ({ assert, evidence }) => {
          const worksBefore = (await client.snapshot({ conversationId: 'conv-ctx-a' })).works.length
          const receiptsBefore = countRows(state, root, 'command_receipts')
          const bounded = await preview({
            projectId: scopeA.projectId,
            conversationId: 'conv-ctx-a',
            workId,
            selections: ['work', 'conversation', 'project'],
            budget: { maxFiles: 64, maxBytes: 4194304, maxTokens: 500000 },
          })
          assert('PREVIEW_200', bounded.status === 200, `status ${bounded.status} ${JSON.stringify(bounded.body)}`)
          const value = bounded.body
          assert('PREVIEW_PROTOCOL', value.protocol === 'context-preview/1', value.protocol)
          assert('PREVIEW_TRUST', value.trust === 'untrusted_data', value.trust)
          assert('PREVIEW_BUDGET_CLAMPED', Array.isArray(value.budgetClamped) && value.budgetClamped.length > 0, JSON.stringify(value.budgetClamped))
          assert('PREVIEW_BUDGET_WITHIN_CEILING', value.budget.maxFiles <= 32 && value.budget.maxBytes <= 131072 && value.budget.maxTokens <= 32768, JSON.stringify(value.budget))
          assert('PREVIEW_TOTALS', value.totals.files === value.sources.length && value.totals.bytes === value.sources.reduce((sum, item) => sum + item.bytes, 0), JSON.stringify(value.totals))
          assert('PREVIEW_TOTALS_WITHIN', value.totals.files <= value.budget.maxFiles && value.totals.bytes <= value.budget.maxBytes && value.totals.tokens <= value.budget.maxTokens, JSON.stringify({ totals: value.totals, budget: value.budget }))
          const ttl = Date.parse(value.expiresAt) - Date.parse(value.observedAt)
          assert('PREVIEW_TTL', ttl > 0 && ttl <= 5 * 60 * 1000 + 1_000, String(ttl))
          assert('PREVIEW_CONTRACT', value.contract?.workId === workId, JSON.stringify(value.contract))
          const kinds = new Set(value.sources.map((item) => item.kind))
          assert('PREVIEW_WORK_SOURCES', kinds.has('work') && kinds.has('contract'), JSON.stringify([...kinds]))
          assert('PREVIEW_SOURCE_BINDING', value.projectId === scopeA.projectId && value.conversationId === 'conv-ctx-a', JSON.stringify({ project: value.projectId, conversation: value.conversationId }))
          assert('PREVIEW_NO_EFFECT', (await client.snapshot({ conversationId: 'conv-ctx-a' })).works.length === worksBefore && countRows(state, root, 'command_receipts') === receiptsBefore)

          const small = await preview({
            projectId: scopeA.projectId,
            conversationId: 'conv-ctx-a',
            workId,
            selections: ['work', 'conversation', 'project'],
            budget: { maxFiles: 1, maxBytes: 1, maxTokens: 1 },
          })
          assert('PREVIEW_SMALL_BUDGET', small.status === 200 && small.body.status !== 'sufficient', JSON.stringify({ status: small.body?.status, omitted: small.body?.omitted?.length }))
          assert('PREVIEW_SMALL_OMITS', Array.isArray(small.body.omitted) && small.body.omitted.length > 0, JSON.stringify(small.body.omitted?.slice(0, 3)))

          const foreignWork = await preview({ projectId: scopeB.projectId, conversationId: 'conv-ctx-a', workId, selections: ['work'], budget: { maxFiles: 8, maxBytes: 65536, maxTokens: 8192 } })
          assert('CROSS_PROJECT_REFUSED', [400, 403].includes(foreignWork.status), `status ${foreignWork.status} ${JSON.stringify(foreignWork.body)}`)
          const foreignConversation = await preview({ projectId: scopeB.projectId, conversationId: 'conv-ctx-a', selections: ['conversation'], budget: { maxFiles: 8, maxBytes: 65536, maxTokens: 8192 } })
          assert('FOREIGN_CONVERSATION_REFUSED', [400, 403].includes(foreignConversation.status), `status ${foreignConversation.status}`)
          const missingWork = await preview({ projectId: scopeA.projectId, conversationId: 'conv-ctx-a', selections: ['work'], budget: { maxFiles: 8, maxBytes: 65536, maxTokens: 8192 } })
          assert('WORK_REQUIRED', missingWork.status === 400, `status ${missingWork.status}`)
          const invalidBudget = await preview({ projectId: scopeA.projectId, conversationId: 'conv-ctx-a', selections: ['project'], budget: { maxFiles: 0, maxBytes: 1, maxTokens: 1 } })
          assert('INVALID_BUDGET_REFUSED', invalidBudget.status === 400, `status ${invalidBudget.status}`)
          const noSelections = await preview({ projectId: scopeA.projectId, conversationId: 'conv-ctx-a', selections: [], budget: { maxFiles: 8, maxBytes: 65536, maxTokens: 8192 } })
          assert('EMPTY_SELECTIONS_REFUSED', noSelections.status === 400, `status ${noSelections.status}`)

          evidence.contextPreview = {
            protocol: value.protocol,
            trust: value.trust,
            budget: value.budget,
            budgetClamped: value.budgetClamped,
            totals: value.totals,
            sources: value.sources.length,
            kinds: [...kinds].sort(),
            issues: value.issues,
            status: value.status,
            refusals: { crossProject: foreignWork.status, foreignConversation: foreignConversation.status, missingWork: missingWork.status, invalidBudget: invalidBudget.status, emptySelections: noSelections.status },
          }
        },
      ),
    )

    cases.push(
      notTested(
        define('E5-CONTEXT-USE', 'An explicitly selected context is sent with one message and audited', { layer: LAYERS.NOT_TESTED }),
        'NOT_TESTED: main publishes the context preview and the AssistantContextBinding contract, but no context-use HTTP or provider attachment. Required: an explicit per-message selection, revalidation of source/contract/grant immediately before send, a binding and receipt in the same transaction, no automatic resend after a lost response/unknown result, and a source audit showing what was used. A preview or the binding schema is not a send.',
      ),
    )
  } finally {
    await runtime?.close?.()
    artifacts.cleaned = cleanup({ root: stateRoot, state }, { keep })
  }
  return { cases, artifacts }
}
