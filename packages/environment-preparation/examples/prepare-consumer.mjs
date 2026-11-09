#!/usr/bin/env node
/** Prepare sample: caller generates authorityRoot and stores the serializable ref. */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { prepareEnvironment } from '../src/index.ts'

const { values } = parseArgs({ options: {
  project: { type: 'string' }, workspace: { type: 'string' }, authority: { type: 'string' },
  store: { type: 'string' }, out: { type: 'string' }, request: { type: 'string' },
} })
if (!values.project || !values.workspace || !values.authority || !values.store || !values.out)
  throw new Error('--project --workspace --authority --store --out are required')
const result = await prepareEnvironment({
  projectPath: values.project, workspacePath: values.workspace, authorityRoot: values.authority,
  storeDir: values.store, requestId: values.request ?? 'prepare-consumer', policy: 'offline_install',
  signal: new AbortController().signal,
})
if (result.status !== 'ready' || !result.environmentRef) {
  console.error(JSON.stringify({ status: result.status, code: result.code, message: result.message }, null, 2))
  process.exitCode = 1
} else {
  writeFileSync(values.out, JSON.stringify(result.environmentRef, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ status: 'ready', fingerprint: result.fingerprint, receiptId: result.environmentRef.receiptId, ownedPaths: result.ownedPaths }, null, 2))
}
