import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ExecutionProfileView } from '@personal-agent/contracts'
import { JsonSchema } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { ProductStore } from '@personal-agent/storage'
import { AcpV1SettingsSchema } from '../../../packages/drivers/acp-v1/src/index.ts'
import { listAcpConnections } from './acp-connections.ts'
import { acpInspectionPolicyDigest, inspectAcpConnection } from './acp-inspection.ts'
import { executionProfileView } from './execution-profile-view.ts'
import { readExecutorTrialAdmission } from './executor-trial.ts'
import { NativeProjectRegistry } from './project-registry.ts'
import { verifyRecoveryTargetStartup } from './recovery-target-authorization.ts'
import type { NativeExecutorInspection } from './native-inspection.ts'
import type { ProductExecutorConfiguration } from './native-config.ts'

const digest = (value: unknown) => canonicalDigest(JsonSchema.parse(value))
/** Same normal product, same original consent receipts. Configuration files alone never dispatch. */
export async function prepareAcpStartup(stateRoot: string, store: ProductStore,
  principal: { userId: string; authorityRef: string }, options: {
    inspect?: (profileId: string) => Promise<NativeExecutorInspection>
  } = {}): Promise<{ executors: readonly ProductExecutorConfiguration[]; inspectedProfiles: readonly ExecutionProfileView[] }> {
  const executors: ProductExecutorConfiguration[] = [], inspectedProfiles: ExecutionProfileView[] = []
  let connections: ReturnType<typeof listAcpConnections>
  try { connections = listAcpConnections(stateRoot) }
  catch { return { executors, inspectedProfiles: [{ id: 'profile-acp-configuration-unavailable', revision: 1, driverId: 'acp-v1',
    displayName: 'ACP 连接配置待核对', kind: 'native', readiness: 'needs_setup', dispatchAllowed: false, blockedReason: 'unsupported_capability' }] } }
  for (const saved of connections) {
    const label = saved.connection ? `${saved.displayName} · ${saved.connection.modelId}`.slice(0, 160) : saved.displayName
    const blocked = (): ExecutionProfileView => ({ id: saved.id, revision: saved.connection?.profile.revision ?? 1,
      driverId: 'acp-v1', displayName: label, kind: 'native', readiness: saved.readiness === 'needs_auth' ? 'needs_auth' : 'needs_setup',
      dispatchAllowed: false, blockedReason: saved.readiness === 'needs_auth' ? 'auth_required' : 'unsupported_capability' })
    if (!saved.connection || saved.readiness !== 'policy_installed') { inspectedProfiles.push(blocked()); continue }
    try {
      const inspection = await (options.inspect ?? (id => inspectAcpConnection(stateRoot, id)))(saved.id)
      if (digest(inspection.profile) !== digest(saved.connection.profile)) throw new Error('ACP profile changed during inspection')
      const admission = readExecutorTrialAdmission(store, inspection, principal)
      const current = () => {
        try {
          const active = listAcpConnections(stateRoot).find(entry => entry.id === saved.id)
          if (!active?.connection || active.readiness !== 'policy_installed' ||
              digest(active.connection.profile) !== digest(inspection.profile) ||
              acpInspectionPolicyDigest(inspection.profile) !== inspection.policyDigest ||
              !readExecutorTrialAdmission(store, inspection, principal)) return false
          if (existsSync(join(stateRoot, 'recovery-target.json'))) verifyRecoveryTargetStartup(stateRoot, principal, inspection.profile)
          return true
        } catch { return false }
      }
      if (!admission || !current()) {
        inspectedProfiles.push(executionProfileView({ profile: inspection.profile, displayName: label,
          verdict: inspection.verdict, operations: inspection.operations }))
        continue
      }
      const operations = inspection.operations.map(item => ({ ...item,
        enabled: item.supported === true && ['controlled', 'native'].includes(item.validation) }))
      const view = executionProfileView({ profile: inspection.profile, displayName: label, verdict: inspection.verdict, operations, admission })
      if (!view.dispatchAllowed) { inspectedProfiles.push(view); continue }
      const registry = new NativeProjectRegistry(stateRoot)
      executors.push({ profile: inspection.profile, profileView: view, admissionCurrent: current, policyIdentity: inspection.policyDigest,
        projects: registry.list().map(project => ({ id: project.id, path: project.path, check: registry.check(project),
          ...(project.environment ? { environment: registry.environment(project)! } : {}) })),
        settings: ({ workspacePath, scope }) => JsonSchema.parse(AcpV1SettingsSchema.parse({ kind: 'acp-v1-settings/1', workspacePath, scope, timeoutMs: 600000 })),
      })
    } catch { inspectedProfiles.push(blocked()) }
  }
  return { executors, inspectedProfiles }
}
