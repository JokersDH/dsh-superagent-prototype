/** Private native configuration, not an ACP extension or an alternate task/admission ledger. */
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { AgentProfileSchema, IdSchema, JsonSchema } from '../../../contracts/src/schemas.ts'
import { canonicalDigest } from '../../../contracts/src/canonical.ts'
import { probeDshWorkspacePolicy, probeDshModelConfiguration } from './dsh-policy-probe.mjs'

export const DSH_POLICY_PROTOCOL = 'personal-agent-dsh-installation/1'
export const DSH_POLICY_REVISION = 'dsh-workspace-enforced-v1'
export const DSH_NATIVE_VERSION = '0.2.1-rc.2'
export const DSH_NATIVE_SCOPE = Object.freeze({ projectId: 'native-dsh-workspace', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] })
const here = dirname(fileURLToPath(import.meta.url))
export const DSH_PRELOAD = join(here, 'dsh-policy-preload.mjs')
const plugin = join(here, 'dsh-product-policy.mjs')
const credentialRef = 'PERSONAL_AGENT_DSH_MODEL_KEY'
const NATIVE_ROOT_CONFIG = '# dsh profile root — an empty entry list. The tree is composed as patches:\n# each bundle in package.json\'s dsh.profile.bundles, then cordis.patch.yml, then any\n# --patch overlays. Edit cordis.patch.yml, not this file.\n[]\n'
const OBSERVATIONS = ['permitted_atomic_write', 'original_native_approval', 'permitted_read', 'permitted_atomic_edit',
  'outside_write_denied', 'git_write_denied', 'git_alias_denied', 'outside_alias_read_denied', 'parent_traversal_denied',
  'full_escalation_denied', 'unknown_tool_body_denied', 'unknown_body_never_started', 'standing_policy_drift_denied']
const sensitive = /(?:api.?key|secret|token|password)/i
const modelSchema = z.strictObject({ id: z.string().trim().min(1).max(160),
  api: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']).default('openai-completions'),
  baseURL: z.url().refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search }),
  apiKey: z.string().min(1).max(8192).optional() })
const absolutePath = z.string().min(1).max(4096).refine(isAbsolute)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const scalar = z.number().finite().nonnegative()
const directoryIdentity = z.strictObject({ dev: scalar, ino: scalar, mode: scalar, uid: scalar })
const fileIdentity = directoryIdentity.extend({ size: scalar, mtimeMs: scalar, ctimeMs: scalar })
const configFile = z.strictObject({ path: absolutePath, sha256: digest })
const source = configFile.extend({ identity: fileIdentity })
const planSchema = z.strictObject({ protocol: z.literal(DSH_POLICY_PROTOCOL), profileId: IdSchema, revision: z.number().int().positive().safe(),
  connectionRoot: absolutePath, rootIdentity: directoryIdentity, nodeExecutable: absolutePath, dshEntry: absolutePath, moduleRoot: absolutePath,
  home: absolutePath, activations: absolutePath, overlayPath: absolutePath,
  model: modelSchema.omit({ apiKey: true }).extend({ configured: z.boolean(), credentialRef: z.literal(credentialRef) }),
  consumer: z.strictObject({ protocol: z.literal('dsh-native-policy-consumer/1'), observations: z.array(z.string()).length(OBSERVATIONS.length), recipeDigest: digest }),
  modelConsumer: z.strictObject({ protocol: z.literal('dsh-model-resolution-consumer/1'), modelId: z.string(), credentialReference: z.literal(credentialRef),
    configured: z.boolean(), privateReferenceResolved: z.boolean(), resolvedModel: z.literal(true), completionRequests: z.literal(0), discoveryInvoked: z.literal(0) }),
  sources: z.array(source).min(1).max(1024), configuration: z.array(configFile).length(4),
  credential: z.strictObject({ path: absolutePath, identity: fileIdentity }),
})

