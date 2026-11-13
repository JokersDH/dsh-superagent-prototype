#!/usr/bin/env node
/**
 * B-owned local Codex app-server producer (wave-18 B1).
 *
 * This is the executable `CodexProductDriver` spawns. It speaks the installed app-server protocol the
 * product Driver actually uses: version probe, initialize, thread/start with the driver's own cwd and
 * approval policy, turn/start, an approval server request, and turn/interrupt.
 *
 * Wave-17's attempt reused `createFakeAppServer`, which is the test-lane double for CodexNativeDriver;
 * its thread/start and approval shapes do not match the product Driver, so preparation never
 * completed. Rather than bend the Driver or fake a prepared fact, this file implements the protocol
 * shape the real Driver expects.
 *
 * Nothing here launches a process, opens a socket, reads credentials or contacts a provider. It is a
 * local protocol stub; the product's own guards do all admission.
 *
 * Usage: node fake-codex-producer.mjs [--version]
 */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

if (process.argv.includes('--version') || process.argv.includes('-V')) {
  process.stdout.write('codex-cli 0.164.0\n')
  process.exit(0)
}

const threadId = `b18-thread-${process.pid}`
let turnSerial = 0
let liveTurnId = ''
/** The pending approval server request id; 0 means none is outstanding. */
let approvalRequestId = 0
let approvalSerial = 7000

// Optional method log so a harness can state what the producer ACTUALLY received, instead of
// inferring a stop from the product's own bookkeeping.
const methodLog = process.env.PA_PRODUCER_LOG
const record = entry => {
  if (!methodLog) return
  try { appendFileSync(methodLog, `${JSON.stringify(entry)}\n`) } catch {}
}

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
const notify = (method, params) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
const serverRequest = (id, method, params) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)

const nextTurn = () => { turnSerial += 1; liveTurnId = `b18-turn-${turnSerial}`; return liveTurnId }

const complete = status => {
  notify('turn/completed', { threadId, turn: { id: liveTurnId, status } })
  liveTurnId = ''
  approvalRequestId = 0
}

/**
 * The fake workspace denies nothing, but the sandbox block is echoed from the thread/start params so
 * the Driver's own consistency checks see what it asked for.
 */
const sandboxFor = cwd => ({
  type: 'workspaceWrite',
  networkAccess: false,
  excludeSlashTmp: true,
  excludeTmpdirEnvVar: true,
  writableRoots: [cwd],
})

const handle = message => {
  if (message.method !== undefined) record({ method: message.method, at: new Date().toISOString() })
  // A response to our outstanding approval server request, not a new method call.
  if (message.method === undefined) {
    if (message.id !== approvalRequestId) return
    approvalRequestId = 0
    notify('serverRequest/resolved', { threadId, requestId: message.id })
    // In hold mode the turn stays open after the approval, which is what makes a later stop a real
    // interruption of a live turn rather than a no-op on an already finished one.
    if (process.env.PA_PRODUCER_HOLD !== '1') complete('completed')
    return
  }

  switch (message.method) {
    case 'initialize':
      reply(message.id, { userAgent: `b18-local-producer/${process.pid}` })
      return
    case 'thread/start': {
      const cwd = message.params?.cwd
      reply(message.id, {
        thread: { id: threadId },
        cwd,
        approvalPolicy: message.params?.approvalPolicy,
        model: message.params?.model ?? 'b18-local-only',
        sandbox: sandboxFor(cwd),
      })
      return
    }
    case 'turn/start': {
      const id = nextTurn()
      reply(message.id, { turn: { id } })
      // A permission question is how the product reaches a real Broker question.
      approvalSerial += 1
      approvalRequestId = approvalSerial
      serverRequest(approvalRequestId, 'item/commandExecution/requestApproval', {
        threadId,
        turnId: id,
        itemId: `b18-item-${turnSerial}`,
        reason: 'B-owned local producer approval',
      })
      return
    }
    case 'turn/interrupt': {
      reply(message.id, {})
      complete('interrupted')
      return
    }
    default:
      // Unknown methods are refused loudly rather than acknowledged: a silent success would let the
      // product believe a capability exists that this stub does not implement.
      process.stderr.write(`b18-producer: unsupported method ${message.method}\n`)
      if (message.id !== undefined) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unsupported method: ${message.method}` } })}\n`)
      }
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  let message
  try { message = JSON.parse(line) } catch { continue }
  handle(message)
}
