/**
 * Public workflow ports for wave-03 A. The implementation stays in the storage package over one
 * UnitOfWork; this package supplies the stable consumer surface, domain error mapping and snapshot
 * verification. It never opens a second SQLite writer and never grants execution authority.
 */
import type {
  Conversation, ConversationPage, ConversationSearchPage, DecisionRecord, ProductStore, ProjectCurrent,
  ProjectSettings, ProjectVersion, WorkIndexEntry,
} from '@personal-agent/storage'
import { WorkflowConflict as StorageWorkflowConflict } from '@personal-agent/storage'
import type { WorkRecord } from '@personal-agent/contracts'

export { SnapshotError, WorkflowSnapshots } from './snapshot.ts'
export type {
  SnapshotManifest, SnapshotArtifact, SnapshotResult, SnapshotVerification,
} from './snapshot.ts'

export type { Conversation, ConversationPage, ConversationSearchPage, DecisionRecord, ProjectCurrent, ProjectSettings, ProjectVersion, WorkIndexEntry }
export { StorageWorkflowConflict as WorkflowConflict }

export interface ConversationPort {
  create(input: { id: string; projectId?: string; title: string; createdAt?: string }): { created: boolean; conversation: Conversation }
  get(conversationId: string): Conversation | undefined
  rename(conversationId: string, expectedTitleRevision: number, title: string): Conversation
  setArchived(conversationId: string, expectedArchiveRevision: number, archived: boolean): Conversation
  list(input: { projectIds: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string }): ConversationPage
  search(input: { query: string; projectIds: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string }): ConversationSearchPage
}

export interface ProjectSettingsPort {
  append(input: { projectId: string; expectedRevision: number; settings: ProjectSettings; createdAt?: string }): { created: boolean; current: ProjectCurrent }
  current(projectId: string): ProjectCurrent | undefined
  history(projectId: string, options?: { limit?: number }): ProjectVersion[]
  setArchived(projectId: string, expectedArchiveRevision: number, archived: boolean): ProjectCurrent
}

export interface DecisionLedgerPort {
  append(decision: Parameters<ProductStore['workflows']['decisions']['append']>[0], options?: { expectedVersion?: number; createdAt?: string }): { created: boolean; record: DecisionRecord }
  revoke(input: { id: string; expectedVersion: number; revokedAt?: string; createdAt?: string }): { created: boolean; record: DecisionRecord }
  current(decisionId: string): DecisionRecord | undefined
  history(decisionId: string, options?: { limit?: number }): DecisionRecord[]
  list(input: { projectIds: readonly string[]; includeRevoked?: boolean; limit?: number; cursor?: string }): { records: readonly DecisionRecord[]; nextCursor?: string; hasMore: boolean }
}

export interface ReadIndexPort {
  project(projectId: string): { current: ProjectCurrent | undefined; history: ProjectVersion[]; state: 'current' | 'missing' | 'archived' }
  listProjects(input?: { projectIds?: readonly string[]; includeArchived?: boolean; limit?: number; cursor?: string }): { projects: ProjectCurrent[]; nextCursor?: string; hasMore: boolean }
  listWorks(input: { projectIds: readonly string[]; query?: string; limit?: number; cursor?: string }): { works: WorkRecord[]; nextCursor?: string; hasMore: boolean }
  work(workId: string, projectIds: readonly string[]): WorkIndexEntry | undefined
  listArtifacts(input?: { limit?: number; before?: string }): { artifacts: { id: string; digest: string; bytes: number; path: string; createdAt: string }[]; nextCursor?: string; hasMore: boolean }
}

export interface WorkflowPorts {
  conversations: ConversationPort
  projects: ProjectSettingsPort
  decisions: DecisionLedgerPort
  index: ReadIndexPort
}

/** The only production composition: a facade over the storage owner's shared UnitOfWork. */
export function createWorkflowPorts(store: ProductStore): WorkflowPorts {
  return {
    conversations: store.workflows.conversations,
    projects: store.workflows.projects,
    decisions: store.workflows.decisions,
    index: store.workflows.index,
  }
}
