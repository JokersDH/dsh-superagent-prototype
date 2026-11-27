/**
 * Native DSH tool policy for one frozen workspace. This is a Cordis plugin, not an ACP extension.
 * It uses DSH's monotonic synchronous guard after pre-execute/approval and before the tool body.
 * The caller must pin the actual native module/overlay/plugin source identities before adoption.
 * The service exported here is activation metadata, never an execution-admission or PASS record.
 */
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { ScopeSchema } from '../../../contracts/src/schemas.ts'
import { canonicalDigest } from '../../../contracts/src/canonical.ts'

export const DSH_PRODUCT_POLICY_SERVICE = 'personalAgentPolicy'
export const name = 'personal-agent-workspace-policy'
export const inject = ['tools', 'fs', 'sandboxPolicy']
export const DshWorkspacePolicyConfigSchema = z.strictObject({
  protocol: z.literal('personal-agent-dsh-workspace-policy/1'),
  workspacePath: z.string().min(1).max(4096).refine(value => isAbsolute(value) && !value.includes('\0')),
  scope: ScopeSchema,
  activationFile: z.string().min(1).max(4096).refine(isAbsolute).optional(),
  launchNonce: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (value.scope.allowedPaths.length !== 1 || value.scope.allowedPaths[0] !== '.' ||
      value.scope.excludedPaths.length !== 1 || value.scope.excludedPaths[0].replace(/\/$/, '') !== '.git' ||
      value.scope.externalActions.length !== 0)
    ctx.addIssue({ code: 'custom', message: 'The initial DSH policy supports only workspace root, excluded .git, no external actions' })
  if ((value.activationFile === undefined) !== (value.launchNonce === undefined))
    ctx.addIssue({ code: 'custom', message: 'Activation path and original launch nonce must be paired' })
})

const denial = reason => `personal-agent-policy:${reason}`
const under = (path, root) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
const gitPart = path => path.split(/[\\/]/).some(part => part.toLowerCase() === '.git')
/** Resolve the deepest existing ancestor, failing closed on errors other than a missing suffix. */
function physicalTarget(path) {
  let ancestor = path
  for (;;) {
    try {
      lstatSync(ancestor)
      return resolve(realpathSync(ancestor), relative(ancestor, path))
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      const parent = dirname(ancestor)
      if (parent === ancestor) throw error
      ancestor = parent
    }
  }
}

/** Public for an actual native ToolRuntime consumer; arguments are the native execution object. */
export function createDshWorkspaceGuard(input, policyForSession) {
  const config = DshWorkspacePolicyConfigSchema.parse(input)
  const rootStat = lstatSync(config.workspacePath)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new TypeError('Workspace root must be an owned regular directory')
  const root = realpathSync(config.workspacePath)
  const guard = exec => {
    try {
      if (config.scope.expiresAt && Date.parse(config.scope.expiresAt) <= Date.now()) return denial('scope_expired')
      if (!['read', 'write', 'edit'].includes(exec?.name)) return denial('tool_not_allowed')
      const session = exec?.agent?.session
      const cwd = session?.header?.cwd
      if (typeof cwd !== 'string' || !isAbsolute(cwd) || realpathSync(cwd) !== root) return denial('session_workspace_mismatch')
      const currentRoot = lstatSync(config.workspacePath)
      if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink() || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino ||
          realpathSync(config.workspacePath) !== root) return denial('workspace_identity_changed')
      const standing = policyForSession(session)
      if (standing?.mode !== 'read-only' || realpathSync(standing.workspaceRoot) !== root) return denial('native_policy_changed')
      const args = exec.arguments
      if (!args || typeof args !== 'object' || Array.isArray(args)) return denial('arguments_invalid')
      const file = args.file_path
      if (typeof file !== 'string' || !file.trim() || file.includes('\0') || file.includes('\\') || file.split('/').includes('..'))
        return denial('path_invalid')
      if (args.sandbox_permissions !== undefined && !['read-only', 'workspace-write'].includes(args.sandbox_permissions))
        return denial('permission_escalation_forbidden')
      const target = resolve(cwd, file)
      if ((!under(target, resolve(cwd)) && !under(target, root)) || gitPart(relative(cwd, target))) return denial('path_outside_scope')
      const physical = physicalTarget(target)
      if (!under(physical, root) || gitPart(relative(root, physical))) return denial('resolved_path_outside_scope')
      return undefined
    } catch { return denial('path_or_identity_unverified') }
  }
  return { guard, activation: Object.freeze({ protocol: config.protocol, workspacePath: root,
    scopeDigest: canonicalDigest(config.scope), toolAllowlist: Object.freeze(['read', 'write', 'edit']) }) }
}

/** Loading failure deliberately leaves the dependency service absent, so the ACP bridge cannot start. */
export function apply(ctx, config) {
  if (typeof ctx.tools?.guard !== 'function' || ctx.fs?.sandboxMode !== 'read-only' || ctx.sandboxPolicy?.defaultMode !== 'read-only')
    throw new TypeError('The reviewed DSH ToolRuntime and read-only sandboxed filesystem are required')
  const active = createDshWorkspaceGuard(config, session => ctx.sandboxPolicy.resolve({ session }))
  ctx.tools.guard(active.guard)
  const parsed = DshWorkspacePolicyConfigSchema.parse(config)
  if (parsed.activationFile) {
    const parent = dirname(parsed.activationFile), identity = lstatSync(parent)
    if (!identity.isDirectory() || identity.isSymbolicLink() || (identity.mode & 0o077) !== 0 ||
        (process.getuid && identity.uid !== process.getuid()) || under(realpathSync(parent), active.activation.workspacePath))
      throw new TypeError('Activation must remain in the original private connection root outside the workspace')
    const fd = openSync(parsed.activationFile, 'wx', 0o600)
    try {
      writeFileSync(fd, JSON.stringify({ ...active.activation, protocol: 'personal-agent-dsh-activation/1',
        pid: process.pid, createdAt: Date.now(), nonce: parsed.launchNonce,
        pluginDigest: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex') }))
      fsyncSync(fd)
    } finally { closeSync(fd) }
  }
  ctx.provide(DSH_PRODUCT_POLICY_SERVICE, active.activation)
}
