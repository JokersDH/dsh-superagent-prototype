import { ContextError } from './errors.ts'
import { isDeniedPath, isExternalReference, pathWithin, scopeWithin } from './paths.ts'
import type { ContextReadPort, ContextRequest } from './types.ts'

/**
 * Refuses the request before any source is listed or read:
 * - executor workspace grants can never be reused as main-conversation upload permission;
 * - the grant must be explicitly confirmed, unexpired, for the same project and purpose;
 * - a requested work contract must still be the current one and stay inside the grant scope.
 */
export async function authorizeContextRequest(
  request: ContextRequest,
  port: ContextReadPort,
  now: Date,
): Promise<void> {
  const { grant } = request
  if (grant.gateway !== 'conversation') {
    throw new ContextError('grant_gateway', 'Executor workspace authorization cannot be reused for conversation upload')
  }
  if (grant.purpose !== request.purpose) {
    throw new ContextError('grant_purpose', 'Grant purpose does not match this request')
  }
  if (grant.projectId !== request.projectId || grant.scope.projectId !== request.projectId) {
    throw new ContextError('grant_project', 'Grant belongs to another project')
  }
  const confirmedAt = Date.parse(grant.confirmedAt)
  if (!Number.isFinite(confirmedAt) || confirmedAt > now.getTime()) {
    throw new ContextError('grant_unconfirmed', 'Grant has no past explicit confirmation')
  }
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= now.getTime()) {
    throw new ContextError('grant_expired', 'Grant has expired')
  }
  if (grant.scope.allowedPaths.some((path) => isDeniedPath(path) || isExternalReference(path))) {
    throw new ContextError('denied_path', 'Grant contains a denied or external path root')
  }
  if (request.contract) {
    if (!port.workContext) {
      throw new ContextError('unsupported_port', 'The read port cannot verify a work contract')
    }
    const work = await port.workContext(request.contract.workId)
    if (!work || work.validity !== 'current') {
      throw new ContextError('contract_stale', 'Requested work contract is not current')
    }
    if (
      work.contract.workId !== request.contract.workId ||
      work.contract.revision !== request.contract.revision ||
      work.contract.digest !== request.contract.digest
    ) {
      throw new ContextError('contract_stale', 'Requested contract revision is stale')
    }
    if (work.scope.projectId !== request.projectId) {
      throw new ContextError('grant_project', 'Requested work belongs to another project')
    }
    if (!scopeWithin(work.scope, grant.scope)) {
      throw new ContextError('contract_scope', 'Requested work scope exceeds the conversation grant')
    }
  }
  if (request.workId && grant.sourceKinds.includes('work')) {
    // A work id without a contract is allowed for metadata reads; if present, the port must confirm it.
    if (port.workContext) {
      const work = await port.workContext(request.workId)
      if (work && work.scope.projectId !== request.projectId) {
        throw new ContextError('grant_project', 'Requested work belongs to another project')
      }
    }
  }
}

const FILE_BACKED_KINDS = new Set(['document', 'source_file'])

/** Defensive re-check applied to every listed source; the port is still responsible for its own filter. */
export function sourceAllowedByGrant(
  source: { readonly projectId: string; readonly path: string; readonly kind: string },
  request: ContextRequest,
): 'ok' | 'cross_project' | 'denied_path' | 'excluded_path' | 'external_link' {
  if (source.projectId !== request.projectId) return 'cross_project'
  if (isExternalReference(source.path)) return 'external_link'
  if (isDeniedPath(source.path)) return 'denied_path'
  if (!FILE_BACKED_KINDS.has(source.kind)) return 'ok'
  const { allowedPaths, excludedPaths } = request.grant.scope
  if (!allowedPaths.some((root) => pathWithin(source.path, root))) return 'excluded_path'
  if (excludedPaths.some((root) => pathWithin(source.path, root))) return 'excluded_path'
  return 'ok'
}
