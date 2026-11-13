import { createInterface } from 'node:readline'

// Local protocol data only. This fixture never launches tools or contacts a provider.
if (process.argv.includes('--version')) {
  console.log('codex-cli 0.164.0')
  process.exit(0)
}
const emit = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const threadId = 'main-diagnostic-thread'
const turnId = 'main-diagnostic-turn'
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue
  const message = JSON.parse(line)
  if (message.method === 'initialize') emit({ id: message.id, result: { userAgent: 'main-local-diagnostic-only' } })
  else if (message.method === 'thread/start') {
    emit({ id: message.id, result: {
      thread: { id: threadId }, cwd: message.params.cwd,
      approvalPolicy: message.params.approvalPolicy, model: 'fixture-only',
      sandbox: { type: 'workspaceWrite', networkAccess: false, excludeSlashTmp: true,
        excludeTmpdirEnvVar: true, writableRoots: [message.params.cwd] },
    } })
  } else if (message.method === 'turn/start') {
    emit({ id: message.id, result: { turn: { id: turnId } } })
    emit({ id: 42, method: 'item/commandExecution/requestApproval',
      params: { threadId, turnId, itemId: 'main-diagnostic-item', reason: 'Controlled local fixture approval' } })
  } else if (message.method === 'turn/interrupt') {
    emit({ id: message.id, result: {} })
    emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } })
  } else if (message.method === undefined && message.id === 42) {
    emit({ method: 'serverRequest/resolved', params: { threadId, requestId: 42 } })
    emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } })
  } else if (message.id !== undefined) throw new Error(`Unsupported diagnostic method: ${message.method}`)
}
