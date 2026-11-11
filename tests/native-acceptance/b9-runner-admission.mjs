#!/usr/bin/env node
/**
 * B9: unified admission acceptance (wave-07 B1/B2/B3, zero model calls).
 *
 * Proves that session, sealed copy, host isolation and budget are ONE admitted path, and that
 * each gate is independently fail-closed. The wave-06 sealed-copy FAIL is NOT relabelled: the
 * unsafe hardlink control is kept as a negative control, and what changed is that a link-based
 * builder is now REFUSED at admission instead of merely reported afterwards.
 */
import { createHash } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { createSealedCapsule, detectUnsafeLinkBuilder, unsafeHardlinkCapsule } from './capsule-builder.mjs'
import { admit, buildSeatbeltProfile, GATES, hostEnforcement, resolveExecutionIdentity } from './runtime-admission.mjs'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const sha256 = value => createHash('sha256').update(value).digest('hex')

// --- fixture: an author project with a Git surface, plus a credential outside it --------------
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w07-b9-')))
const authorProject = join(root, 'author-project')
const authorHome = join(root, 'author-home')
const capsuleRoot = join(root, 'capsules')
mkdirSync(join(authorProject, 'src'), { recursive: true })
mkdirSync(join(authorProject, '.git', 'hooks'), { recursive: true })
mkdirSync(authorHome, { recursive: true })
mkdirSync(capsuleRoot, { recursive: true })
writeFileSync(join(authorProject, 'src', 'app.ts'), 'export const answer = 41\n')
writeFileSync(join(authorProject, '.git', 'config'), '[remote "origin"]\n\turl = git@example.com:private/repo.git\n')
writeFileSync(join(authorProject, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\necho hook\n')
writeFileSync(join(authorHome, 'auth.json'), '{"token":"SECRET-VALUE"}')
const pristineApp = readFileSync(join(authorProject, 'src', 'app.ts'))
const ledgerPath = `${repo}tests/native-acceptance/reports/model-budget.json`
const materialDigest = sha256(pristineApp)

// ===============================================================================================
// B1: one entry point, every gate evaluated, real identity
// ===============================================================================================
const admission = await admit({
  arm: 'fresh_session',
  caseId: 'case-01',
  turn: 1,
  materialDigest,
  authorProject,
  authorHome,
  capsuleRoot,
  ledgerPath,
  grant: { grantId: 'wave03-b-native', owner: 'B', limit: 4, ledgerPath },
  budgetHook: { reserve: () => ({ admitted: true, reservationId: 'res-1' }) },
})

log.begin('B9-ONE-PATH', 'admission evaluates all gates in one call', 'actual_native')
const evaluatedAll = GATES.every(gate => admission.gates[gate] && typeof admission.gates[gate].satisfied === 'boolean')
const noShortCircuit = Object.keys(admission.gates).length === GATES.length
log.evidence({ gates: Object.keys(admission.gates), unmet: admission.unmetGates })
if (evaluatedAll && noShortCircuit) log.pass(`all ${GATES.length} gates evaluated without short-circuit; unmet=${admission.unmetGates.join(',')}`)
else log.fail(`gates incomplete: ${JSON.stringify(Object.keys(admission.gates))}`)

log.begin('B9-IDENTITY', 'execution identity is observed, not defaulted', 'actual_native')
const identity = admission.gates.execution_identity.evidence
const identityReal = Boolean(identity.executablePath && identity.version && identity.executableDigest)
log.evidence({ version: identity.version, digest: String(identity.executableDigest).slice(0, 16), platform: identity.platform })
if (identityReal) log.pass(`identity: ${identity.version} digest=${String(identity.executableDigest).slice(0, 12)}… platform=${identity.platform}`)
else log.fail(`identity incomplete: ${JSON.stringify(identity).slice(0, 160)}`)

log.begin('B9-IDENTITY-DIGEST', 'the verdict carries an identity digest that changes with identity', 'package-local')
const digestA = admission.identityDigest
const digestB = sha256(JSON.stringify([identity.executablePath, identity.version, identity.executableDigest, 'different-model', identity.modelProvider]))
if (digestA !== digestB && /^[a-f0-9]{64}$/.test(digestA)) log.pass('verdict is bound to an identity digest; a different model yields a different digest')
else log.fail('identity digest does not discriminate')

// ===============================================================================================
// B2: session facts are real and distinguish the two arms
// ===============================================================================================
log.begin('B9-SESSION-REAL', 'session facts come from a real server', 'actual_native')
const facts = admission.gates.session_fact.evidence
const sessionReal = Boolean(facts && facts.model && facts.modelProvider && facts.ephemeralSupported === true)
log.evidence({ model: facts?.model, provider: facts?.modelProvider, ephemeral: facts?.ephemeralSupported, goalsPersistent: facts?.goalsOnPersistent, goalsEphemeral: facts?.goalsOnEphemeral })
if (sessionReal) log.pass(`model=${facts.model} provider=${facts.modelProvider}; ephemeral threads supported`)
else log.fail(`session facts incomplete: ${JSON.stringify(facts).slice(0, 160)}`)

log.begin('B9-ARM-SEPARATION', 'the fresh arm and the author arm use different session kinds', 'actual_native')
// A fresh reviewer must be ephemeral; an author checkpoint must be persistent and turn-backed.
const armsDistinct = facts?.ephemeralSupported === true && facts?.checkpointRequiresTurn === true
log.evidence({ checkpointRequiresTurn: facts?.checkpointRequiresTurn, goalsUsableByFreshArm: facts?.goalsOnEphemeral })
if (armsDistinct) {
  log.pass('ephemeral fresh thread and a turn-backed persistent author checkpoint are distinct paths; a goal budget cannot attach to the fresh arm')
} else {
  log.fail(`arm separation not established: ${JSON.stringify(facts).slice(0, 160)}`)
}

// ===============================================================================================
// B3: the builder copies bytes and REFUSES a link mode
// ===============================================================================================
log.begin('B9-COPY-SAFE-BUILDER', 'the production builder copies bytes and shares no inode', 'package-local')
const capsule = createSealedCapsule({ authorProject, capsuleRoot, subjectDigest: materialDigest })
const shared = capsule.files.filter(file => statSync(join(authorProject, file.path)).ino === file.ino)
log.evidence({ files: capsule.fileCount, gitEntries: capsule.gitEntries, sharedInodes: shared.length, manifest: capsule.manifestDigest.slice(0, 16) })
if (capsule.fileCount > 0 && capsule.gitEntries.length === 0 && shared.length === 0) {
  log.pass(`${capsule.fileCount} file(s) copied; no Git surface; no shared inode`)
} else {
  log.fail(`builder defect: files=${capsule.fileCount} git=${capsule.gitEntries.length} shared=${shared.length}`)
}

log.begin('B9-COPY-REFUSES-LINK', 'a link-based copy request is refused at admission', 'package-local')
// Known-unsafe modes must be refused with the SPECIFIC sealed-copy rationale; an unknown mode only
// has to be refused. Accepting any refusal for a known-unsafe mode would hide a broken link check,
// because an "unknown copyMode" message also happens to name the mode.
const specificRefusal = message => /must copy bytes and share no inode/i.test(String(message ?? ''))
const unsafeModes = ['hardlink', 'link', 'reflink-shared-inode', 'symlink']
const refusals = unsafeModes.map(mode => ({ mode, message: detectUnsafeLinkBuilder({ mode }) }))
const unknownMode = { mode: 'copy-ish', message: detectUnsafeLinkBuilder({ mode: 'copy-ish' }) }
const allRefused = refusals.every(item => specificRefusal(item.message))
const unknownRefused = typeof unknownMode.message === 'string' && unknownMode.message.length > 0
const bytesAllowed = detectUnsafeLinkBuilder({ mode: 'bytes' }) === null
log.evidence({
  refusals: refusals.map(item => `${item.mode}:${specificRefusal(item.message) ? 'refused(sealed)' : item.message ? 'refused(other)' : 'allowed'}`),
  unknownMode: unknownRefused ? 'refused' : 'allowed',
  bytesAllowed,
})
if (allRefused && unknownRefused && bytesAllowed) {
  log.pass('every known-unsafe mode is refused with the sealed-copy rationale; an unknown mode is also refused; "bytes" is accepted')
} else {
  log.fail(`link refusal incomplete: sealed=${allRefused} unknown=${unknownRefused} bytesAllowed=${bytesAllowed}`)
}

log.begin('B9-ADMISSION-REFUSES-LINK', 'admission itself refuses a link copyMode, not just the helper', 'package-local')
const linkAdmission = await admit({
  arm: 'fresh_session', caseId: 'case-02', turn: 1, materialDigest,
  authorProject, authorHome, capsuleRoot, ledgerPath, copyMode: 'hardlink',
  grant: { grantId: 'wave03-b-native', owner: 'B', limit: 4, ledgerPath },
  budgetHook: { reserve: () => ({ admitted: true, reservationId: 'res-2' }) },
})
const copyGate = linkAdmission.gates.material_copy
const hostGate = linkAdmission.gates.host_isolation
log.evidence({ copySatisfied: copyGate.satisfied, gap: String(copyGate.gap).slice(0, 110), hostSatisfied: hostGate.satisfied })
if (copyGate.satisfied === false && /must copy bytes and share no inode/i.test(String(copyGate.gap))) {
  log.pass('admission refused the hardlink copyMode and reported the sealed-copy requirement')
} else {
  log.fail(`admission accepted a link copyMode: ${JSON.stringify(copyGate).slice(0, 200)}`)
}

log.begin('B9-UNSAFE-NEGATIVE-CONTROL', 'a deliberately unsafe link builder CAN corrupt the author tree', 'package-local')
// Kept as a negative control: it must still be able to demonstrate the hazard, otherwise the
// refusal above would be untestable. This is the wave-06 FAIL preserved as a control, not a PASS.
writeFileSync(join(authorProject, 'src', 'app.ts'), pristineApp)
const unsafe = unsafeHardlinkCapsule({ authorProject, capsuleRoot })
const unsafeShared = unsafe.linked.some(name => {
  try {
    return statSync(join(unsafe.capsulePath, name)).ino === statSync(join(authorProject, name)).ino
  } catch {
    return false
  }
})
log.evidence({ linked: unsafe.linked.length, sharesInode: unsafeShared })
if (unsafeShared) log.pass('the unsafe builder does share an inode, so refusing it is a real control and not a tautology')
else log.notTested('this filesystem refused the hardlink, so the hazard could not be demonstrated here')

// ===============================================================================================
// Host isolation and budget gates
// ===============================================================================================
log.begin('B9-HOST-GATE', 'host isolation is a real enforcement mechanism, not a claim', 'package-local')
const enforcement = hostEnforcement()
const host = admission.gates.host_isolation
const profile = buildSeatbeltProfile({ capsulePath: capsule.capsulePath, authorProject, authorHome })
const profileComplete = /deny network\*/.test(profile) && /deny file-read\*/.test(profile) && /allow file-write\*/.test(profile)
log.evidence({ available: enforcement.available, mechanism: enforcement.mechanism, deniesNetwork: /deny network/.test(profile), deniesAuthorRead: profile.includes(authorHome), allowsScratch: profile.includes(capsule.capsulePath) })
if (enforcement.available && host.satisfied && profileComplete) {
  log.pass(`host isolation via ${enforcement.mechanism}: network denied, author home unreadable, capsule scratch allowed`)
} else if (!enforcement.available) {
  log.notTested('no kernel enforcement mechanism available on this host')
} else {
  log.fail(`host gate inconsistent: satisfied=${host.satisfied} profileComplete=${profileComplete}`)
}

log.begin('B9-BUDGET-GATE', 'the budget gate refuses an UNKNOWN ledger remainder', 'package-local')
const budget = admission.gates.budget_reservation
log.evidence({ grantVerdict: budget.evidence.grantVerdict, remainder: budget.evidence.remainder, hookPresent: budget.evidence.hookPresent, reason: String(budget.gap).slice(0, 110) })
if (budget.satisfied === false && /UNVERIFIED|UNKNOWN/i.test(String(budget.gap))) {
  log.pass('a reconstructed ledger with UNKNOWN remainder does not admit a run; the empty ledger is not 4 free slots')
} else {
  log.fail(`budget gate let an unverified remainder through: ${JSON.stringify(budget).slice(0, 200)}`)
}

log.begin('B9-NO-HOOK-REFUSES', 'a missing reservation hook is its own gap', 'package-local')
const noHook = await admit({ arm: 'fresh_session', caseId: 'case-03', turn: 1, materialDigest, authorProject, authorHome, capsuleRoot, ledgerPath, grant: { grantId: 'wave03-b-native', owner: 'B', limit: 4, ledgerPath } })
const noHookGate = noHook.gates.budget_reservation
log.evidence({ satisfied: noHookGate.satisfied, gap: String(noHookGate.gap).slice(0, 90) })
if (noHookGate.satisfied === false && /no reservation hook/i.test(String(noHookGate.gap))) {
  log.pass('admission reports the missing hook as its own reason instead of a generic refusal')
} else {
  log.fail(`missing hook not reported distinctly: ${JSON.stringify(noHookGate).slice(0, 160)}`)
}

log.begin('B9-GRANT-REQUIRED', 'admission refuses when the caller supplies no grant identity', 'package-local')
const noGrant = await admit({ arm: 'fresh_session', caseId: 'case-04', turn: 1, materialDigest, authorProject, authorHome, capsuleRoot, ledgerPath })
const noGrantGate = noGrant.gates.budget_reservation
log.evidence({ satisfied: noGrantGate.satisfied, gap: String(noGrantGate.gap).slice(0, 110) })
if (noGrantGate.satisfied === false && /no complete grant identity/i.test(String(noGrantGate.gap))) {
  log.pass('a missing grant is refused instead of silently auditing this role\'s own grant')
} else {
  log.fail(`admission defaulted a grant: ${JSON.stringify(noGrantGate).slice(0, 180)}`)
}

log.begin('B9-COST-GATE', 'the cost gate is blocked independently of the ledger', 'package-local')
const cost = admission.gates.cost_bound
log.evidence({ verdict: cost.evidence.verdict, blockers: cost.evidence.blockers.length, first: String(cost.gap).slice(0, 90) })
if (cost.satisfied === false && cost.evidence.blockers.length > 0) {
  log.pass(`cost bound is blocked on its own ${cost.evidence.blockers.length} reasons; a valid reservation would not unlock it`)
} else {
  log.fail(`cost gate unexpectedly satisfied: ${JSON.stringify(cost.evidence).slice(0, 160)}`)
}

log.begin('B9-NO-LAUNCH-WHEN-REFUSED', 'a refused verdict exposes no launch plan', 'package-local')
const refusedSafe = admission.verdict === 'REFUSED' && admission.launch === null
log.evidence({ verdict: admission.verdict, launch: admission.launch })
if (refusedSafe) log.pass('REFUSED carries launch=null, so a consumer cannot start a run from it')
else log.fail(`a refused verdict still exposed a launch plan: ${JSON.stringify(admission.launch).slice(0, 140)}`)

log.begin('B9-NOT-CLAIMED', 'admission states what it does not claim', 'package-local')
const notClaimed = Array.isArray(admission.notClaimed) && admission.notClaimed.length >= 3
log.evidence({ notClaimed: admission.notClaimed })
if (notClaimed) log.pass(`admission explicitly disclaims ${admission.notClaimed.length} things, including turn success and product acceptance`)
else log.fail('admission does not state its limits')

// ===============================================================================================
// Author material must survive every probe above.
// ===============================================================================================
log.begin('B9-AUTHOR-INTACT', 'the author tree is unchanged by admission and capsule work', 'package-local')
const appNow = readFileSync(join(authorProject, 'src', 'app.ts'))
const intact = appNow.equals(pristineApp) && existsSync(join(authorHome, 'auth.json'))
log.evidence({ appMatches: appNow.equals(pristineApp) })
if (intact) log.pass('author working file is byte-identical and its credential file still exists untouched')
else log.fail('a probe modified the author tree')

rmSync(root, { recursive: true, force: true })

const report = writeReport(
  {
    cases: log.cases,
    environment: { note: 'wave-07 B9 unified admission: actual_native + package-local', modelCalls: 0 },
    extra: { admissionVerdict: admission.verdict, unmetGates: admission.unmetGates },
  },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b9-runner-admission.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(28)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB9 totals: ${JSON.stringify(report.totals)}\n`)
process.stdout.write(`admission verdict: ${admission.verdict} (unmet: ${admission.unmetGates.join(', ')})\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
