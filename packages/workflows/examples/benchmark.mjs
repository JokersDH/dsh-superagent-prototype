#!/usr/bin/env node
/** Local bounded benchmark: 120 conversations, 1,200 messages, search/list/reopen/snapshot. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts, WorkflowSnapshots } from '../src/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'workflow-benchmark-'))
const path = join(dir, 'state.sqlite')
const ms = async (fn) => { const start = performance.now(); const value = await fn(); return { ms: Math.round((performance.now() - start) * 100) / 100, value } }
try {
  let store = new ProductStore({ path })
  const ports = createWorkflowPorts(store)
  const seed = await ms(() => {
    for (let c = 0; c < 120; c += 1) ports.conversations.create({ id: `conv-${c}`, projectId: 'project-1', title: `会话目录 ${c}` })
    for (let m = 0; m < 1200; m += 1) {
      store.product.messages.append({
        id: `message-${m}`, conversationId: `conv-${m % 120}`, projectId: 'project-1', role: 'user',
        provenance: 'trusted_user', text: `这是第 ${m} 条有界检索消息，包含中文与 ASCII text`, sourceRefs: [], createdAt: `2026-11-10T00:00:${String(m % 60).padStart(2, '0')}.000Z`,
      })
    }
  })
  const catalog = await ms(() => ports.conversations.list({ projectIds: ['project-1'], limit: 30 }))
  const search = await ms(() => ports.conversations.search({ query: '有界检索', projectIds: ['project-1'], limit: 20 }))
  const shortSearch = await ms(() => ports.conversations.search({ query: '消息', projectIds: ['project-1'], limit: 20 }))
  const artifacts = await ms(() => {
    const written = store.artifacts.write(Buffer.from('benchmark artifact\n'))
    store.artifacts.insert(written)
    return written
  })
  const snapshots = new WorkflowSnapshots(store)
  const snapshot = await ms(() => snapshots.create({ destination: join(dir, 'snapshot') }))
  store.close()
  store = new ProductStore({ path })
  const reopen = await ms(() => createWorkflowPorts(store).conversations.list({ projectIds: ['project-1'], limit: 30 }))
  const verify = snapshots.verify(join(dir, 'snapshot')).status
  store.close()
  console.log(JSON.stringify({
    protocol: 'workflow-benchmark/1', node: process.version, platform: process.platform, architecture: process.arch,
    dataset: { conversations: 120, messages: 1200, sameTimestampMessages: 60 },
    seed: { ms: seed.ms }, catalog: { ms: catalog.ms, returned: catalog.value.conversations.length },
    search: { ms: search.ms, returned: search.value.hits.length }, shortSearch: { ms: shortSearch.ms, returned: shortSearch.value.hits.length },
    reopen: { ms: reopen.ms, returned: reopen.value.conversations.length },
    artifact: { id: artifacts.value.id, bytes: artifacts.value.bytes },
    snapshot: { ms: snapshot.ms, status: snapshot.value.status, artifacts: snapshot.value.manifest.artifacts.length, verify },
    scope: 'temporary state only; no model/account/network/user project',
  }, null, 2))
} finally { rmSync(dir, { recursive: true, force: true }) }
