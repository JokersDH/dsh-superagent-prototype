import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scope } from '@personal-agent/contracts'
import {
  CompositeContextPort,
  ContextReader,
  ContextSourceAccessError,
  LocalProjectSourcePort,
  sha256Text,
  type ContextReadPort,
  type ContextSourceDescriptor,
} from '@personal-agent/context'
import { ProposalRegistry, parseStructuredOutput, type ProposalIntent } from '@personal-agent/proposals'
import {
  DecisionGovernance,
  InMemoryDecisionStore,
  StaticDecisionSourcePort,
} from '../src/index.ts'
import type { DecisionRecord, DecisionSource } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'

/** A model provider stand-in. It returns queued values and makes no network or SDK call. */
class MockStructuredProvider {
  readonly prompts: string[] = []
  private readonly responses: unknown[]
  constructor(responses: readonly unknown[]) {
    this.responses = [...responses]
  }
  respond(prompt: string): unknown {
    this.prompts.push(prompt)
    if (this.responses.length === 0) throw new Error('mock provider has no queued response')
    return this.responses.shift()
  }
}

/** Explicit decision sources exposed as bounded context slices; it reads governance on each call. */
class DecisionContextPort implements ContextReadPort {
  private readonly projectId: string
  private readonly governance: DecisionGovernance
  constructor(projectId: string, governance: DecisionGovernance) {
    this.projectId = projectId
    this.governance = governance
  }
  async projectBaseline(): Promise<undefined> {
    return undefined
  }
  async listSources(input: {
    readonly projectId: string
    readonly kinds: readonly import('@personal-agent/context').ContextSourceKind[]
  }): Promise<readonly ContextSourceDescriptor[]> {
    if (input.projectId !== this.projectId || !input.kinds.includes('decision')) return []
    const records = await this.governance.listEffective(this.projectId)
    return records.map((record) => this.descriptor(record))
  }
  async readSource(input: {
    readonly source: ContextSourceDescriptor
    readonly maxBytes: number
  }): Promise<{ content: string; bytes: number; digest: string }> {
    const records = await this.governance.listEffective(this.projectId)
    const record = records.find((item) => `decision-${item.decision.id}` === input.source.sourceId)
    if (!record) throw new ContextSourceAccessError('missing', 'Decision is no longer effective')
    const content = this.content(record)
    return { content, bytes: Buffer.byteLength(content, 'utf8'), digest: sha256Text(content) }
  }
  private content(record: DecisionRecord): string {
    return `User-confirmed decision (${record.decision.id}):\n${record.decision.content}`
  }
  private descriptor(record: DecisionRecord): ContextSourceDescriptor {
    const content = this.content(record)
    return {
      sourceId: `decision-${record.decision.id}`,
      projectId: this.projectId,
      kind: 'decision',
      path: `decisions/${record.decision.id}.md`,
      title: 'Explicit decision',
      bytes: Buffer.byteLength(content, 'utf8'),
      mediaType: 'text',
      baseline: { contentDigest: sha256Text(content), digestScope: 'content', capturedAt: NOW },
      validity: 'current',
    }
  }
}

