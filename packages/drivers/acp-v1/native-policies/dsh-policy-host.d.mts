import type { AcpPolicyHost } from '../src/index.ts'
import type { ProcessHost } from '../../../../apps/runner/src/process-host.ts'

export function createDshAcpPolicyHost(options: { runtime: Pick<ProcessHost, 'originalIdentity'> }): AcpPolicyHost
