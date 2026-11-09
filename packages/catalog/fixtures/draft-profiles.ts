/**
 * Draft AgentProfiles for the three first-wave agents (WP-06).
 *
 * These are **draft fixtures**, not verified installations: `expectedVersion` values come from the
 * research notes and must be re-pinned against an actual installation before any catalog entry can
 * reach `inspection_passed`. Nothing here proves native compatibility.
 */
import type { AgentProfile } from '../../contracts/src/types.ts'

/** Codex installs from the OpenAI CLI; the app-server surface is the Driver target. */
export const CODEX_PROFILE: AgentProfile = {
  id: 'profile-codex',
  revision: 1,
  driverId: 'codex-native',
  driverApiMajor: 1,
  driverRelease: '0.0.0-g2',
  executable: '/usr/local/bin/codex',
  argv: ['app-server', '--listen', 'stdio://'],
  expectedVersion: '0.164.0',
  nativeConfigRef: 'codex-config-default',
  permissionPolicyRevision: 'codex-approval-on-request',
  requiredFeatures: ['chat.turn', 'command.exec', 'approval.request'],
}

/** DeepSeek Harness through its ACP surface (protocol adapter is a later package). */
export const DSH_PROFILE: AgentProfile = {
  id: 'profile-dsh',
  revision: 1,
  driverId: 'acp-v1',
  driverApiMajor: 1,
  driverRelease: '0.0.0-g2',
  executable: '/usr/local/bin/deepseek-harness',
  argv: ['acp'],
  expectedVersion: '0.2.1-rc.2',
  nativeConfigRef: 'dsh-profile-default',
  permissionPolicyRevision: 'dsh-default',
  requiredFeatures: ['chat.turn', 'session.new'],
}

/** ZCode via its own native protocol; source and installed versions differ and are unverified. */
export const ZCODE_PROFILE: AgentProfile = {
  id: 'profile-zcode',
  revision: 1,
  driverId: 'zcode-native',
  driverApiMajor: 1,
  driverRelease: '0.0.0-g2',
  executable: '/usr/local/bin/zcode',
  argv: ['--agent-server'],
  expectedVersion: '0.16.5',
  nativeConfigRef: 'zcode-config-default',
  permissionPolicyRevision: 'zcode-default',
  requiredFeatures: ['chat.turn'],
}

export const DRAFT_PROFILES = [CODEX_PROFILE, DSH_PROFILE, ZCODE_PROFILE] as const

/** Which profile's protocol this wave actually exercises; the others stay NOT_TESTED. */
export const NATIVE_TESTED = { codex: false, dsh: false, zcode: false } as const
