import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Loopback OpenAI-compatible mock. It exists so the real product dialogue path (SDK -> effect ->
 * SSE -> console) can be exercised without a vendor call or a billing identity.
 *
 * The product opens the model configuration through PA_MODEL_CONFIG, so every call re-reads it; a
 * private 0700 directory plus a 0600 file match the provider's own file checks.
 */
export async function startMockModel({ stateRoot, reply = '收到，我会先核对当前工作与可用动作。' }) {
  const requests = []
  let attempts = 0
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'bad json' } }))
        return
      }
      if (request.method !== 'POST' || !/(^|\/)chat\/completions$/.test(request.url ?? '')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }
      attempts += 1
      requests.push({
        at: new Date().toISOString(),
        model: body.model,
        stream: body.stream === true,
        messages: Array.isArray(body.messages) ? body.messages : [],
      })
      if (body.stream === true) {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        })
        const frame = (delta, finish) =>
          `data: ${JSON.stringify({
            id: `mock-${attempts}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model ?? 'mock-model',
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`
        response.write(frame({ role: 'assistant', content: '' }, null))
        for (const slice of String(reply).match(/[^。！？]{1,24}[。！？]?/g) ?? [String(reply)])
          response.write(frame({ content: slice }, null))
        response.write(frame({}, 'stop'))
        response.write('data: [DONE]\n\n')
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: `mock-${attempts}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: String(reply) }, finish_reason: 'stop' }],
        }),
      )
    })
  })
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  const configDir = join(stateRoot, 'model')
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const configPath = join(configDir, 'model.json')
  const apiKey = 'mock-local-key-0123456789'
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        baseURL: `http://127.0.0.1:${port}`,
        apiKey,
        model: 'mock-model',
        allowedModels: ['mock-model'],
        allowInsecureHttp: true,
        maxOutputTokens: 256,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  )
  return {
    port,
    configPath,
    requests,
    get attempts() {
      return attempts
    },
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
