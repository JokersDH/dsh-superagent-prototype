#!/usr/bin/env node
/**
 * Reconstruct the wave03-b-native ledger from product-side evidence (wave-06 B).
 *
 * Why this exists: the grant named a ledger file that was never committed, so its remainder was
 * being inferred from a status document. This tool builds the ledger that should have existed and
 * states, per grant, exactly what can and cannot be attributed.
 *
 * Attribution rule (deliberately strict): a native send is attributed to this grant only when a
 * PRODUCT artifact records it - a reservation row, or a recorded attempt with command/attempt
 * identity. Two tempting sources are explicitly rejected:
 *
 *   - the developer's personal `~/.codex/sessions` store. That is the user's own data, it is
 *     written by their desktop client, and it mixes unrelated work. Absence there proves nothing.
 *   - any status document that merely asserts a number. An assertion is not a record.
 *
 * The consequence is honest: the historical usage cannot be verified retrospectively, so the
 * grant is reconstructed with an UNKNOWN remainder and stays unspendable. The value of running
 * this now is that every future send has somewhere durable to land.
 *
 * Usage:
 *   node tests/native-acceptance/ledger-reconstruct.mjs            # report only
 *   node tests/native-acceptance/ledger-reconstruct.mjs --write     # create/refresh the ledger
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const repo = new URL('../../', import.meta.url).pathname
const LEDGER = `${repo}tests/native-acceptance/reports/model-budget.json`
const REPORTS = `${repo}tests/native-acceptance/reports`
const write = process.argv.includes('--write')

const GRANTS = [
  { grantId: 'wave03-b-native', limit: 4, scope: 'B control/closure native attempts', dispatched: '2026-11-10' },
  {
    grantId: 'wave05-independent-review-pilot-01',
    limit: 24,
    scope: 'E-owned pilot: bounded native turn starts',
    dispatched: '2026-11-10',
    owner: 'E',
    notB: true,
  },
]

/** Collect product-side records that could carry a native attempt identity. */
function collectProductRecords() {
  const records = []
  if (!existsSync(REPORTS)) return records
  for (const name of readdirSync(REPORTS)) {
    if (!name.endsWith('.json')) continue
    const path = join(REPORTS, name)
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    // Walk only for explicit attempt/command identity fields, never for prose.
    const visit = (node, trail) => {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, `${trail}[${index}]`))
        return
      }
      const attemptId = node.attemptId ?? node.nativeTurnRef ?? null
      const commandId = node.commandId ?? null
      const workId = node.workId ?? null
      // A record is only an attempt if it names an attempt/native turn AND a command or work.
      if (attemptId && (commandId || workId)) {
        records.push({ file: name, at: trail, attemptId, commandId, workId, state: node.state ?? node.status ?? null })
      }
      for (const [key, value] of Object.entries(node)) visit(value, `${trail}.${key}`)
    }
    visit(parsed, '$')
  }
  return records
}

const productRecords = collectProductRecords()
const existing = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : null
const existingGrants = new Map((existing?.grants ?? []).map(grant => [grant.grantId, grant]))

const reconstructed = GRANTS.map(grant => {
  const prior = existingGrants.get(grant.grantId)
  // Recorded reservations win if they exist: they are the durable record.
  const reserved = Array.isArray(prior?.tasks) ? prior.tasks : []
  const attributable = productRecords.filter(record =>
    grant.notB ? false : true, // B never attributes E's grant
  )
  return {
    grantId: grant.grantId,
    limit: grant.limit,
    scope: grant.scope,
    dispatched: grant.dispatched,
    ...(grant.owner ? { owner: grant.owner } : {}),
    ...(grant.notB
      ? {
          tasks: reserved,
          remainder: 'UNKNOWN - owned by E; B never attributes or consumes this grant',
          attributionState: 'NOT_B_GRANT',
        }
      : {
          tasks: reserved,
          remainder: reserved.length === 0 ? 'UNKNOWN' : String(grant.limit - reserved.filter(task => task.state !== 'aborted').length),
          attributionState: reserved.length > 0 ? 'RECORDED' : 'UNVERIFIED',
          reconstruction: {
            method: 'product-side reservation/attempt records only',
            ledgerExistedBefore: Boolean(existing),
            productAttemptRecordsFound: attributable.length,
            productAttemptRecords: attributable.slice(0, 20),
            rejectedSources: [
              'developer ~/.codex/sessions store: user-owned, mixed with unrelated desktop work, and ephemeral threads leave no trace there, so absence proves nothing',
              'status documents asserting a count: an assertion is not a record',
            ],
            limitaion:
              'Historical sends cannot be verified retrospectively. The remainder is therefore UNKNOWN and the grant stays unspendable until real reservations accumulate here.',
          },
        }),
  }
})

const ledger = {
  note: 'one grant per explicitly dispatched package; never reset by date, retry or phase change',
  reconstructedAt: new Date().toISOString(),
  reconstructionBy: 'tests/native-acceptance/ledger-reconstruct.mjs',
  grants: reconstructed,
}

if (write) {
  mkdirSync(dirname(LEDGER), { recursive: true })
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`)
}

const summary = {
  mode: write ? 'WRITE' : 'REPORT',
  ledgerPath: 'tests/native-acceptance/reports/model-budget.json',
  ledgerExistedBefore: Boolean(existing),
  productAttemptRecordsFound: productRecords.length,
  grants: reconstructed.map(grant => ({
    grantId: grant.grantId,
    limit: grant.limit,
    recordedTasks: grant.tasks.length,
    remainder: grant.remainder,
    attributionState: grant.attributionState,
  })),
  verdict:
    'wave03-b-native is UNVERIFIED with an UNKNOWN remainder. Real sends stay blocked. E\'s pilot grant is untouched and not attributable by B.',
}

if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
else {
  process.stdout.write(`mode=${summary.mode} ledgerExistedBefore=${summary.ledgerExistedBefore}\n`)
  process.stdout.write(`product attempt records found=${summary.productAttemptRecordsFound}\n\n`)
  for (const grant of summary.grants) {
    process.stdout.write(`${grant.grantId.padEnd(34)} limit=${String(grant.limit).padEnd(3)} recorded=${grant.recordedTasks} remainder=${grant.remainder} [${grant.attributionState}]\n`)
  }
  process.stdout.write(`\n${summary.verdict}\n`)
  if (write) process.stdout.write(`\nledger written to ${summary.ledgerPath}\n`)
  else process.stdout.write('\n(report only; pass --write to create the ledger)\n')
}