function fail(reason) { throw new Error(`dsh-policy:${reason}`) }
function identity(path, privateOnly = false) {
  const value = lstatSync(path)
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1) fail('unsafe_file')
  if (privateOnly && ((value.mode & 0o077) !== 0 || (process.getuid && value.uid !== process.getuid()))) fail('private_file_identity')
  return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, mode: value.mode, uid: value.uid }
}
function privateDirectory(path) {
  const value = lstatSync(path)
  if (!value.isDirectory() || value.isSymbolicLink() || (value.mode & 0o077) !== 0 || (process.getuid && value.uid !== process.getuid())) fail('private_directory_identity')
  return { dev: value.dev, ino: value.ino, mode: value.mode, uid: value.uid }
}
const fileCache = new Map()
function sourceFile(path) {
  const observed = identity(path), previous = fileCache.get(path)
  if (previous && canonicalDigest(previous.identity) === canonicalDigest(observed)) return previous
  if (observed.size > 256 * 1024 * 1024) fail('source_size')
  const value = { path, identity: observed, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
  fileCache.set(path, value); return value
}
function readPrivateJson(path) {
  const observed = identity(path, true)
  if (observed.size > 1024 * 1024) fail('private_document_size')
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { fail('invalid_private_json') }
}
function writePrivate(path, value) { writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }) }
function sourceClosure(nodeExecutable, dshEntry, moduleRoot) {
  const root = dirname(dirname(dshEntry)), manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== DSH_NATIVE_VERSION) fail('native_version_not_reviewed')
  const files = [nodeExecutable, join(root, 'package.json'), ...readdirSync(join(root, 'lib')).filter(name => name.endsWith('.js')).sort().map(name => join(root, 'lib', name)),
    plugin, DSH_PRELOAD, fileURLToPath(import.meta.url), join(here, 'dsh-policy-probe.mjs'), join(here, 'dsh-policy-host.mjs')]
  for (const name of ['cordis', 'dsh-tools', 'dsh-scope', 'dsh-util-values', 'dsh-fs', 'dsh-fs-local', 'dsh-fs-sandbox', 'dsh-tool-fs',
    'dsh-sandbox', 'dsh-sandbox-policy', 'dsh-app-boot', 'dsh-acp', 'dsh-acp-app', 'dsh-base', 'dsh-llm-pi-ai', 'dsh-credentials', 'dsh-credentials-local', 'dsh-launch-environment']) {
    const directory = join(moduleRoot, name)
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== `@deepseek-ai/${name}` || (name !== 'cordis' && manifest.version !== DSH_NATIVE_VERSION)) fail('mixed_native_modules')
    files.push(join(directory, 'package.json'))
    if (name !== 'dsh-base') files.push(join(directory, 'lib/index.js'))
    const patch = join(directory, 'cordis.patch.yml')
    if (['dsh-base', 'dsh-acp-app'].includes(name)) files.push(patch)
  }
  return [...new Set(files)].sort().map(sourceFile)
}
function overlayTemplate({ model, credentialsPath, home }) {
  const q = value => JSON.stringify(value)
  return `- id: hmr\n  disabled: true\n- id: plugin-manager\n  disabled: true\n- id: config-editor\n  disabled: true\n- id: settings\n  disabled: true\n- id: credentials\n  config:\n    path: ${q(credentialsPath)}\n    dshHome: ${q(home)}\n    watch: false\n    debounceMs: 100\n- id: tools\n  config:\n    mode: native\n- id: sandbox-policy\n  config:\n    mode: read-only\n    workspaceRoot: !!js process.cwd()\n- id: tool-fs\n  config:\n    read: true\n    readImage: false\n    write: true\n    edit: true\n- id: agent-default-model\n  config:\n    provider: personal-agent-model\n    model: ${q(model.id)}\n- id: llm-pi-ai\n  config:\n    providers:\n      personal-agent-model:\n        api: ${q(model.api)}\n        baseURL: ${q(model.baseURL)}\n        apiKeyEnv: ${credentialRef}\n        models:\n          - id: ${q(model.id)}\n            name: ${q(model.id)}\n            input: [text]\n            contextWindow: 131072\n            maxTokens: 4096\n            reasoningEfforts: false\n- insert:\n    - id: personal-agent-policy\n      name: ${q(plugin)}\n      inject: [tools, fs, sandboxPolicy]\n      config:\n        protocol: personal-agent-dsh-workspace-policy/1\n        workspacePath: !!js process.cwd()\n        scope:\n          projectId: native-dsh-workspace\n          allowedPaths: ['.']\n          excludedPaths: ['.git']\n          externalActions: []\n        activationFile: !!js process.env.PA_SUPERAGENT_DSH_ACTIVATION_FILE\n        launchNonce: !!js process.env.PA_SUPERAGENT_DSH_NONCE\n- id: acp\n  inject: [acpAppStartup, personalAgentPolicy]\n  config:\n    provider: personal-agent-model\n    model: ${q(model.id)}\n`
}

