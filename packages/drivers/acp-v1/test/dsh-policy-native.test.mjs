import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { apply, createDshWorkspaceGuard, DSH_PRODUCT_POLICY_SERVICE } from '../native-policies/dsh-product-policy.mjs'

// Opt-in exact installed-module consumer. It imports modules only: no CLI, native session, model,
// credentials, service or signals. A missing installation is NOT_TESTED, never a passing native test.
const modules = process.env.PA_DSH_POLICY_MODULE_ROOT
test('installed DSH ToolRuntime and sandboxed filesystem enforce the product guard after approval', { skip: !modules }, async () => {
  const load = name => import(pathToFileURL(join(modules, name, 'lib/index.js')).href)
  const [{ Context }, { ToolRuntime }, { SandboxedFileSystem }, toolFs] = await Promise.all([
    load('cordis'), load('dsh-tools'), load('dsh-fs-sandbox'), load('dsh-tool-fs'),
  ])
  const root = await mkdtemp(join(tmpdir(), 'pa-dsh-policy-native-')), workspace = join(root, 'workspace'), outside = join(root, 'outside')
  await mkdir(workspace); await mkdir(outside); await mkdir(join(workspace, '.git'))
  await writeFile(join(outside, 'secret.txt'), 'controlled external content')
  await symlink(outside, join(workspace, 'alias'))
  await symlink(join(workspace, '.git'), join(workspace, 'git-alias'))
  const ctx = new Context()
  let approvals = 0, unknownBodyCalls = 0, standingMode = 'read-only'
  const policy = { defaultMode: 'read-only', resolve({ session } = {}) { return { mode: standingMode, workspaceRoot: session?.header?.cwd ?? workspace } } }
  ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 1 } })
  ctx.provide('sandboxPolicy', policy)
  ctx.provide('workingDirectory', { async ensure(agent) { return agent.session.header.cwd } })
  ctx.provide('approval', { async request() { approvals++; return 'allowed-once' } })
  const tools = new ToolRuntime(ctx, { mode: 'native' })
  new SandboxedFileSystem(ctx, { cwd: workspace, diffBasisMaxBytes: 1024 * 1024 })
  toolFs.apply(ctx, { read: true, write: true, edit: true, readImage: false,
    readLimit: 2000, readMaxLineLength: 10000, readMaxBytes: 1024 * 1024, readStreamMinSize: 1024 * 1024 })
  tools.register({ name: 'bash', description: 'controlled forbidden body', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { unknownBodyCalls++; return 'forbidden' } })
  const config = { protocol: 'personal-agent-dsh-workspace-policy/1', workspacePath: workspace,
    scope: { projectId: 'controlled-project', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }
  const agent = { session: { header: { id: 'controlled-session', cwd: workspace } } }
  const run = (name, args, caller = agent) => tools.execute({ name, arguments: args, callId: `controlled-${name}-${Math.random().toString(16).slice(2)}`,
    agent: caller, signal: new AbortController().signal })
  try {
    apply(ctx, config)
    assert.ok(ctx.get(DSH_PRODUCT_POLICY_SERVICE))
    const allowed = await run('write', { file_path: 'allowed.txt', content: 'allowed native write', sandbox_permissions: 'workspace-write', justification: 'Write the authorized controlled fixture' })
    assert.equal(allowed.isError, false, JSON.stringify(allowed))
    assert.equal(await readFile(join(workspace, 'allowed.txt'), 'utf8'), 'allowed native write')
    assert.equal(approvals, 1)
    const read = await run('read', { file_path: 'allowed.txt' }); assert.equal(read.isError, false)
    const changed = await run('edit', { file_path: 'allowed.txt', old_string: 'allowed native', new_string: 'edited native',
      sandbox_permissions: 'workspace-write', justification: 'Edit the authorized controlled fixture' })
    assert.equal(changed.isError, false, JSON.stringify(changed))
    assert.equal(await readFile(join(workspace, 'allowed.txt'), 'utf8'), 'edited native write')
    // An earlier permissive pre-execute decision or approval cannot bypass the monotonic guard.
    const off = ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'controlled approval before guard' }))
    for (const [name, args] of [
      ['write', { file_path: join(outside, 'blocked.txt'), content: 'forbidden' }],
      ['write', { file_path: '.git/config', content: 'forbidden' }],
      ['write', { file_path: 'git-alias/config', content: 'forbidden' }],
      ['read', { file_path: 'alias/secret.txt' }],
      ['read', { file_path: '../outside/secret.txt' }],
      ['write', { file_path: 'allowed.txt', content: 'forbidden', sandbox_permissions: 'danger-full-access', justification: 'Controlled refusal' }],
      ['bash', {}],
    ]) {
      const result = await run(name, args)
      assert.equal(result.isError, true, `${name} must be refused`)
      assert.match(JSON.stringify(result), /personal-agent-policy:/)
    }
    off()
    assert.equal(unknownBodyCalls, 0)
    assert.equal(await readFile(join(workspace, 'allowed.txt'), 'utf8'), 'edited native write')
    await assert.rejects(readFile(join(workspace, '.git/config')))
    await assert.rejects(readFile(join(outside, 'blocked.txt')))
    const foreign = await run('read', { file_path: 'secret.txt' }, { session: { header: { cwd: outside } } })
    assert.equal(foreign.isError, true)
    standingMode = 'danger-full-access'
    const drift = await run('read', { file_path: 'allowed.txt' })
    assert.equal(drift.isError, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('guard activation rejects expanded scope and unsandboxed hosts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pa-dsh-policy-config-'))
  const config = { protocol: 'personal-agent-dsh-workspace-policy/1', workspacePath: root,
    scope: { projectId: 'p', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }
  try {
    assert.throws(() => createDshWorkspaceGuard({ ...config, scope: { ...config.scope, externalActions: ['network'] } }, () => null))
    assert.throws(() => apply({ tools: { guard() {} }, fs: {}, sandboxPolicy: {} }, config))
  } finally { await rm(root, { recursive: true, force: true }) }
})
