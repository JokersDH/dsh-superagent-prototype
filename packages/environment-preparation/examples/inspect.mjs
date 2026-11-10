#!/usr/bin/env node
/** Read-only inspection sample; writes no environment state. */
import { parseArgs } from 'node:util'
import { inspectEnvironment, parseEnvironmentInspection } from '../src/index.ts'

const { values } = parseArgs({ options: {
  project: { type: 'string' }, workspace: { type: 'string' }, policy: { type: 'string' }, store: { type: 'string' },
} })
if (!values.project || !values.workspace) throw new Error('--project and --workspace are required')
const result = parseEnvironmentInspection(await inspectEnvironment({
  projectPath: values.project, workspacePath: values.workspace,
  ...(values.policy === 'offline_install' || values.policy === 'existing_only' ? { policy: values.policy } : {}),
  ...(values.store ? { storeDir: values.store } : {}),
}))
console.log(JSON.stringify(result, null, 2))
