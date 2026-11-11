#!/usr/bin/env node
/**
 * CLI over the production runtime description (wave-08 B1).
 *
 * This file is a thin formatter. The description itself lives in
 * `packages/driver-kit/src/runtime-diagnostics.ts` so main, the launcher and the runner entry all
 * consume one implementation instead of a test-dir report that claims to be runtime authority.
 *
 * Usage:
 *   node tests/native-acceptance/runtime-diagnostics.mjs            # public projection
 *   node tests/native-acceptance/runtime-diagnostics.mjs --private   # include private machine facts
 *   node tests/native-acceptance/runtime-diagnostics.mjs --json      # machine readable
 */
import { describeRuntime, descriptionDigest } from '../../packages/driver-kit/src/runtime-diagnostics.ts'

const asJson = process.argv.includes('--json')
const includePrivate = process.argv.includes('--private')
const description = describeRuntime({ includePrivate })
const digest = descriptionDigest(description)

if (asJson) {
  process.stdout.write(`${JSON.stringify({ ...description, digest }, null, 2)}\n`)
} else {
  process.stdout.write(`runtime description: ${description.protocol}  digest=${digest.slice(0, 16)}\n`)
  process.stdout.write(`usable executor : ${description.usable ? 'YES' : 'NO'}\n`)
  process.stdout.write(`billable admitted: ${description.billableAdmitted ? 'YES' : 'NO'}\n`)
  if (description.reasons.length > 0) {
    for (const reason of description.reasons) process.stdout.write(`  refused: ${reason}\n`)
  }
  process.stdout.write(`\nidentity: ${description.identity.version ?? '(unknown version)'}\n`)
  process.stdout.write(`  digest ${description.identity.digest ?? '(none)'}\n`)
  process.stdout.write(`  bytes  ${description.identity.bytes ?? '(unknown)'}\n`)
  process.stdout.write(`  path   ${description.identity.realPath ?? '(not disclosed)'}\n`)
  process.stdout.write(`  platform ${description.identity.platform}/${description.identity.arch} node ${description.identity.node}\n`)
  process.stdout.write(`\nhost enforcement: ${description.enforcement.available ? description.enforcement.mechanism : 'unavailable'}\n`)
  process.stdout.write(`  ${description.enforcement.evidence}\n`)
  process.stdout.write('\ncapabilities:\n')
  for (const row of description.capabilities) {
    const bill = row.admitsBilling ? 'BILL' : '    '
    process.stdout.write(`  ${row.state.padEnd(9)} ${bill} ${row.id.padEnd(20)} [${row.layer}] ${row.label}\n`)
  }
  if (description.blockedCapabilities.length > 0) {
    process.stdout.write('\nblocked for billing:\n')
    for (const row of description.blockedCapabilities) {
      process.stdout.write(`  ${row.id} (${row.state})\n    invalidated by: ${row.invalidation}\n`)
    }
  }
  process.stdout.write('\nnot claimed:\n')
  for (const item of description.notClaimed) process.stdout.write(`  - ${item}\n`)
  if (includePrivate) {
    process.stdout.write('\nprivate facts (explicitly requested):\n')
    process.stdout.write(`  home: ${description.private.home}\n`)
    for (const entry of description.private.knownPaths) {
      process.stdout.write(`  ${entry.present ? 'present' : 'absent '} ${entry.path}\n`)
    }
  }
}
