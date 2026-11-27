import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AgentProfileSchema, DigestSchema, IdSchema, TimestampSchema } from '@personal-agent/contracts'
import { installDshAcpPolicy, manifestForDshProfile, verifyDshAcpPolicy } from '../../../packages/drivers/acp-v1/native-policies/dsh-policy-installation.mjs'

const ConnectionSchema = z.strictObject({ protocol: z.literal('product-acp-connection/1'),
  template: z.literal('dsh-workspace-v1'), displayName: z.string().trim().min(1).max(160),
  modelId: z.string().trim().min(1).max(160),
  profile: AgentProfileSchema, policyIdentity: DigestSchema, createdAt: TimestampSchema })
export type AcpConnection = z.infer<typeof ConnectionSchema>
export type AcpConnectionState = { id: string; displayName: string; connection?: AcpConnection;
  readiness: 'policy_installed' | 'needs_auth' | 'invalid' }
const reservedId = (id: string) => id === 'profile-codex-native' || id.startsWith('profile-fixture-')
const directory = (path: string) => {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid())
    throw new Error('acp-connection:private_directory_required')
  return realpathSync(path)
}
function connectionFile(root: string): AcpConnection {
  const path = join(root, 'connection.json'), stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > 128 * 1024 ||
      process.getuid && stat.uid !== process.getuid()) throw new Error('acp-connection:private_record_required')
  const record = ConnectionSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (manifestForDshProfile(record.profile) !== join(root, 'installation.json')) throw new Error('acp-connection:installation_root_changed')
  const installation = verifyDshAcpPolicy(record.profile)
  if (installation.policyIdentity !== record.policyIdentity) throw new Error('acp-connection:policy_identity_changed')
  const model = z.object({ id: z.string() }).parse(installation.plan.model)
  if (model.id !== record.modelId) throw new Error('acp-connection:model_identity_changed')
  return record
}

/** Private configuration only. Neither this record nor installation metadata grants execution. */
export function listAcpConnections(stateRoot: string): readonly AcpConnectionState[] {
  const parent = join(stateRoot, 'agent-connections')
  try { lstatSync(parent) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const root = directory(parent), entries = readdirSync(root, { withFileTypes: true })
  if (entries.length > 128) throw new Error('acp-connection:configuration_limit')
  return entries.filter(entry => IdSchema.safeParse(entry.name).success && !reservedId(entry.name)).map(entry => {
    try {
      const path = directory(join(root, entry.name)), connection = connectionFile(path)
      if (connection.profile.id !== entry.name) throw new Error('acp-connection:profile_identity_changed')
      const installed = verifyDshAcpPolicy(connection.profile)
      return { id: entry.name, displayName: connection.displayName, connection, readiness: installed.readiness }
    } catch { return { id: entry.name, displayName: entry.name, readiness: 'invalid' as const } }
  })
}

/** Creates a fresh named connection; existing revisions, homes and credentials are never replaced. */
export async function configureAcpConnection(input: {
  stateRoot: string; profileId: string; displayName: string; dshEntry: string;
  model: Parameters<typeof installDshAcpPolicy>[0]['model'];
}): Promise<AcpConnectionState> {
  const stateRoot = directory(input.stateRoot), id = IdSchema.parse(input.profileId)
  if (reservedId(id)) throw new Error('acp-connection:reserved_profile_id')
  const displayName = ConnectionSchema.shape.displayName.parse(input.displayName)
  const parent = join(stateRoot, 'agent-connections')
  try { mkdirSync(parent, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const base = directory(parent)
  if (readdirSync(base).length >= 128) throw new Error('acp-connection:configuration_limit')
  const installation = await installDshAcpPolicy({ connectionRoot: join(base, id), profileId: id,
    nodeExecutable: process.execPath, dshEntry: input.dshEntry, model: input.model })
  const record = ConnectionSchema.parse({ protocol: 'product-acp-connection/1', template: 'dsh-workspace-v1',
    displayName, modelId: input.model.id.trim(), profile: installation.profile, policyIdentity: installation.policyIdentity, createdAt: new Date().toISOString() })
  // Last write makes an entirely prepared connection visible. Partial setup remains private/disabled.
  const root = join(base, id), fd = openSync(join(root, 'connection.json'), 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(record, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  const directoryFd = openSync(root, 'r')
  try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
  return { id, displayName, connection: record, readiness: installation.readiness }
}
