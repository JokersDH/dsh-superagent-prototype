import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewEvidenceSchema, ReviewReportSchema } from '../../../packages/contracts/dist/index.js'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { latestEvents } from '../lib/product-db.mjs'
import { cleanup, pickPort, startWorkbench, tempState } from '../lib/instance.mjs'
import { sealCase, sealDirectory } from '../pilot/harness.mjs'
import { gotoConsole, openBrowser, screenshot, VIEWPORTS } from '../lib/browser.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Wave-05 review acceptance: schema fixtures, the sealed-copy capsule, and the real UI activity
 * timing proxy. The full author→freeze→review→report pipeline has no product entry in this checkout.
 */
export async function runWave05E3({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const shots = join(runDirectory, 'screenshots')
  const fixtures = join(root, 'tests/product-acceptance/fixtures/routing')

  cases.push(
    await runCase(
      {
        evidence: {},
        id: 'E3-REVIEW-FIXTURES',
        title: 'Review report/evidence fixtures match the frozen contract and illegal variants are rejected',
        layer: LAYERS.READONLY,
        limitations: ['Schema fixtures only; no review pipeline is claimed.'],
      },
      async ({ assert, evidence }) => {
        const reportBytes = readFileSync(join(fixtures, 'review-report.json'))
        const evidenceBytes = readFileSync(join(fixtures, 'review-evidence.json'))
        const report = JSON.parse(reportBytes.toString('utf8'))
        const reviewEvidence = JSON.parse(evidenceBytes.toString('utf8'))
        assert('REPORT_SCHEMA', ReviewReportSchema.safeParse(report).success)
        assert('EVIDENCE_SCHEMA', ReviewEvidenceSchema.safeParse(reviewEvidence).success)
        const badDisposition = structuredClone(report)
        badDisposition.disposition = 'no_findings'
        assert('REJECT_DISPOSITION', !ReviewReportSchema.safeParse(badDisposition).success)
        const sameAssignment = structuredClone(reviewEvidence)
        sameAssignment.reviewAttempt.assignmentId = sameAssignment.subject.candidate.assignmentId
        assert('REJECT_SAME_ASSIGNMENT', !ReviewEvidenceSchema.safeParse(sameAssignment).success)
        const noIsolation = structuredClone(reviewEvidence)
        delete noIsolation.isolation
        assert('REJECT_NO_ISOLATION', !ReviewEvidenceSchema.safeParse(noIsolation).success)
        const bothProofs = structuredClone(reviewEvidence)
        bothProofs.readOnlyProofRef = 'legacy-proof'
        assert('REJECT_DOUBLE_PROOF', !ReviewEvidenceSchema.safeParse(bothProofs).success)
        evidence.fixture = {
          id: 'review-report-fixture',
          path: join(fixtures, 'review-report.json'),
          sha256: sha256(reportBytes),
        }
        evidence.reviewFixtures = { report: sha256(reportBytes), evidence: sha256(evidenceBytes), mutantsRejected: 4 }
      },
    ),
  )

  cases.push(
    await runCase(
      {
        evidence: {},
        id: 'E3-SEALED-COPY',
        title: 'A sealed capsule excludes .git/dependencies, refuses links and copies by value',
        layer: LAYERS.READONLY,
        limitations: ['Capsule building is acceptance tooling; it is not a host sandbox.'],
      },
      async ({ assert, evidence }) => {
        const first = mkdtempSync(join(tmpdir(), 'pa-capsule-a-'))
        const second = mkdtempSync(join(tmpdir(), 'pa-capsule-b-'))
        try {
          const one = sealCase('case-01', first)
          const two = sealCase('case-01', second)
          assert('DETERMINISTIC_DIGEST', one.manifest.digest === two.manifest.digest, one.manifest.digest)
          assert('FILES_COPIED', one.manifest.files.length > 0)
          const sourceStat = statSync(join(root, 'tests/product-acceptance/pilot/cases/case-01/src/index.js'))
          const copyStat = statSync(join(first, 'src/index.js'))
          assert('NO_HARD_LINK', sourceStat.ino !== copyStat.ino, `${sourceStat.ino} == ${copyStat.ino}`)
          assert(
            'NO_ORACLE_LEAK',
            one.manifest.files.every((file) => !file.path.includes('oracle') && !file.path.startsWith('hidden/')),
            JSON.stringify(one.manifest.files.map((file) => file.path)),
          )

          const dirtySource = mkdtempSync(join(tmpdir(), 'pa-capsule-src-'))
          const destination = mkdtempSync(join(tmpdir(), 'pa-capsule-dst-'))
          try {
            cpSync(join(root, 'tests/product-acceptance/pilot/cases/case-01'), dirtySource, { recursive: true })
            mkdirSync(join(dirtySource, '.git'), { recursive: true })
            writeFileSync(join(dirtySource, '.git', 'config'), '[remote]\n')
            mkdirSync(join(dirtySource, 'node_modules', 'pkg'), { recursive: true })
            writeFileSync(join(dirtySource, 'node_modules', 'pkg', 'index.js'), 'x')
            const sealed = sealDirectory(dirtySource, destination)
            assert(
              'EXCLUDES_GIT_AND_DEPS',
              sealed.manifest.files.every((file) => !file.path.startsWith('.git/') && !file.path.startsWith('node_modules/')),
              JSON.stringify(sealed.manifest.files.map((file) => file.path)),
            )
            symlinkSync(join(dirtySource, 'src', 'index.js'), join(dirtySource, 'escape.js'))
            let refused
            try {
              sealDirectory(dirtySource, mkdtempSync(join(tmpdir(), 'pa-capsule-dst2-')))
            } catch (error) {
              refused = error
            }
            assert('REFUSES_SYMLINK', refused !== undefined && /symbolic link/.test(String(refused.message)))
          } finally {
            rmSync(dirtySource, { recursive: true, force: true })
            rmSync(destination, { recursive: true, force: true })
          }
          evidence.capsule = { digest: one.manifest.digest, files: one.manifest.files.length, excludesGit: true, refusesLinks: true }
        } finally {
          rmSync(first, { recursive: true, force: true })
          rmSync(second, { recursive: true, force: true })
        }
      },
    ),
  )

  // Real UI activity proxy against the packaged workbench.
  {
    const { root: tempRoot, state } = tempState('pa-w5-e3-')
    const port = await pickPort()
    const apiPort = await pickPort()
    let workbench
    let browser
    try {
      workbench = await startWorkbench({
        root,
        port,
        apiPort,
        stateRoot: state,
        env: { PA_MODEL_CONFIG: join(state, 'no-model.json') },
      })
      const client = new LocalProductClient({ baseURL: workbench.apiURL, stateDir: state, timeoutMs: 20_000 })
      const configuration = await client.configuration()
      const project = configuration.projects.find((item) => item.dispatchAllowed)
      const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)
      const created = await client.dispatch({
        commandId: 'w5e3-timing-work',
        conversationId: 'conv-main',
        kind: 'create_work',
        projectId: project.id,
        profileId: 'profile-fixture-pass',
        goal: 'UI 活动计时：可见且有焦点',
        scope: project.scope,
        criteria: [machine],
      })
      let view
      for (let attempt = 0; attempt < 200; attempt += 1) {
        view = await client.work(created.receipt.workId)
        if (view.actions.available.includes('accept_candidate')) break
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      }
      browser = await openBrowser({ root, viewport: VIEWPORTS.desktop })
      const page = browser.page
      await gotoConsole(page, `http://127.0.0.1:${port}/`)
      await page.locator('.work-card').filter({ hasText: 'UI 活动计时' }).first().click()
      const detail = page.locator('#work-inspector')
      await detail.waitFor()
      await detail.locator('.verification .outcome-PASS').first().waitFor({ timeout: 25_000 })
      await page.bringToFront()
      await page.waitForTimeout(7000)
      await detail.getByRole('button', { name: '接受当前候选' }).click()
      await page.waitForFunction(() => document.querySelector('#work-inspector .phase')?.textContent === '已交付', undefined, {
        timeout: 25_000,
      })
      await screenshot(page, shots, 'desktop-review-activity')
      artifacts.screenshots.push(join(shots, 'desktop-review-activity.png'))
      const accepted = await client.work(created.receipt.workId)
      const events = latestEvents(state, root, 'application.candidate.accepted', 10) ?? []
      const timing = events.find((item) => item.payload?.candidate?.contract?.workId === created.receipt.workId)?.payload?.reviewTiming
      cases.push(
        await runCase(
          {
            evidence: {},
            id: 'E3-REVIEW-ACTIVITY-UI',
            title: 'Visible focused review activity is recorded and does not block acceptance',
            layer: LAYERS.CONTROLLED,
            limitations: [
              'The activity value is a UI visibility proxy, not measured human thinking time.',
              'Overlapping tabs are unioned by the product; this case does not claim exact human time.',
            ],
          },
          async ({ assert, evidence }) => {
            assert('DELIVERED', accepted.phase === 'delivered', accepted.phase)
            assert('ACCEPT_EVENT', timing !== undefined, JSON.stringify(events))
            assert('ACTIVITY_OBSERVED', typeof timing.activeReviewMs === 'number' && timing.activeReviewMs > 0, JSON.stringify(timing))
            assert('ACTIVITY_SOURCE', timing.activeReviewSource === 'ui_visibility_proxy', timing.activeReviewSource)
            assert(
              'ACTIVITY_PARTIAL',
              ['partial', 'unknown'].includes(timing.activeReviewCompleteness),
              timing.activeReviewCompleteness,
            )
            assert(
              'ACTIVITY_WITHIN_WAIT',
              timing.readyToAcceptanceMs !== null && timing.activeReviewMs <= timing.readyToAcceptanceMs,
              JSON.stringify(timing),
            )
            evidence.reviewTiming = {
              candidateReadyAt: timing.candidateReadyAt,
              acceptedAt: timing.acceptedAt,
              readyToAcceptanceMs: timing.readyToAcceptanceMs,
              activeReviewMs: timing.activeReviewMs,
              activeReviewSource: timing.activeReviewSource,
              activeReviewCompleteness: timing.activeReviewCompleteness,
              acceptedEvents: events.length,
              uiCollected: true,
            }
          },
        ),
      )
    } finally {
      await browser?.close()
      await workbench?.stop()
      artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
    }
  }

  const pipeline = notTested(
    {
      id: 'E3-REVIEW-PIPELINE',
      title: 'Author → barrier → freeze → independent review → report → human review',
      layer: LAYERS.NOT_TESTED,
      limitations: [
        'Owner: main/B. No review HTTP/Work pipeline exists in this checkout; contract fixtures and gate validators are prepared.',
      ],
    },
    'No public entry creates a review Work/Ticket/Assignment or publishes ReviewEvidence; the independent pilot preflight is BLOCKED on pricing.',
  )
  pipeline.evidence.reviewPipeline = {
    unavailable: true,
    plannedNegatives: [
      'bad report or no_findings cannot override machine FAIL or required human acceptance',
      'old subject/digest or wrong profile',
      'review attempt reusing the author assignment',
      'missing sealed-copy isolation or input mutation',
      'permission/auth/cancel/unknown-send cases',
      'marker recovery cannot resume the review',
    ],
  }
  cases.push(pipeline)

  return { cases, artifacts }
}