function profileFor(plan, policyIdentity) {
  const preload = pathToFileURL(DSH_PRELOAD); preload.searchParams.set('manifest', join(plan.connectionRoot, 'installation.json'))
  return AgentProfileSchema.parse({ id: plan.profileId, revision: plan.revision, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0',
    executable: plan.nodeExecutable, argv: ['--import', preload.href, plan.dshEntry, '--profile', 'acp', '--patch', plan.overlayPath],
    expectedVersion: DSH_NATIVE_VERSION, nativeConfigRef: `dsh-policy:${policyIdentity}`, permissionPolicyRevision: DSH_POLICY_REVISION,
    credentialReference: `credential-${plan.profileId}`, requiredFeatures: ['chat.turn', 'approval.request', 'cancel'] })
}
function expectedConfiguration(plan) {
  const profileRoot = join(plan.home, 'profiles/acp')
  return [
    [join(profileRoot, 'package.json'), `${JSON.stringify({ name: 'personal-agent-private-acp', private: true, dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] } } }, null, 2)}\n`],
    [join(profileRoot, 'cordis.patch.yml'), '[]\n'],
    [join(profileRoot, 'cordis.yml'), NATIVE_ROOT_CONFIG],
    [plan.overlayPath, overlayTemplate({ model: plan.model, credentialsPath: plan.credential.path, home: plan.home })],
  ].map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') }))
}
function verifyFixedPaths(plan, manifestPath) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.version !== 'v24.21.0' ||
      plan.nodeExecutable !== realpathSync(process.execPath) || realpathSync(plan.nodeExecutable) !== plan.nodeExecutable ||
      realpathSync(plan.dshEntry) !== plan.dshEntry || plan.dshEntry !== join(dirname(dirname(plan.dshEntry)), 'lib/bin.js') ||
      plan.moduleRoot !== realpathSync(join(dirname(dirname(plan.dshEntry)), 'node_modules/@deepseek-ai')) ||
      plan.connectionRoot !== realpathSync(dirname(manifestPath)) || plan.home !== join(plan.connectionRoot, 'home') ||
      plan.activations !== join(plan.connectionRoot, 'activations') || plan.overlayPath !== join(plan.connectionRoot, 'policy.yml') ||
      plan.credential.path !== join(plan.home, '.credentials.yaml')) fail('installation_paths_changed')
  for (const path of [plan.connectionRoot, plan.home, join(plan.home, 'profiles'), join(plan.home, 'profiles/acp'), plan.activations]) privateDirectory(path)
}
function project(plan, policyIdentity, profile) {
  return { profile, policyIdentity, manifestPath: join(plan.connectionRoot, 'installation.json'), readiness: plan.model.configured ? 'policy_installed' : 'needs_auth',
    diagnostics: plan.model.configured ? ['policy_modules_controlled_verified', 'native_cli_not_verified'] : ['private_model_key_required', 'native_cli_not_verified'] }
}

/**
 * Creates a NEW product-private connection only. The actual module consumer runs without a CLI or
 * native session. No existing home, credentials, native configuration or installation is copied.
 */
