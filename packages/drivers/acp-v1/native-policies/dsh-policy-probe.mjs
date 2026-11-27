/** Actual installed-module consumer. No CLI, agent session, provider request or process signal. */
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { apply } from './dsh-product-policy.mjs'

export async function probeDshWorkspacePolicy({ moduleRoot, scratchParent }) {
  const load = name => import(pathToFileURL(join(moduleRoot, name, 'lib/index.js')).href)
  const [{ Context }, { ToolRuntime }, { SandboxedFileSystem }, toolFs] = await Promise.all([
    load('cordis'), load('dsh-tools'), load('dsh-fs-sandbox'), load('dsh-tool-fs'),
  ])
  const root = await mkdtemp(join(scratchParent, 'policy-probe-')), workspace = join(root, 'workspace'), outside = join(root, 'outside')
  await mkdir(workspace); await mkdir(outside); await mkdir(join(workspace, '.git'))
  await writeFile(join(outside, 'external.txt'), 'controlled external material')
  await symlink(outside, join(workspace, 'outside-alias'))
  await symlink(join(workspace, '.git'), join(workspace, 'git-alias'))
  let unknownBodies = 0, approvals = 0, mode = 'read-only', call = 0
  const observations = []
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 1 } })
  ctx.provide('sandboxPolicy', { defaultMode: 'read-only', resolve({ session } = {}) { return { mode, workspaceRoot: session?.header?.cwd ?? workspace } } })
  ctx.provide('workingDirectory', { async ensure(agent) { return agent.session.header.cwd } })
  ctx.provide('approval', { async request() { approvals++; return 'allowed-once' } })
  const tools = new ToolRuntime(ctx, { mode: 'native' })
  new SandboxedFileSystem(ctx, { cwd: workspace, diffBasisMaxBytes: 1024 * 1024 })
  toolFs.apply(ctx, { read: true, write: true, edit: true, readImage: false,
    readLimit: 2000, readMaxLineLength: 10000, readMaxBytes: 1024 * 1024, readStreamMinSize: 1024 * 1024 })
  tools.register({ name: 'forbidden-tool', description: 'controlled nonfilesystem body', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { unknownBodies++; return 'forbidden' } })
  const agent = { session: { header: { id: 'controlled-module-consumer', cwd: workspace } } }
  const invoke = (name, args) => tools.execute({ name, arguments: args, callId: `policy-${++call}`, agent, signal: new AbortController().signal })
  const observe = (name, accepted) => { if (!accepted) throw new Error(`DSH policy consumer refused observation: ${name}`); observations.push(name) }
  try {
    apply(ctx, { protocol: 'personal-agent-dsh-workspace-policy/1', workspacePath: workspace,
      scope: { projectId: 'native-dsh-workspace', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } })
    const write = await invoke('write', { file_path: 'allowed.txt', content: 'controlled original write', sandbox_permissions: 'workspace-write', justification: 'Write authorized probe file' })
    observe('permitted_atomic_write', write.isError === false && await readFile(join(workspace, 'allowed.txt'), 'utf8') === 'controlled original write')
    observe('original_native_approval', approvals === 1)
    observe('permitted_read', (await invoke('read', { file_path: 'allowed.txt' })).isError === false)
    const edit = await invoke('edit', { file_path: 'allowed.txt', old_string: 'original', new_string: 'edited', sandbox_permissions: 'workspace-write', justification: 'Edit authorized probe file' })
    observe('permitted_atomic_edit', edit.isError === false && await readFile(join(workspace, 'allowed.txt'), 'utf8') === 'controlled edited write')
    const off = ctx.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'controlled earlier approval' }))
    for (const [label, name, args] of [
      ['outside_write_denied', 'write', { file_path: join(outside, 'blocked.txt'), content: 'blocked' }],
      ['git_write_denied', 'write', { file_path: '.git/config', content: 'blocked' }],
      ['git_alias_denied', 'write', { file_path: 'git-alias/config', content: 'blocked' }],
      ['outside_alias_read_denied', 'read', { file_path: 'outside-alias/external.txt' }],
      ['parent_traversal_denied', 'read', { file_path: '../outside/external.txt' }],
      ['full_escalation_denied', 'write', { file_path: 'allowed.txt', content: 'blocked', sandbox_permissions: 'danger-full-access', justification: 'Controlled refusal' }],
      ['unknown_tool_body_denied', 'forbidden-tool', {}],
    ]) {
      const result = await invoke(name, args)
      observe(label, result.isError === true && JSON.stringify(result).includes('personal-agent-policy:'))
    }
    off()
    observe('unknown_body_never_started', unknownBodies === 0)
    mode = 'danger-full-access'
    observe('standing_policy_drift_denied', (await invoke('read', { file_path: 'allowed.txt' })).isError === true)
    return { protocol: 'dsh-native-policy-consumer/1', observations,
      recipeDigest: createHash('sha256').update(JSON.stringify(observations)).digest('hex') }
  } finally { await rm(root, { recursive: true, force: true }) }
}

