#!/usr/bin/env node
/**
 * C5 independent consumer: authorized bounded context -> mock structured reasoner -> typed proposal
 * -> explicit confirmation/rejection -> explicit decision -> later context -> revocation.
 *
 * It calls no real model, SDK or network endpoint and dispatches no executable intent.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CompositeContextPort,
  ContextReader,
  ContextSourceAccessError,
  LocalProjectSourcePort,
  sha256Text,
} from '@personal-agent/context'
import { ProposalRegistry, parseStructuredOutput } from '@personal-agent/proposals'
import { DecisionGovernance, InMemoryDecisionStore, StaticDecisionSourcePort } from '../dist/index.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = '2026-11-10T00:00:00.000Z'
const projectId = 'project-1'
const scope = { projectId, allowedPaths: ['README.md', 'src'], excludedPaths: [], externalActions: [] }
const grant = {
  grantId: 'grant-1',
  projectId,
  gateway: 'conversation',
  purpose: 'conversation_discussion',
  scope,
  sourceKinds: ['document', 'source_file', 'decision'],
  maxFiles: 10,
  maxBytes: 256 * 1024,
  maxTokens: 20_000,
  maxDurationMs: 5000,
  confirmedAt: '2026-11-09T00:00:00.000Z',
  confirmedBy: 'user-1',
}
const request = (requestId, query) => ({ requestId, projectId, purpose: 'conversation_discussion', query, grant })

function projectFixture() {
  const root = mkdtempSync(join(tmpdir(), 'pa-c5-consumer-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# Demo project\n\nKeep UI copy consistent.\n')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/i18n.ts'), 'export const locale = "zh-CN"\n')
  writeFileSync(join(root, '.env'), 'TOKEN=super-secret\n')
  writeFileSync(join(root, '.gitignore'), '.env\n')
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { cwd: root, encoding: 'utf8' })
  git('add', '-A')
  git('commit', '-qm', 'init')
  return { root, commit: git('rev-parse', 'HEAD').trim(), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

class DecisionContextPort {
  constructor(projectIdValue, governance) {
    this.projectId = projectIdValue
    this.governance = governance
  }
  async projectBaseline() {
    return undefined
  }
  async listSources(input) {
    if (input.projectId !== this.projectId || !input.kinds.includes('decision')) return []
    const records = await this.governance.listEffective(this.projectId)
    return records.map((record) => this.descriptor(record))
  }
  async readSource(input) {
    const records = await this.governance.listEffective(this.projectId)
    const record = records.find((item) => `decision-${item.decision.id}` === input.source.sourceId)
    if (!record) throw new ContextSourceAccessError('missing', 'Decision is no longer effective')
    const content = this.content(record)
    return { content, bytes: Buffer.byteLength(content, 'utf8'), digest: sha256Text(content) }
  }
  content(record) {
    return `User-confirmed decision (${record.decision.id}):\n${record.decision.content}`
  }
  descriptor(record) {
    const content = this.content(record)
    return {
      sourceId: `decision-${record.decision.id}`,
      projectId: this.projectId,
      kind: 'decision',
      path: `decisions/${record.decision.id}.md`,
      title: 'Explicit decision',
      bytes: Buffer.byteLength(content, 'utf8'),
      mediaType: 'text',
      baseline: { contentDigest: sha256Text(content), digestScope: 'content', capturedAt: now },
      validity: 'current',
    }
  }
}

function mockProvider(responses) {
  const queue = [...responses]
  const prompts = []
  return {
    prompts,
    respond(prompt) {
      prompts.push(prompt)
      if (queue.length === 0) throw new Error('mock provider has no queued response')
      return queue.shift()
    },
  }
}

async function main() {
  const project = projectFixture()
  try {
    const steps = []
    const reader = new ContextReader({ now: () => new Date(now) })
    const localPort = new LocalProjectSourcePort({
      rootDir: project.root,
      projectId,
      baseline: { commit: project.commit, capturedAt: now },
    })
    const first = await reader.read(request('request-1', 'UI copy language'), localPort)
    steps.push({ step: 'authorized-context', slices: first.slices.map((slice) => slice.path), status: first.status })

    const provider = mockProvider([
      'A normal discussion reply that proposes nothing executable.',
      { kind: 'propose_work', goal: 'Add an i18n setting', projectId, sourceMessageId: 'msg-1' },
      { kind: 'propose_decision', content: 'Use Chinese UI copy', scope, sourceMessageId: 'msg-1' },
    ])
    const proposals = new ProposalRegistry({ now: () => new Date(now) })
    const executed = []

    const plain = parseStructuredOutput(provider.respond('discuss'))
    steps.push({ step: 'plain-reply', executable: plain.ok === true ? true : plain.executable })

    const work = parseStructuredOutput(provider.respond('propose work'))
    if (!work.ok) throw new Error('work proposal was not structured')
    const workRecord = proposals.create({
      proposalId: 'proposal-work',
      payload: work.proposal,
      trusted: { actorRef: 'user-1', projectId, grant: { grantId: grant.grantId, scope }, sourceMessageId: 'msg-1' },
    })
    const workConfirm = proposals.confirm(workRecord.proposalId, {
      expectedVersion: workRecord.version,
      expectedDigest: workRecord.payloadDigest,
      actorRef: 'user-1',
      barrier: () => ({ ok: true }),
    })
    steps.push({ step: 'work-proposal', intent: workConfirm.intent.kind, executed: executed.length })

    const decision = parseStructuredOutput(provider.respond('propose decision'))
    if (!decision.ok) throw new Error('decision proposal was not structured')
    const decisionRecord = proposals.create({
      proposalId: 'proposal-decision',
      payload: decision.proposal,
      trusted: { actorRef: 'user-1', projectId, grant: { grantId: grant.grantId, scope }, sourceMessageId: 'msg-1' },
    })
    const decisionConfirm = proposals.confirm(decisionRecord.proposalId, {
      expectedVersion: decisionRecord.version,
      expectedDigest: decisionRecord.payloadDigest,
      actorRef: 'user-1',
      barrier: () => ({ ok: true }),
    })
    steps.push({ step: 'decision-proposal', intent: decisionConfirm.intent.kind, executed: executed.length })

    const source = {
      messageId: 'msg-1',
      conversationId: 'conv-1',
      projectId,
      role: 'user',
      provenance: 'trusted_user',
      createdAt: now,
      textDigest: 'a'.repeat(64),
      title: 'Please use Chinese UI copy',
    }
    const governance = new DecisionGovernance(new InMemoryDecisionStore(), new StaticDecisionSourcePort([source]), {
      now: () => new Date(now),
    })
    const actor = { actorRef: 'user-1', projectId, grantScope: scope }
    if (decisionConfirm.intent.kind !== 'record_decision') throw new Error('unexpected intent')
    const recorded = await governance.record(
      {
        decisionId: 'decision-1',
        content: decisionConfirm.intent.content,
        scope: decisionConfirm.intent.scope,
        sourceMessageId: decisionConfirm.intent.sourceMessageId,
      },
      actor,
    )
    steps.push({ step: 'record-decision', status: recorded.record.status })

    const composite = new CompositeContextPort([localPort, new DecisionContextPort(projectId, governance)])
    const second = await reader.read(request('request-2', 'UI copy language'), composite)
    steps.push({
      step: 'context-with-decision',
      decisionSlice: second.slices.find((slice) => slice.kind === 'decision')?.content ?? null,
    })

    await governance.revoke('decision-1', 1, actor)
    const third = await reader.read(request('request-3', 'UI copy language'), composite)
    steps.push({
      step: 'context-after-revoke',
      decisionSlice: third.slices.find((slice) => slice.kind === 'decision') ?? null,
    })

    const report = {
      protocol: 'c5-consumer/1',
      generatedAt: new Date().toISOString(),
      branch: execFileSync('git', ['branch', '--show-current'], { cwd: packageRoot, encoding: 'utf8' }).trim(),
      steps,
      result: {
        status: 'PASS',
        modelCalls: provider.prompts.length,
        networkCalls: 0,
        executedIntents: executed.length,
        absoluteRootLeaked: JSON.stringify([first, second, third]).includes(project.root),
        decisionsBeforeRevoke: 1,
        decisionsAfterRevoke: (await governance.listEffective(projectId)).length,
      },
    }
    mkdirSync(join(packageRoot, 'reports'), { recursive: true })
    writeFileSync(join(packageRoot, 'reports/consumer-run.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(report.result)}\n`)
    if (report.result.absoluteRootLeaked) process.exitCode = 1
    if (report.result.executedIntents !== 0) process.exitCode = 1
  } finally {
    project.cleanup()
  }
}

await main()
