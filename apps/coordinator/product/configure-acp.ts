import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { configureAcpConnection } from './acp-connections.ts'

/** Operator entry. Model JSON arrives on stdin so keys never enter argv or shell history. No task. */
const { values } = parseArgs({ options: {
  state: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, 'dsh-entry': { type: 'string' },
} })
try {
  if (!values.state || !values.id || !values.name || !values['dsh-entry'] || process.stdin.isTTY)
    throw new Error('acp-connection:arguments_required')
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > 16384) throw new Error('acp-connection:model_input_limit')
    chunks.push(Buffer.from(chunk))
  }
  const saved = await configureAcpConnection({ stateRoot: resolve(values.state), profileId: values.id,
    displayName: values.name, dshEntry: resolve(values['dsh-entry']), model: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
  console.log(JSON.stringify({ protocol: 'acp-connection-configured/1', profileId: saved.id, displayName: saved.displayName,
    readiness: saved.readiness, effective: 'next_normal_start', executionAuthorized: false, modelTurns: 0 }, null, 2))
} catch (error) {
  const message = error instanceof Error ? error.message : ''
  const code = /^(?:dsh-policy|acp-connection):[a-z0-9_]+$/.test(message) ? message : 'acp-connection:configuration_failed'
  console.error(JSON.stringify({ status: 'NOT_CONFIGURED', code, message: '连接配置未完成；现有配置和私有材料已保留。', modelTurns: 0 }))
  process.exitCode = 1
}
