import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PersistedDecisionSchema, PersistedProposalSchema } from '../../../packages/contracts/dist/index.js'
import { runCase, notTested, STATUS, LAYERS } from '../lib/status.mjs'
import { sha256 } from '../lib/evidence.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { cleanup, pickPort, startProduct, tempState } from '../lib/instance.mjs'

const load = (path) => {
  const bytes = readFileSync(path)
  return { document: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes), path }
}

/**
 * Assistant acceptance is gated on C's domain fixes and main's HTTP wiring. Until both exist, the
 * suite validates the public schema fixtures, records C's independent admission result as an input,
 * and declares the end-to-end and transaction cases NOT_TESTED with their owner and prerequisites.
 */
export async function runAssistant({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const fixtures = join(root, 'tests/product-acceptance/fixtures/assistant')

  await case_(
    'E3-ASSISTANT-SCHEMA-FIXTURES',
    'Persisted decision/proposal fixtures match the public contract and illegal variants are rejected',
    LAYERS.READONLY,
    async ({ assert, evidence }) => {
      const decision = load(join(fixtures, 'persisted-decision.json'))
      const proposal = load(join(fixtures, 'persisted-proposal.json'))
      assert('DECISION_SCHEMA', PersistedDecisionSchema.safeParse(decision.document).success)
      assert('PROPOSAL_SCHEMA', PersistedProposalSchema.safeParse(proposal.document).success)
      const invalidDecision = structuredClone(decision.document)
      invalidDecision.revokedBy = 'actor-revoker'
      assert('REJECT_REVOKE_WITHOUT_TIMESTAMP', !PersistedDecisionSchema.safeParse(invalidDecision).success)
      const confirmed = structuredClone(proposal.document)
      confirmed.state = 'confirmed'
      assert('REJECT_CONFIRM_WITHOUT_COMMAND', !PersistedProposalSchema.safeParse(confirmed).success)
      const foreign = structuredClone(proposal.document)
      foreign.grantScope.projectId = 'another-project'
      assert('REJECT_GRANT_MISMATCH', !PersistedProposalSchema.safeParse(foreign).success)
      evidence.fixture = { id: 'assistant-decision', path: decision.path, sha256: decision.sha256 }
      evidence.assistantFixtures = {
        decision: decision.sha256,
        proposal: proposal.sha256,
        invalidVariantsRejected: 3,
      }
    },
  )

  // C's own admission probe is the independent authority for the three domain defects.
  const probeOutput = join(runDirectory, 'c-domain-admission.json')
  const probe = spawnSync(
    process.execPath,
    [
      'tools/bootstrap/review-wave04-admission.mjs',
      '--acceptance-root',
      root,
      '--output',
      probeOutput,
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )
  let probeReport
  try {
    probeReport = JSON.parse(readFileSync(probeOutput, 'utf8'))
  } catch {
    probeReport = undefined
  }
  const cCases = (probeReport?.cases ?? []).filter((item) => item.owner === 'C')
  const cFailures = cCases.filter((item) => item.status !== 'PASS')
  if (cCases.length === 3 && cFailures.length === 0) {
    cases.push(
      await runCase(
        {
          id: 'E3-ASSISTANT-DOMAIN-ADMISSION',
          title: 'C domain admission probes pass',
          layer: LAYERS.READONLY,
          evidence: { cProbes: cCases.map((item) => ({ id: item.id, status: item.status })) },
          limitations: ['Consumes main\'s read-only domain probe; it is not a product workflow.'],
        },
        async ({ assert }) => {
          assert('C_CASES_PASS', cCases.every((item) => item.status === 'PASS'))
        },
      ),
    )
  } else {
    const result = notTested(
      {
        id: 'E3-ASSISTANT-DOMAIN-ADMISSION',
        title: 'C domain admission probes pass',
        layer: LAYERS.READONLY,
        limitations: ['Owner: Agent C; main\'s probe is the independent authority for these defects.'],
      },
      `C probes not fixed at ${probeReport?.sourceCommit ?? 'unknown'}: ` +
        cFailures.map((item) => `${item.id}=${item.status}`).join(', '),
    )
    result.evidence = {
      cProbes: cCases.map((item) => ({ id: item.id, status: item.status, actual: item.actual })),
      probeExit: probe.status,
    }
    cases.push(result)
  }

  // End-to-end and transaction cases need an assistant state HTTP entry that main has not published.
  {
    const { root: tempRoot, state } = tempState('pa-w4-assistant-')
    const port = await pickPort()
    const consolePort = await pickPort()
    let server
    try {
      server = await startProduct({ root, port, stateRoot: state, consoleOrigin: `http://127.0.0.1:${consolePort}` })
      const client = new LocalProductClient({ baseURL: `http://127.0.0.1:${port}`, stateDir: state, timeoutMs: 15_000 })
      const configuration = await client.configuration()
      const project = configuration.projects.find((item) => item.dispatchAllowed)
      const snapshot = await client.snapshot({ includeLearning: true, knowledgeProjectId: project.id })
      const decision = await client.dispatch({
        commandId: 'w4-assistant-decision',
        conversationId: 'conv-assistant',
        kind: 'record_decision',
        content: 'assistant wiring probe',
        scope: project.scope,
        sourceMessageId: 'message-assistant',
      })
      const assistant = await client.request('/v1/assistant')
      const result = notTested(
        {
          id: 'E3-ASSISTANT-END-TO-END',
          title: 'Explicit decision → authorised context → proposal → confirm/reject → atomic receipt → reopen',
          layer: LAYERS.NOT_TESTED,
          limitations: [
            'Owner: main (assistant HTTP/context wiring) and C (AssistantStatePort consumer).',
            'No decision/proposal HTTP entry exists in this checkout; no partial product claim is made.',
          ],
        },
        'snapshot exposes no knowledge/decision projection; record_decision is rejected as unsupported_capability.',
      )
      result.evidence = {
        assistantConfigured: assistant.body?.configured === true,
        knowledgeProjection: snapshot.knowledge !== undefined,
        recordDecision: { status: decision.receipt.status, code: decision.receipt.error?.code ?? null },
        plannedNegatives: [
          'untrusted source instruction in a repository file',
          'other project / conversation / actor',
          'old contract or source digest',
          'revoked grant',
          'over-budget proposal',
          'crash after confirmation before command commit',
          'transaction failure rolls back record and command',
          'same commandId replay is idempotent, changed payload conflicts',
        ],
      }
      cases.push(result)
    } finally {
      await server?.stop()
      artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
    }
  }

  return { cases, artifacts }

  async function case_(id, title, layer, body) {
    cases.push(
      await runCase(
        {
          id,
          title,
          layer,
          evidence: {},
          limitations: [
            'Schema/contract fixtures only; no assistant product workflow is claimed in this checkout.',
          ],
        },
        body,
      ),
    )
  }
}
