import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrivateModelProvider } from '../../../apps/coordinator/product/model-provider.ts'

export async function candidateModel({ reply, gate } = {}) {
  const root = mkdtempSync('/tmp/pa-candidate-model-'), requests = [], key = 'fixture-candidate-private-key'
  let makeReply = reply ?? (context => ({ text: '已整理为一项项目决定。', suggestions: [{ kind: 'propose_decision',
    content: '支付接口保留原有错误码。', scope: context.scope, sourceMessageId: context.sourceMessageId }] }))
  const server = createServer(async (request, response) => {
    let bytes = ''; for await (const chunk of request) bytes += chunk
    const input = JSON.parse(bytes); requests.push(input)
    const context = input.tools ? JSON.parse(input.messages.at(-1).content).requestContext : undefined
    const body = makeReply(context, input)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = delta => response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    emit({ content: body.text.slice(0, 2) })
    if (requests.length === 1 && gate) await gate
    emit({ content: body.text.slice(2) })
    if (input.tools) {
      const text = JSON.stringify(body)
      emit({ tool_calls: [{ index: 0, id: 'candidate-data', type: 'function', function: { name: 'assistant_reply', arguments: text.slice(0, 17) } }] })
      emit({ tool_calls: [{ index: 0, function: { arguments: text.slice(17) } }] })
    }
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: input.tools ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const file = join(root, 'model.json')
  writeFileSync(file, JSON.stringify({ baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: key,
    model: 'candidate-mock', allowedModels: ['candidate-mock'], allowInsecureHttp: true, maxOutputTokens: 512, suggestionsEnabled: true }), { mode: 0o600 })
  return { root, file, key, requests, provider: new PrivateModelProvider(file),
    setReply: value => { makeReply = value },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }) },
  }
}
