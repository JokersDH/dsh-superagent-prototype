/** Protocol claims are not observed native operations or permission to execute. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { ACP_SDK_ENTRYPOINT, ACP_SDK_VERSION } from './protocol.ts'
import type { AcpHandshake } from './index.ts'

const require = createRequire(import.meta.url)
export function acpV1ConformanceDeclaration(handshake: AcpHandshake) {
  if (handshake.protocolVersion !== 1) throw new TypeError('Only a successful ACP v1 negotiation can declare this protocol')
  const schemaPath = require.resolve('@agentclientprotocol/sdk/schema/v1/schema.json')
  return {
    origin: 'protocol_declaration' as const,
    protocol: 'agent-client-protocol' as const,
    protocolVersion: 1 as const,
    sdkVersion: ACP_SDK_VERSION,
    sdkEntrypoint: ACP_SDK_ENTRYPOINT,
    schemaDigest: createHash('sha256').update(readFileSync(schemaPath)).digest('hex'),
    specification: 'https://agentclientprotocol.com/protocol/v1/initialization',
    // Normative v1 baselines, not copied from the product's required/observed surface.
    declaredBaseMethods: ['session/new', 'session/prompt', 'session/cancel', 'session/update'],
    observed: { initialize: true, protocolVersion: handshake.protocolVersion, agentName: handshake.agentName,
      agentVersion: handshake.agentVersion, advertisedCapabilities: handshake.capabilities, evidenceRefs: [...handshake.evidenceRefs] },
    nativeOperationsVerified: false as const,
    grantsExecution: false as const,
  }
}