/** Exercise the actual native credential and model-resolution interfaces, never a completion. */
export async function probeDshModelConfiguration({ moduleRoot, home, model }) {
  const load = name => import(pathToFileURL(join(moduleRoot, name, 'lib/index.js')).href)
  const [{ Context, Service }, { LocalCredentialProvider }, pi, { createLaunchEnvironmentSnapshot }] = await Promise.all([
    load('cordis'), load('dsh-credentials-local'), load('dsh-llm-pi-ai'), load('dsh-launch-environment'),
  ])
  const ctx = new Context(), releases = []
  // Exactly the effective empty ambient credential layer after the private preload sanitation.
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  const credentials = new LocalCredentialProvider(ctx, { path: join(home, '.credentials.yaml'), dshHome: home, watch: false, debounceMs: 100 })
  let adapter, discoveryInvoked = 0, resolvedPrivateReference = false
  const originalResolve = credentials.resolve.bind(credentials)
  credentials.resolve = async ref => {
    const value = await originalResolve(ref)
    if (ref === model.credentialRef && value?.source === 'file' && typeof value.value === 'string' && value.value.length > 0)
      resolvedPrivateReference = true
    return value
  }
  ctx.provide('llm', {
    registerConfigurableProviders() { return { replace() {} } },
    registerModelDiscovery(_namespace, _callback) { /* Registration only; discovery must never run. */ },
    registerAdapter(_routes, value) { adapter = value; return { replace() {} } },
  })
  try {
    for await (const release of credentials[Service.init]()) releases.push(release)
    const configured = pi.Config({ providers: { 'personal-agent-model': {
      api: model.api, baseURL: model.baseURL, apiKeyEnv: model.credentialRef,
      models: [{ id: model.id, name: model.id, input: ['text'], contextWindow: 131072, maxTokens: 4096, reasoningEfforts: false }],
    } } })
    pi.apply(ctx, configured)
    if (!adapter) throw new Error('Native pi-ai adapter was not registered')
    const descriptor = await adapter.resolveModel('personal-agent-model', model.id)
    const models = await adapter.listModels('personal-agent-model')
    if (descriptor.id !== model.id || descriptor.provider !== 'personal-agent-model' ||
        model.configured !== resolvedPrivateReference || (model.configured ? !models.some(item => item.id === model.id) : models.length !== 0))
      throw new Error('Private native model reference did not resolve through the reviewed route')
    return { protocol: 'dsh-model-resolution-consumer/1', modelId: model.id, credentialReference: model.credentialRef,
      configured: model.configured, privateReferenceResolved: resolvedPrivateReference, resolvedModel: true,
      completionRequests: 0, discoveryInvoked }
  } finally { for (const release of releases.reverse()) await release() }
}
