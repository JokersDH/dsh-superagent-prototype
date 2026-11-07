/**
 * Programmable fake native agent (WP-03 test double).
 *
 * This is NOT a vendor protocol implementation and proves no native compatibility. It is a child
 * process that speaks the test-local NDJSON protocol so Runner/DriverKit fault cases can be
 * reproduced without model accounts:
 *
 *   stdin  (Runner -> agent): {type:'begin'|'deliver'|'answer'|'cancel'|'shutdown', ...}
 *   stdout (agent -> Runner): {type:'ready'|'question'|'progress'|'turn_ended'|'cancel_observed'
 *                                    |'answer_observed'|'fatal'|'exit', ...}
 *
 * Every consumed frame is appended to `$FAKE_AGENT_RECEIPTS` (JSONL) synchronously, which gives the
 * tests an independent control-latency and request-count witness outside stdout.
 *
 * Scenarios: happy | waiting-user | burst | torture | malformed-utf8 | oversize | exit-after-begin
 *            | crash-after-begin | eof-after-begin | ignore-cancel | slow-begin
 */
import { appendFileSync, closeSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { JsonLineDecoder, encodeFrame } from '../../driver-kit/src/index.ts'

const argv = process.argv.slice(2)
const scenario = valueOf('--scenario') ?? 'happy'
const delayMs = Number(valueOf('--delay-ms') ?? '0')
const receiptsPath = process.env.FAKE_AGENT_RECEIPTS

function valueOf(name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function write(value: unknown): void {
  try {
    process.stdout.write(encodeFrame(value, { maxFrameBytes: 4 * 1024 * 1024 }))
  } catch {
    // stdout may be deliberately closed by the eof scenario.
  }
}

function receipt(value: Record<string, unknown>): void {
  if (!receiptsPath) return
  appendFileSync(receiptsPath, `${JSON.stringify({ ...value, at: Date.now() })}\n`)
}

let began = false
let stopped = false

write({ type: 'ready', pid: process.pid, node: process.version, scenario })

const decoder = new JsonLineDecoder({ maxFrameBytes: 8 * 1024 * 1024, maxBufferedBytes: 16 * 1024 * 1024 })
process.stdin.on('data', chunk => {
  let frames
  try {
    frames = decoder.push(chunk as Uint8Array)
  } catch (error) {
    write({ type: 'fatal', code: 'protocol_error', detail: error instanceof Error ? error.message : String(error) })
    receipt({ type: 'parse-failed' })
    return
  }
  for (const frame of frames) dispatch(frame.value)
})
process.stdin.on('end', () => {
  receipt({ type: 'stdin-eof' })
})

function dispatch(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  const message = value as Record<string, unknown>
  const type = message.type
  receipt({ type: 'received', frame: type, id: message.id })
  if (type === 'cancel') return onCancel(message)
  if (type === 'shutdown') {
    stopped = true
    write({ type: 'exit', code: 0 })
    process.exit(0)
  }
  if (type === 'begin') return onBegin(message)
  if (type === 'deliver') {
    write({ type: 'progress', text: 'delivered' })
    return
  }
  if (type === 'answer') {
    write({ type: 'answer_observed', answerRef: message.answerRef ?? null })
    return
  }
  write({ type: 'unknown_input', frame: type ?? null })
}

function onBegin(message: Record<string, unknown>): void {
  if (began) {
    // A second begin on the same connection is a protocol violation the Runner must never cause.
    write({ type: 'fatal', code: 'duplicate_begin' })
    return
  }
  began = true
  receipt({ type: 'begin.accepted', preparedPolicyRef: message.preparedPolicyRef ?? null })
  const respond = (): void => {
    if (stopped) return
    switch (scenario) {
      case 'waiting-user':
        write({ type: 'progress', text: 'waiting for user' })
        write({ type: 'question', questionId: 'q-1', nativeRequestId: 'req-1' })
        return
      case 'burst':
        for (let index = 0; index < 400; index += 1) write({ type: 'progress', index, text: `progress-${index}` })
        for (let index = 0; index < 32; index += 1) process.stderr.write(`stderr-line-${index} ${'x'.repeat(2048)}\n`)
        write({ type: 'turn_ended', outcome: 'completed', nativeTurnRef: 'turn-burst' })
        return
      case 'torture': {
        const frame = encodeFrame({ type: 'progress', text: 'split-frame' })
        process.stdout.write(frame.subarray(0, Math.floor(frame.length / 2)))
        setTimeout(() => {
          if (stopped) return
          process.stdout.write(frame.subarray(Math.floor(frame.length / 2)))
          process.stdout.write('{"type":"progress","text":"crlf"}\r\n\n')
          write({ type: 'unknown_notification', payload: { note: 'must not become a business fact' } })
          write({ type: 'turn_ended', outcome: 'completed', nativeTurnRef: 'turn-torture' })
        }, 20)
        return
      }
      case 'malformed-utf8':
        process.stdout.write(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d, 0x0a]))
        return
      case 'oversize':
        process.stdout.write(Buffer.from(`${'x'.repeat(2 * 1024 * 1024)}\n`, 'utf8'))
        return
      case 'exit-after-begin':
        write({ type: 'turn_ended', outcome: 'completed', nativeTurnRef: 'turn-exit' })
        process.exit(7)
        return
      case 'crash-after-begin':
        write({ type: 'turn_ended', outcome: 'completed', nativeTurnRef: 'turn-crash' })
        process.kill(process.pid, 'SIGKILL')
        return
      case 'eof-after-begin':
        closeSync(1)
        return
      case 'ignore-cancel':
        write({ type: 'progress', text: 'ignoring cancellation' })
        return
      case 'explode':
        write({ type: 'fatal', code: 'native_bug' })
        process.exit(9)
        return
      default:
        write({ type: 'progress', text: 'working' })
        write({ type: 'turn_ended', outcome: 'completed', nativeTurnRef: 'turn-1' })
        return
    }
  }
  if (delayMs > 0 && scenario === 'slow-begin') setTimeout(respond, delayMs)
  else respond()
}

function onCancel(message: Record<string, unknown>): void {
  receipt({ type: 'cancel.received', commandId: message.id ?? null })
  if (scenario === 'ignore-cancel') return
  write({ type: 'cancel_observed', commandId: message.id ?? null, at: Date.now() })
}
