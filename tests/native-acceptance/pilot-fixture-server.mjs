#!/usr/bin/env node
/**
 * Pilot protocol fixture server (wave-06 B).
 *
 * A small `codex app-server` look-alike that speaks the same JSON-RPC 2.0 stdio protocol for the
 * methods the pilot uses. It exists to prove the CONTROL FLOW of the billing chain - reservation
 * before send, usage collection, cancel, and reconciliation by original identity - without spending
 * a model turn.
 *
 * What this is NOT: evidence that the real vendor behaves this way. The real binary is exercised
 * separately in b7-pilot-transport.mjs for the non-billing operations and for the measured
 * checkpoint boundary. Cases that run against this fixture are reported as `protocol_fixture`.
 *
 * Behaviour modelled from the real binary (measured):
 *   - a thread with no turns has no rollout, so thread/resume and thread/fork refuse
 *   - thread/read works for a thread loaded in this process, refuses otherwise
 *   - turn/start creates a turn; turn/completed and thread/tokenUsage/updated follow
 *   - turn/interrupt stops the running turn
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

/** Optional path (argv[2]) where every received method is appended: server-side wire truth. */
const JOURNAL = process.argv[2] ?? null
const journal = method => {
  if (!JOURNAL) return
  try {
    appendFileSync(JOURNAL, `${method}\n`)
  } catch {}
}

const STATE = {
  threads: new Map(),
  nextTurn: 1,
  /** Every method that reached this server, in order - the wire truth a test asserts on. */
  received: [],
  /** Extra turn/start attempts beyond the first, to model a duplicate send. */
  turnsStarted: 0,
}

let nextThread = 1
const respond = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
const fail = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
const notify = (method, params) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)

const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'parse-error', error: { code: -32700, message: 'Parse error' } })}\n`)
    return
  }
  if (message.method === 'test/state') {
    // A test-only introspection hook, namespaced so it can never collide with a protocol method.
    return respond(message.id, {
      received: STATE.received,
      turnsStarted: STATE.turnsStarted,
      threads: [...STATE.threads.entries()].map(([id, thread]) => ({ id, ephemeral: thread.ephemeral, turns: thread.turns.length })),
    })
  }
  STATE.received.push(message.method)
  journal(message.method)
  handle(message)
})
rl.on('close', () => process.exit(0))

function handle(message) {
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      return respond(id, { userAgent: 'pilot-fixture/1', codexHome: '/tmp/fixture-home', platformFamily: 'unix', platformOs: 'fixture' })

    case 'thread/start': {
      const threadId = `fixture-thread-${nextThread++}`
      STATE.threads.set(threadId, { ephemeral: params?.ephemeral === true, turns: [] })
      return respond(id, {
        thread: { id: threadId, turns: [] },
        model: params?.model ?? 'fixture-model-1',
        modelProvider: 'fixture-provider',
        serviceTier: null,
      })
    }

    case 'thread/read': {
      const thread = STATE.threads.get(params?.threadId)
      if (!thread) return fail(id, -32600, `thread not loaded: ${params?.threadId}`)
      return respond(id, { thread: { id: params.threadId, turns: thread.turns.map(turn => ({ id: turn.id, status: turn.status })) } })
    }

    case 'thread/resume':
    case 'thread/fork': {
      const thread = STATE.threads.get(params?.threadId)
      if (!thread) return fail(id, -32600, `thread not loaded: ${params?.threadId}`)
      // Measured from the real binary: a thread with no turns has no rollout to load.
      if (thread.turns.length === 0) return fail(id, -32600, `no rollout found for thread id ${params.threadId}`)
      const targetId = method === 'thread/fork' ? `fixture-thread-${nextThread++}` : params.threadId
      if (method === 'thread/fork') STATE.threads.set(targetId, { ephemeral: params?.ephemeral === true, turns: thread.turns.slice() })
      return respond(id, { thread: { id: targetId, turns: (STATE.threads.get(targetId)?.turns ?? []).map(t => ({ id: t.id, status: t.status })) }, model: 'fixture-model-1', modelProvider: 'fixture-provider', serviceTier: null })
    }

    case 'turn/start': {
      const thread = STATE.threads.get(params?.threadId)
      if (!thread) return fail(id, -32600, `thread not loaded: ${params?.threadId}`)
      const turnId = `fixture-turn-${STATE.nextTurn++}`
      STATE.turnsStarted += 1
      thread.turns.push({ id: turnId, status: 'in_progress' })
      // Reply first, then emit the notifications the real server emits.
      respond(id, { turn: { id: turnId, status: 'in_progress' } })
      setImmediate(() => {
        notify('thread/tokenUsage/updated', {
          threadId: params.threadId,
          turnId,
          tokenUsage: {
            total: { totalTokens: 120, inputTokens: 100, cachedInputTokens: 40, cacheWriteInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5 },
            last: { totalTokens: 120, inputTokens: 100, cachedInputTokens: 40, cacheWriteInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5 },
            modelContextWindow: 200000,
          },
        })
        const entry = thread.turns.find(turn => turn.id === turnId)
        if (entry && entry.status === 'in_progress') entry.status = 'completed'
        notify('turn/completed', { threadId: params.threadId, turnId, status: 'completed' })
      })
      return
    }

    case 'turn/interrupt': {
      const thread = STATE.threads.get(params?.threadId)
      const entry = thread?.turns.find(turn => turn.id === (params?.turnId ?? thread?.turns.at(-1)?.id))
      if (entry && entry.status === 'in_progress') entry.status = 'interrupted'
      return respond(id, { interrupted: Boolean(entry), turnId: entry?.id ?? null })
    }

    default:
      return fail(id, -32601, `Method not found: ${method}`)
  }
}