export async function installDshAcpPolicy(input) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('native_platform_not_reviewed')
  const profileId = IdSchema.parse(input.profileId), revision = z.number().int().positive().safe().parse(input.revision ?? 1)
  const model = modelSchema.parse(input.model)
  const connectionRoot = join(realpathSync(dirname(resolve(input.connectionRoot))), basename(resolve(input.connectionRoot)))
  if (!isAbsolute(input.connectionRoot)) fail('connection_root_absolute_required')
  privateDirectory(dirname(connectionRoot))
  try { lstatSync(connectionRoot); fail('connection_root_exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const nodeExecutable = realpathSync(input.nodeExecutable), dshEntry = realpathSync(input.dshEntry)
  if (nodeExecutable !== realpathSync(process.execPath) || process.version !== 'v24.21.0') fail('node_runtime_not_reviewed')
  const moduleRoot = realpathSync(input.moduleRoot ?? join(dirname(dirname(dshEntry)), 'node_modules/@deepseek-ai'))
  const sources = sourceClosure(nodeExecutable, dshEntry, moduleRoot)
  mkdirSync(connectionRoot, { mode: 0o700 })
  const home = join(connectionRoot, 'home'), profileRoot = join(home, 'profiles/acp'), activations = join(connectionRoot, 'activations')
  mkdirSync(profileRoot, { recursive: true, mode: 0o700 }); mkdirSync(activations, { mode: 0o700 })
  // Recursive mkdir affects only this newly-owned empty tree. Every private directory stays owner-only.
  for (const path of [home, join(home, 'profiles'), profileRoot, activations]) privateDirectory(path)
  const consumer = await probeDshWorkspacePolicy({ moduleRoot, scratchParent: connectionRoot })
  const credentialsPath = join(home, '.credentials.yaml')
  writePrivate(credentialsPath, { version: 1, refs: model.apiKey ? { [credentialRef]: model.apiKey } : {}, records: {} })
  const nativeModel = { id: model.id, api: model.api, baseURL: model.baseURL, configured: model.apiKey !== undefined, credentialRef }
  const modelConsumer = await probeDshModelConfiguration({ moduleRoot, home, model: nativeModel })
  const profileManifest = join(profileRoot, 'package.json'), profilePatch = join(profileRoot, 'cordis.patch.yml'), rootConfig = join(profileRoot, 'cordis.yml')
  writePrivate(profileManifest, { name: 'personal-agent-private-acp', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] } } })
  writePrivate(profilePatch, '[]\n'); writePrivate(rootConfig, NATIVE_ROOT_CONFIG)
  const overlayPath = join(connectionRoot, 'policy.yml')
  // Last overlay is authoritative. Config selection is native Harness configuration, not private ACP.
  writePrivate(overlayPath, overlayTemplate({ model, credentialsPath, home }))
  const plan = JsonSchema.parse({ protocol: DSH_POLICY_PROTOCOL, profileId, revision, connectionRoot, rootIdentity: privateDirectory(connectionRoot),
    nodeExecutable, dshEntry, moduleRoot, home, activations, overlayPath, model: nativeModel, consumer, modelConsumer,
    sources, configuration: [profileManifest, profilePatch, rootConfig, overlayPath].map(path => { const file = sourceFile(path); return { path: file.path, sha256: file.sha256 } }), credential: { path: credentialsPath, identity: identity(credentialsPath, true) } })
  const policyIdentity = canonicalDigest(plan), profile = profileFor(plan, policyIdentity)
  writePrivate(join(connectionRoot, 'installation.json'), { ...plan, policyIdentity, profile })
  return project(plan, policyIdentity, profile)
}

export function manifestForDshProfile(input) {
  const profile = AgentProfileSchema.parse(input)
  if (profile.driverId !== 'acp-v1' || profile.argv[0] !== '--import' || typeof profile.argv[1] !== 'string') fail('not_managed_dsh_profile')
  const uri = new URL(profile.argv[1])
  if (uri.protocol !== 'file:' || fileURLToPath(uri) !== DSH_PRELOAD || !uri.searchParams.get('manifest')) fail('unregistered_preload')
  const path = uri.searchParams.get('manifest')
  if (!isAbsolute(path)) fail('manifest_absolute_required')
  return path
}

