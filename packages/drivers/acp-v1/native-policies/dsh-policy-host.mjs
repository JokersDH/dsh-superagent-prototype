/** Trusted policy consumer for one ORIGINAL owned DSH process. No private ACP methods or grants. */
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonSchema, PreparedExecutionPolicySchema } from '../../../contracts/src/schemas.ts'
import { canonicalDigest } from '../../../contracts/src/canonical.ts'
import { attemptIdentity } from '../../../driver-kit/src/attempt-io.ts'
import { DSH_NATIVE_SCOPE, DSH_POLICY_REVISION, readDshPrivateJson, verifyDshAcpPolicy } from './dsh-policy-installation.mjs'

const pluginPath = fileURLToPath(new URL('./dsh-product-policy.mjs', import.meta.url))
function fail(reason) { throw new Error(`dsh-policy:${reason}`) }
function allowedScope(scope) {
  return scope.allowedPaths.length === 1 && scope.allowedPaths[0] === '.' && scope.excludedPaths.length === 1 &&
    scope.excludedPaths[0].replace(/\/$/, '') === '.git' && scope.externalActions.length === 0 && scope.expiresAt === undefined
}
function workspaceIdentity(path) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('workspace_identity')
  return { path: realpathSync(path), dev: stat.dev, ino: stat.ino, uid: stat.uid }
}

/** Factory receives the original ProcessHost itself, never an HTTP/native-provided process label. */
export function createDshAcpPolicyHost({ runtime }) {
  let prepared
  const verifyInput = input => {
    if (!allowedScope(input.settings.scope)) fail('scope_not_supported')
    if (input.settings.modeId !== undefined || (input.settings.configSelections?.length ?? 0) > 0) fail('profile_session_config_override_not_supported')
    const installed = verifyDshAcpPolicy(input.spec.profile)
    if (installed.readiness !== 'policy_installed') fail('private_model_key_required')
    return installed
  }
  const evidence = input => {
    const installed = verifyInput(input)
    if (!input.resourceRef || typeof runtime.originalIdentity !== 'function') fail('original_resource_required')
    const original = runtime.originalIdentity(input.resourceRef)
    if (!original || original.startMarker === null || original.executable !== input.spec.profile.executable ||
        canonicalDigest([...original.argv]) !== canonicalDigest([...input.spec.profile.argv])) fail('original_process_binding')
    if (input.initialized.protocolVersion !== 1 || input.initialized.agentInfo?.name !== 'deepseek-harness-acp' ||
        input.initialized.agentInfo?.version !== '0.0.1') fail('reviewed_agent_implementation_required')
    const workspace = workspaceIdentity(input.settings.workspacePath)
    const launch = readDshPrivateJson(join(installed.plan.activations, `launch-${original.pid}.json`))
    if (launch.protocol !== 'personal-agent-dsh-launch/1' || launch.pid !== original.pid || launch.policyIdentity !== installed.policyIdentity ||
        launch.createdAt < original.spawnedAt || realpathSync(launch.workspacePath) !== workspace.path ||
        dirname(launch.activationFile) !== installed.plan.activations ||
        launch.activationFile !== join(installed.plan.activations, `${original.pid}-${launch.nonce}.json`)) fail('launch_witness_binding')
    const activation = readDshPrivateJson(launch.activationFile)
    const expectedPluginDigest = installed.plan.sources.find(file => file.path === pluginPath)?.sha256
    if (typeof expectedPluginDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedPluginDigest)) fail('required_plugin_source_missing')
    if (activation.protocol !== 'personal-agent-dsh-activation/1' || activation.pid !== original.pid || activation.nonce !== launch.nonce ||
        activation.createdAt < launch.createdAt || activation.workspacePath !== workspace.path ||
        activation.scopeDigest !== canonicalDigest(DSH_NATIVE_SCOPE) ||
        activation.pluginDigest !== expectedPluginDigest) fail('native_guard_activation_binding')
    return JsonSchema.parse({ protocol: 'dsh-native-policy-applied/1', policyIdentity: installed.policyIdentity,
      originalResourceRef: input.resourceRef, originalProcess: original, workspace, scope: input.settings.scope,
      nativeScopePattern: DSH_NATIVE_SCOPE, nativeSessionId: input.session.sessionId, activation,
      policyConsumer: installed.plan.consumer, sourceEvidence: installed.plan.sources.map(file => ({ path: file.path, sha256: file.sha256 })) })
  }
  return {
    async beforeSpawn(input) { verifyInput(input); workspaceIdentity(input.settings.workspacePath) },
    async prepare(input) {
      if (input.spec.profile.permissionPolicyRevision !== DSH_POLICY_REVISION) fail('policy_revision')
      const applied = evidence(input), currentFingerprint = canonicalDigest(applied)
      const evidenceRef = await input.io.payloads.store(applied, 'critical')
      const policy = PreparedExecutionPolicySchema.parse({ ...attemptIdentity(input.spec), requestedPolicyRevision: input.spec.profile.permissionPolicyRevision,
        nativeAppliedSettingsRef: evidenceRef, effectiveConfigFingerprint: currentFingerprint, enforcement: 'enforced', verification: 'passed', evidenceRef })
      prepared = { attempt: attemptIdentity(input.spec), fingerprint: currentFingerprint }
      return { policy, currentFingerprint }
    },
    async currentFingerprint(input) {
      if (!prepared || canonicalDigest(prepared.attempt) !== canonicalDigest(attemptIdentity(input.spec))) fail('original_policy_not_prepared')
      const observed = canonicalDigest(evidence(input))
      if (observed !== prepared.fingerprint) fail('native_policy_changed')
      return observed
    },
  }
}
