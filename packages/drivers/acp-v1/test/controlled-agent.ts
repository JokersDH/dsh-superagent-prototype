/**
 * Zero-model integration fixture. Both endpoints use the official stable-v1 SDK and real stdio
 * byte framing. It is never registered by the product and provides no native/physical admission.
 * The caller must give it only its own disposable workspace through the normal session/new flow.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, relative } from 'node:path'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AgentConnection, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import type { AttemptSpec } from '../../../contracts/src/types.ts'
import type { AttemptIO } from '../../../contracts/src/ports.ts'
import type { AcpByteTransport } from '../src/protocol.ts'

export function createControlledAcpAgent(options: {
  file?: string
  content?: string
  permission?: boolean
  /** Keep the prompt running after permission until a standard session/cancel arrives. */
  hold?: boolean
} = {}) {
  const file = options.file ?? 'src/product-output.txt'
  if (isAbsolute(file) || file.split(/[\\/]/).some(part => part === '..' || part === '.git') || file.includes('\0'))
    throw new TypeError('Controlled output must be a safe relative workspace path')
  const observations = { prompts: [] as string[], permissions: [] as RequestPermissionResponse[], cancellations: [] as string[], writes: [] as string[] }
  const connections: AgentConnection[] = []
  return {
    observations,
    async connect(spec: AttemptSpec, _io: AttemptIO): Promise<AcpByteTransport> {
      const toAgent = new TransformStream<Uint8Array>(), toClient = new TransformStream<Uint8Array>()
      const sessionId = `controlled-${spec.attemptId}`
      let cwd = '', cancelled = false, wake!: () => void
      const hold = new Promise<void>(resolve => { wake = resolve })
      const app = agent({ name: 'personal-agent-controlled-acp' })
        .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {}, authMethods: [], agentInfo: { name: 'controlled-acp-fixture', version: '1.0.0' } }))
        .onRequest(methods.agent.session.new, ({ params }) => { cwd = params.cwd; return { sessionId } })
        .onRequest(methods.agent.session.prompt, async context => {
          if (context.params.sessionId !== sessionId || !cwd) throw new TypeError('Unknown controlled session')
          observations.prompts.push(context.params.prompt.filter(item => item.type === 'text').map(item => item.text).join('\n'))
          await context.client.notify(methods.client.session.update, { sessionId, update: {
            sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '正在处理受控工作…\n' },
          } })
          if (options.permission !== false) {
            const answer = await context.client.request(methods.client.session.requestPermission, {
              sessionId, toolCall: { toolCallId: 'controlled-write', title: `写入 ${file}` }, options: [
                { optionId: 'allow-once', name: '允许这一次', kind: 'allow_once' },
                { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
              ],
            })
            observations.permissions.push(answer)
            if (answer.outcome.outcome === 'cancelled' || cancelled) return { stopReason: 'cancelled' }
            if (answer.outcome.optionId !== 'allow-once') return { stopReason: 'refusal' }
          }
          if (options.hold) await hold
          if (cancelled) return { stopReason: 'cancelled' }
          const path = resolve(cwd, file), rel = relative(cwd, path)
          if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new TypeError('Controlled output escaped workspace')
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, options.content ?? 'approved product output\n')
          observations.writes.push(path)
          await context.client.notify(methods.client.session.update, { sessionId, update: {
            sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '变更已准备，等待原产品检查和人工审阅。\n' },
          } })
          return { stopReason: 'end_turn' }
        })
        .onNotification(methods.agent.session.cancel, ({ params }) => {
          if (params.sessionId !== sessionId) return
          cancelled = true; observations.cancellations.push(sessionId); wake()
        })
      const connection = app.connect(ndJsonStream(toClient.writable, toAgent.readable))
      connections.push(connection)
      const writer = toAgent.writable.getWriter()
      return { stdout: toClient.readable as unknown as AsyncIterable<Uint8Array>, write: bytes => writer.write(bytes) }
    },
    close() { for (const connection of connections) connection.close() },
  }
}