/** Cross-process verification; the original Profile/config identity is the anchor, not a self-label. */
export function verifyDshAcpPolicy(input) {
  const profile = AgentProfileSchema.parse(input), manifestPath = manifestForDshProfile(profile), raw = readPrivateJson(manifestPath)
  let parsed
  try { parsed = planSchema.extend({ profile: AgentProfileSchema, policyIdentity: digest }).parse(raw) } catch { fail('invalid_installation_schema') }
  const { profile: recordedProfile, policyIdentity, ...plan } = parsed
  verifyFixedPaths(plan, manifestPath)
  if (plan.protocol !== DSH_POLICY_PROTOCOL || plan.connectionRoot !== dirname(manifestPath) || canonicalDigest(plan) !== policyIdentity ||
      canonicalDigest(profile) !== canonicalDigest(recordedProfile) || canonicalDigest(profileFor(plan, policyIdentity)) !== canonicalDigest(profile)) fail('installation_binding_changed')
  if (canonicalDigest(privateDirectory(plan.connectionRoot)) !== canonicalDigest(plan.rootIdentity)) fail('connection_root_changed')
  const expectedSources = sourceClosure(plan.nodeExecutable, plan.dshEntry, plan.moduleRoot)
  if (canonicalDigest(expectedSources) !== canonicalDigest(plan.sources)) fail('required_source_closure_changed')
  const configuration = expectedConfiguration(plan)
  if (canonicalDigest(configuration) !== canonicalDigest(plan.configuration)) fail('required_configuration_template_changed')
  for (const file of configuration) {
    identity(file.path, true)
    if (sourceFile(file.path).sha256 !== file.sha256) fail('source_or_configuration_changed')
  }
  if (canonicalDigest(identity(plan.credential.path, true)) !== canonicalDigest(plan.credential.identity)) fail('credential_reference_changed')
  const credential = readPrivateJson(plan.credential.path)
  if (credential.version !== 1 || typeof credential.refs !== 'object' || credential.refs === null || Array.isArray(credential.refs) ||
      Object.keys(credential.refs).some(key => key !== credentialRef) ||
      plan.model.configured !== (typeof credential.refs[credentialRef] === 'string' && credential.refs[credentialRef].length > 0)) fail('private_credential_reference_invalid')
  if (plan.modelConsumer.modelId !== plan.model.id || plan.modelConsumer.configured !== plan.model.configured ||
      plan.modelConsumer.privateReferenceResolved !== plan.model.configured) fail('model_reference_consumer_invalid')
  if (canonicalDigest(plan.consumer.observations) !== canonicalDigest(OBSERVATIONS) ||
      plan.consumer.recipeDigest !== createHash('sha256').update(JSON.stringify(plan.consumer.observations)).digest('hex')) fail('consumer_record_invalid')
  // Consumer output is necessary context, not independent permission. The exact trusted source,
  // installation, Profile and native activation must still be checked by the original policy host.
  return { ...project(plan, policyIdentity, profile), plan }
}

export function inspectDshAcpProfile(profile) {
  const verified = verifyDshAcpPolicy(profile)
  return { ...verified, nativeVersion: DSH_NATIVE_VERSION, executableDigest: verified.plan.sources.find(file => file.path === profile.executable).sha256,
    configFingerprint: verified.policyIdentity, credentialReference: profile.credentialReference }
}

/** Removes ambient credential values in the NATIVE CHILD ONLY; no caller environment is modified. */
export function isolateDshChildEnvironment(plan) {
  for (const key of Object.keys(process.env)) if (sensitive.test(key)) delete process.env[key]
  process.env.DSH_HOME = plan.home
  process.env.DSH_TELEMETRY_DISABLED = '1'
  delete process.env.DSH_PERMISSION_MODE
}

export function readDshPrivateJson(path) { return readPrivateJson(path) }
