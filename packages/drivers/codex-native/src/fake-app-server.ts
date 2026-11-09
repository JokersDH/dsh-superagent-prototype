/**
 * Fake Codex app-server (WP-07 test double).
 *
 * Speaks the method names the *installed* protocol exposes (verified against codex-cli 0.164.0's
 * exported schema): `initialize`, `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`,
 * `turn/completed`, `item/*`, `thread/tokenUsage/updated`, plus a server-initiated approval request
 * carrying a top-level JSON-RPC `id`.
 *
 * It exists so the real Driver can be exercised end to end (including over an independent Runner
 * process) without executing an installed vendor binary. It is **not** evidence of vendor
 * compatibility.
 */
import { Buffer } from 'node:buffer'

export type FakeAppServerOptions = {
  /** Emit a command approval request before the turn completes. */
  approval?: boolean
  /** Emit a config-changed notification. */
  configChanged?: boolean
  threadId?: string
  turnId?: string
}

export type FakeAppServer = {
  transport(): {
    send: (bytes: Uint8Array) => void
    onData: (listener: (chunk: Uint8Array) => void) => void
    close: () => void
  }
  received: Array<Record<string, unknown>>
  /** Emit a notification or server request to the Driver. */
  emit(value: unknown): void
}

export function createFakeAppServer(options: FakeAppServerOptions = {}): FakeAppServer {
  const listeners: Array<(chunk: Uint8Array) => void> = []
  const received: Array<Record<string, unknown>> = []
  let buffer = ''
  let approvalSent = false

  const emit = (value: unknown): void => {
    const chunk = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
    for (const listener of listeners) listener(chunk)
  }

  const send = (bytes: Uint8Array): void => {
    buffer += Buffer.from(bytes).toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      const message = JSON.parse(line) as Record<string, unknown>
      received.push(message)
      handle(message)
      newline = buffer.indexOf('\n')
    }
  }

  const handle = (message: Record<string, unknown>): void => {
    const id = message.id
    // A reply from the Driver to our server request: the approval is resolved.
    if (message.method === undefined && id !== undefined && ('result' in message || 'error' in message)) {
      emit({ jsonrpc: '2.0', method: 'serverRequest/resolved', params: { id } })
      emit({ jsonrpc: '2.0', method: 'item/completed', params: { turnId: options.turnId ?? 'turn-1', item: { id: 'item-2', type: 'commandExecution' } } })
      emit({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: options.turnId ?? 'turn-1', status: 'completed' } } })
      return
    }
    switch (message.method) {
      case 'initialize':
        emit({ jsonrpc: '2.0', id, result: { userAgent: 'codex-app-server/fake' } })
        return
      case 'thread/start':
        emit({ jsonrpc: '2.0', id, result: { thread: { id: options.threadId ?? 'thread-1' } } })
        return
      case 'turn/start':
        emit({ jsonrpc: '2.0', id, result: { turn: { id: options.turnId ?? 'turn-1' } } })
        emit({ jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: options.turnId ?? 'turn-1' } } })
        emit({ jsonrpc: '2.0', method: 'item/started', params: { turnId: options.turnId ?? 'turn-1', item: { id: 'item-1', type: 'agentMessage' } } })
        if (options.configChanged) {
          emit({ jsonrpc: '2.0', method: 'config/changed', params: { previous: 'a'.repeat(64), observed: 'b'.repeat(64) } })
        }
        if (options.approval && !approvalSent) {
          approvalSent = true
          // A server-initiated request: top-level id, not a response.
          emit({ jsonrpc: '2.0', id: 42, method: 'ExecCommandApproval/requestApproval', params: { reason: 'run the test suite' } })
          return
        }
        emit({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: options.turnId ?? 'turn-1', status: 'completed' } } })
        return
      case 'turn/steer':
      case 'turn/interrupt':
        if (message.method === 'turn/interrupt') {
          emit({ jsonrpc: '2.0', id, result: {} })
          emit({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: options.turnId ?? 'turn-1', status: 'interrupted' } } })
        } else {
          emit({ jsonrpc: '2.0', id, result: {} })
        }
        return
      default:
        if (id !== undefined) emit({ jsonrpc: '2.0', id, result: {} })
    }
  }

  return {
    received,
    emit,
    transport: () => ({
      send,
      onData: listener => listeners.push(listener),
      close: () => listeners.splice(0),
    }),
  }
}
