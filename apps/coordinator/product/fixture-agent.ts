import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { JsonLineDecoder, encodeFrame } from '../../../packages/driver-kit/src/index.ts'

const { values } = parseArgs({ options: { mode: { type: 'string', default: 'question' } } })
const decoder = new JsonLineDecoder({ maxFrameBytes: 128 * 1024, maxBufferedBytes: 256 * 1024 })
const requestId = { kind: 'integer', decimal: '9223372036854775807' }
let began = false,
  pending = false,
  closed = false
const emit = (value: unknown) => process.stdout.write(encodeFrame(value))
const receipt = (value: object) => {
  if (process.env.PA_FIXTURE_RECEIPTS) appendFileSync(process.env.PA_FIXTURE_RECEIPTS, JSON.stringify(value) + '\n')
}
const finish = (outcome: string) => {
  if (closed) return
  closed = true
  process.stdout.write(
    encodeFrame({
      type: 'turn_ended',
      outcome,
      nativeTurnRef: 'fixture-turn',
      candidateAvailable: outcome === 'completed',
    }),
    () => process.exit(0),
  )
}
const produce = () => {
  if (closed) return
  mkdirSync('src', { recursive: true })
  writeFileSync('src/product-output.txt', values.mode === 'fail' ? 'invalid output\n' : 'approved product output\n')
  receipt({ type: 'artifact.written' })
  finish('completed')
}
emit({ type: 'ready' })
process.stdin.on('data', (chunk) => {
  for (const frame of decoder.push(chunk)) {
    const command = frame.value as {
      type?: string
      id?: string
      answerId?: string
      targetBindingId?: string
      answer?: { kind?: string; optionIds?: string[] }
      nativeRequestId?: unknown
    }
    receipt({ type: command.type, id: command.id })
    if (command.type === 'cancel') {
      emit({ type: 'cancel_observed', commandId: command.id })
      finish('cancelled')
      continue
    }
    if (command.type === 'begin') {
      if (began) {
        emit({ type: 'fatal', message: 'duplicate begin' })
        continue
      }
      began = true
      emit({ type: 'input_read', commandId: command.id })
      if (values.mode === 'question') {
        pending = true
        emit({ type: 'question', requestId, prompt: 'Allow the controlled fixture to write its scratch artifact?' })
      } else if (values.mode === 'slow') setTimeout(produce, 1500)
      else produce()
    }
    if (command.type === 'deliver') emit({ type: 'input_read', commandId: command.id })
    if (command.type === 'answer' && pending) {
      if (JSON.stringify(command.nativeRequestId) !== JSON.stringify(requestId)) {
        emit({ type: 'fatal', message: 'wrong native request' })
        continue
      }
      pending = false
      emit({ type: 'answer_applied', answerId: command.answerId, targetBindingId: command.targetBindingId, requestId })
      if (command.answer?.kind === 'choices' && command.answer.optionIds?.[0] === 'allow') produce()
      else finish('cancelled')
    }
  }
})
process.stdin.on('end', () => {
  if (!closed) process.exit(0)
})