function projectFixture(): { root: string; commit: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'pa-assistant-loop-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# Demo assistant project\n\nKeep UI copy consistent.\n')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/i18n.ts'), 'export const locale = "zh-CN"\n')
  writeFileSync(join(root, '.env'), 'TOKEN=super-secret\n')
  writeFileSync(join(root, '.gitignore'), '.env\n')
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'add', '-A'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'init'], { cwd: root })
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  return { root, commit, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('offline assistant loop: context -> mock reasoner -> proposal -> confirmation -> decision -> context -> revoke', async (t) => {
  const project = projectFixture()
  t.after(project.cleanup)
  const projectScope: Scope = {
    projectId: 'project-1',
    allowedPaths: ['README.md', 'src'],
    excludedPaths: [],
    externalActions: [],
  }
  const grant = {
    grantId: 'grant-1',
    projectId: 'project-1',
    gateway: 'conversation' as const,
    purpose: 'conversation_discussion' as const,
    scope: projectScope,
    sourceKinds: ['document', 'source_file', 'decision'] as const,
    maxFiles: 10,
    maxBytes: 256 * 1024,
    maxTokens: 20_000,
    maxDurationMs: 5000,
    confirmedAt: '2026-11-09T00:00:00.000Z',
    confirmedBy: 'user-1',
  }
  const request = (requestId: string, query: string) => ({
    requestId,
    projectId: 'project-1',
    purpose: 'conversation_discussion' as const,
    query,
    grant,
  })

  const reader = new ContextReader({ now: () => new Date(NOW) })
  const localPort = new LocalProjectSourcePort({
    rootDir: project.root,
    projectId: 'project-1',
    baseline: { commit: project.commit, capturedAt: NOW },
  })
  const firstBundle = await reader.read(request('request-1', 'UI copy language'), localPort)
  assert.ok(firstBundle.slices.some((slice) => slice.path === 'README.md'))
  assert.equal(JSON.stringify(firstBundle).includes(project.root), false)

  const provider = new MockStructuredProvider([
    'I can discuss this, but I will not infer an executable command from prose.',
    { kind: 'propose_work', goal: 'Add an i18n setting', projectId: 'project-1', sourceMessageId: 'msg-1' },
    { kind: 'propose_decision', content: 'Use Chinese UI copy', scope: projectScope, sourceMessageId: 'msg-1' },
    { kind: 'propose_decision', content: 'Use English UI copy', scope: projectScope, sourceMessageId: 'msg-1' },
  ])
  const proposals = new ProposalRegistry({ now: () => new Date(NOW) })
  const executed: ProposalIntent[] = []
  const executor = (intent: ProposalIntent) => {
    executed.push(intent)
  }

  const plain = parseStructuredOutput(provider.respond('user asks for a UI change'))
  assert.equal(plain.ok, false)
  if (!plain.ok) assert.equal(plain.executable, false)

  const workPayload = provider.respond('user asks to add i18n setting')
  const workParsed = parseStructuredOutput(workPayload)
  assert.equal(workParsed.ok, true)
  if (!workParsed.ok) throw new Error('unreachable')
  const workProposal = proposals.create({
    proposalId: 'proposal-work',
    payload: workParsed.proposal,
    trusted: {
      actorRef: 'user-1',
      projectId: 'project-1',
      grant: { grantId: grant.grantId, scope: projectScope },
      sourceMessageId: 'msg-1',
    },
  })
  assert.equal(executed.length, 0)
  const workConfirm = proposals.confirm(workProposal.proposalId, {
    expectedVersion: workProposal.version,
    expectedDigest: workProposal.payloadDigest,
    actorRef: 'user-1',
    barrier: () => ({ ok: true }),
  })
  assert.equal(workConfirm.intent.kind, 'create_work')
  assert.equal(executed.length, 0, 'confirmation alone must not execute anything')

  const decisionPayload = provider.respond('user asks to remember the copy language')
  const decisionParsed = parseStructuredOutput(decisionPayload)
  assert.equal(decisionParsed.ok, true)
  if (!decisionParsed.ok) throw new Error('unreachable')
  const decisionProposal = proposals.create({
    proposalId: 'proposal-decision',
    payload: decisionParsed.proposal,
    trusted: {
      actorRef: 'user-1',
      projectId: 'project-1',
      grant: { grantId: grant.grantId, scope: projectScope },
      sourceMessageId: 'msg-1',
    },
  })
  const decisionConfirm = proposals.confirm(decisionProposal.proposalId, {
    expectedVersion: decisionProposal.version,
    expectedDigest: decisionProposal.payloadDigest,
    actorRef: 'user-1',
    barrier: () => ({ ok: true }),
  })
  assert.equal(decisionConfirm.intent.kind, 'record_decision')

  const rejectPayload = provider.respond('user considers another language')
  const rejectParsed = parseStructuredOutput(rejectPayload)
  assert.equal(rejectParsed.ok, true)
  if (!rejectParsed.ok) throw new Error('unreachable')
  const rejectProposal = proposals.create({
    proposalId: 'proposal-rejected',
    payload: rejectParsed.proposal,
    trusted: {
      actorRef: 'user-1',
      projectId: 'project-1',
      grant: { grantId: grant.grantId, scope: projectScope },
      sourceMessageId: 'msg-1',
    },
  })
  proposals.reject(rejectProposal.proposalId, { expectedVersion: rejectProposal.version, reason: 'Keep Chinese copy' })

  const source: DecisionSource = {
    messageId: 'msg-1',
    conversationId: 'conv-1',
    projectId: 'project-1',
    role: 'user',
    provenance: 'trusted_user',
    createdAt: NOW,
    textDigest: 'a'.repeat(64),
    title: 'Please use Chinese UI copy',
  }
  const governance = new DecisionGovernance(new InMemoryDecisionStore(), new StaticDecisionSourcePort([source]), {
    now: () => new Date(NOW),
  })
  if (decisionConfirm.intent.kind !== 'record_decision') throw new Error('unreachable')
  const actor = { actorRef: 'user-1', projectId: 'project-1', grantScope: projectScope }
  const recorded = await governance.record(
    {
      decisionId: 'decision-1',
      content: decisionConfirm.intent.content,
      scope: decisionConfirm.intent.scope,
      sourceMessageId: decisionConfirm.intent.sourceMessageId,
    },
    actor,
  )
  assert.equal(recorded.record.status, 'active')
  assert.deepEqual((await governance.page('project-1')).decisions.map((decision) => decision.id), ['decision-1'])

  const withDecision = new CompositeContextPort([localPort, new DecisionContextPort('project-1', governance)])
  const secondBundle = await reader.read(request('request-2', 'UI copy language'), withDecision)
  const decisionSlice = secondBundle.slices.find((slice) => slice.kind === 'decision')
  assert.ok(decisionSlice)
  assert.equal(decisionSlice?.trust, 'untrusted_data')
  assert.ok(decisionSlice?.content.includes('Use Chinese UI copy'))
  assert.equal(JSON.stringify(secondBundle).includes(project.root), false)

  await governance.revoke('decision-1', 1, actor)
  const afterRevoke = await reader.read(request('request-3', 'UI copy language'), withDecision)
  assert.equal(afterRevoke.slices.some((slice) => slice.kind === 'decision'), false)
  assert.equal((await governance.listEffective('project-1')).length, 0)

  assert.equal(provider.prompts.length, 4)
  assert.equal(executed.length, 0, 'no intent was dispatched by this offline consumer')
})

test('a rejected proposal never records a decision', async () => {
  const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
  const proposals = new ProposalRegistry({ now: () => new Date(NOW) })
  const proposal = proposals.create({
    proposalId: 'proposal-1',
    payload: { kind: 'propose_decision', content: 'Use English copy', scope, sourceMessageId: 'msg-1' },
    trusted: {
      actorRef: 'user-1',
      projectId: 'project-1',
      grant: { grantId: 'grant-1', scope },
      sourceMessageId: 'msg-1',
    },
  })
  proposals.reject(proposal.proposalId, { expectedVersion: proposal.version, reason: 'No' })
  const store = new InMemoryDecisionStore()
  assert.equal((await store.list({ projectId: 'project-1' })).decisions.length, 0)
})
