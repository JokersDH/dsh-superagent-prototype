import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { sha256Text } from '../src/digest.ts'
import { StaticContextPort } from '../src/static-port.ts'
import type {
  ContextGrant,
  ContextReadPort,
  ContextRequest,
  ContextSourceDescriptor,
  ContextSourceKind,
  ContextWorkDescriptor,
} from '../src/types.ts'
import type { Scope } from '@personal-agent/contracts'

export const NOW = '2026-11-10T00:00:00.000Z'
export const CONFIRMED = '2026-11-09T00:00:00.000Z'
export const COMMIT = 'a'.repeat(40)

export function scope(overrides: Partial<Scope> = {}): Scope {
  return {
    projectId: 'project-1',
    allowedPaths: ['src', 'docs', 'README.md'],
    excludedPaths: [],
    externalActions: [],
    ...overrides,
  }
}

export function makeGrant(overrides: Partial<ContextGrant> = {}): ContextGrant {
  return {
    grantId: 'grant-1',
    projectId: 'project-1',
    gateway: 'conversation',
    purpose: 'conversation_discussion',
    scope: scope(),
    sourceKinds: ['project_metadata', 'work', 'document', 'source_file'],
    maxFiles: 10,
    maxBytes: 64 * 1024,
    maxTokens: 8000,
    maxDurationMs: 1000,
    confirmedAt: CONFIRMED,
    confirmedBy: 'user-1',
    ...overrides,
  }
}

export function makeRequest(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    requestId: 'request-1',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: 'parser behaviour',
    grant: makeGrant(),
    ...overrides,
  }
}

export function descriptor(
  path: string,
  content: string,
  overrides: Partial<ContextSourceDescriptor> = {},
): ContextSourceDescriptor {
  return {
    sourceId: `src-${path.replace(/[^A-Za-z0-9]+/g, '-')}`,
    projectId: 'project-1',
    kind: 'document' as ContextSourceKind,
    path,
    title: basename(path),
    bytes: Buffer.byteLength(content, 'utf8'),
    mediaType: 'text',
    baseline: { commit: COMMIT, contentDigest: sha256Text(content), digestScope: 'content', capturedAt: NOW },
    validity: 'current',
    ...overrides,
  }
}

export function staticPort(
  sources: readonly { descriptor: ContextSourceDescriptor; content: string }[],
  options: {
    projectId?: string
    commit?: string
    capturedAt?: string
    works?: readonly ContextWorkDescriptor[]
  } = {},
): StaticContextPort {
  return new StaticContextPort({
    projectId: options.projectId ?? 'project-1',
    baseline: { commit: options.commit ?? COMMIT, capturedAt: options.capturedAt ?? NOW },
    sources,
    ...(options.works === undefined ? {} : { works: options.works }),
  })
}

/** A read-only port wrapper that counts method calls so tests can prove no write path is touched. */
export class CountingPort implements ContextReadPort {
  readonly calls: string[] = []
  private readonly inner: ContextReadPort
  constructor(inner: ContextReadPort) {
    this.inner = inner
  }
  async projectBaseline(projectId: string) {
    this.calls.push('projectBaseline')
    return this.inner.projectBaseline(projectId)
  }
  async listSources(input: Parameters<ContextReadPort['listSources']>[0]) {
    this.calls.push('listSources')
    return this.inner.listSources(input)
  }
  async readSource(input: Parameters<ContextReadPort['readSource']>[0]) {
    this.calls.push('readSource')
    return this.inner.readSource(input)
  }
  async workContext(workId: string) {
    this.calls.push('workContext')
    return this.inner.workContext?.(workId)
  }
}

export function tempDir(prefix: string): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), prefix))
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) }
}
