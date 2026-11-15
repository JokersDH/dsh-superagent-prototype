#!/usr/bin/env node
/**
 * Produce the wave-28 selected-source consumer package.
 *
 *   node tests/operational-soak/selected/produce.mjs --out <new-directory> [--i-root ...] [--b-root ...] [--main-root ...]
 *
 * Verifies the exact selected source (HEAD + git blob) before importing anything, runs the actual I
 * module and the actual B business-channel module with local frames, and re-verifies the sources
 * afterwards. A wrong root/blob or a mid-run change refuses the whole result. It never edits B/I/main.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { EXIT, nowIso } from '../../../tools/trial-kit/lib/output.mjs'
import { homeDir, redactPath, redactValue } from '../../../tools/trial-kit/lib/redact.mjs'
import { DEFAULT_ROOTS, EXPECTED, bindSource, materializeFiles, verifyCommitted, verifyMaterialized } from './source.mjs'
import { runIConsumer } from './i-consumer.mjs'
import { runBConsumer } from './b-consumer.mjs'

const USAGE = `produce — selected source 三consumer包
用法: node tests/operational-soak/selected/produce.mjs --out <新目录> [--i-root <I> --b-root <B> --main-root <main>] [--json]
输出: source.json, i.json, b.json, report.json
退出: 0 全部按预期, 1 有未预期差异, 2 source/参数拒绝, 3 INTERNAL
`

function outJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }) }

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { out: 'string', json: 'boolean', help: 'boolean', 'i-root': 'string', 'b-root': 'string', 'main-root': 'string' }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (values.out === undefined) { process.stderr.write('produce: REFUSED usage: --out <new-directory> is required\n'); return EXIT.REFUSED }
  const out = resolve(values.out)
  try { mkdirSync(out, { mode: 0o700, recursive: false }) } catch (error) {
    process.stderr.write(`produce: REFUSED ${error?.code === 'EEXIST' ? 'output_exists' : 'output_unavailable'}: ${out}\n`)
    return EXIT.REFUSED
  }
  try {
    const roots = { I: values['i-root'] ?? DEFAULT_ROOTS.I, B: values['b-root'] ?? DEFAULT_ROOTS.B, main: values['main-root'] ?? DEFAULT_ROOTS.main }
    const committed = {
      I: verifyCommitted({ role: 'I', root: roots.I, commit: EXPECTED.I.commit, branch: EXPECTED.I.branch, head: EXPECTED.I.head, blobs: EXPECTED.I.blobs }),
      B: verifyCommitted({ role: 'B', root: roots.B, commit: EXPECTED.B.commit, branch: EXPECTED.B.branch, head: EXPECTED.B.head, blobs: EXPECTED.B.blobs }),
      main: bindSource({ role: 'main', root: roots.main, expect: { head: EXPECTED.main.head, blobs: EXPECTED.main.blobs } }),
    }
    const materialized = {
      I: materializeFiles({ root: roots.I, commit: EXPECTED.I.commit, files: EXPECTED.I.materialize, dest: join(out, 'source', 'I'), nodeModulesFrom: join(process.cwd(), 'node_modules') }),
      B: materializeFiles({ root: roots.B, commit: EXPECTED.B.commit, files: EXPECTED.B.materialize, dest: join(out, 'source', 'B'), nodeModulesFrom: join(process.cwd(), 'node_modules') }),
    }
    const sourceReport = {
      protocol: 'selected-source/2', observedAt: nowIso(),
      expected: EXPECTED, roots: Object.fromEntries(Object.entries(roots).map(([role, root]) => [role, redactPath(root, homeDir())])),
      committed: Object.fromEntries(Object.entries(committed).map(([role, value]) => [role, { ok: value.ok, head: value.head, commit: value.commit, issues: value.issues, blobs: value.blobs, dirtyEntries: value.dirtyEntries ?? 0 }])),
      materialized: Object.fromEntries(Object.entries(materialized).map(([role, value]) => [role, { ok: value.ok, commit: value.commit, issues: value.issues, files: value.files }])),
      note: 'I worktree has uncommitted attach-channel edits; the admitted commit is materialized read-only for import, never the dirty tree.',
      ok: Object.values(committed).every((value) => value.ok === true) && Object.values(materialized).every((value) => value.ok === true),
    }
    outJson(join(out, 'source.json'), redactValue(sourceReport, { home: homeDir() }))
    if (!sourceReport.ok) {
      process.stderr.write(`produce: REFUSED selected source did not match (${[...Object.entries(committed), ...Object.entries(materialized)].filter(([, value]) => !value.ok).map(([role, value]) => `${role}:${value.issues.join('|')}`).join('; ')})\n`)
      return EXIT.REFUSED
    }

    const i = await runIConsumer({ iRoot: materialized.I.dest })
    const b = await runBConsumer({ bRoot: materialized.B.dest })
    outJson(join(out, 'i.json'), i)
    outJson(join(out, 'b.json'), b)

    const unchanged = {
      I: verifyCommitted({ role: 'I', root: roots.I, commit: EXPECTED.I.commit, branch: EXPECTED.I.branch, head: EXPECTED.I.head, blobs: EXPECTED.I.blobs }),
      B: verifyCommitted({ role: 'B', root: roots.B, commit: EXPECTED.B.commit, branch: EXPECTED.B.branch, head: EXPECTED.B.head, blobs: EXPECTED.B.blobs }),
      main: bindSource({ role: 'main', root: roots.main, expect: { head: EXPECTED.main.head, blobs: EXPECTED.main.blobs } }),
      I_materialized: verifyMaterialized(materialized.I.dest, EXPECTED.I.materialize),
      B_materialized: verifyMaterialized(materialized.B.dest, EXPECTED.B.materialize),
    }
    const iBaseChecks = { ...i.checks }
    delete iBaseChecks.freshIntentDefectObserved
    const checks = {
      sourcesUnchanged: Object.values(unchanged).every((value) => value.ok === true),
      iBase: Object.values(iBaseChecks).every(Boolean),
      iFreshIntentDefectObserved: i.checks.freshIntentDefectObserved === true,
      bBase: Object.values(b.checks).every(Boolean),
      zeroModel: i.modelCalls === 0 && b.modelCalls === 0 && i.vendorTurns === 0 && b.vendorTurns === 0,
      zeroSignals: i.signalsSent === 0 && b.signalsSent === 0,
    }
    const report = {
      protocol: 'selected-consumer-report/1',
      generatedAt: nowIso(),
      source: 'tests/operational-soak/selected/produce.mjs',
      root: redactPath(out, homeDir()),
      selected: {
        I: { head: committed.I.head, commit: EXPECTED.I.commit, blobs: committed.I.blobs, materialized: materialized.I.files, surface: i.surface },
        B: { head: committed.B.head, commit: EXPECTED.B.commit, blobs: committed.B.blobs, materialized: materialized.B.files, surface: b.surface },
        main: { head: committed.main.head, files: committed.main.files },
      },
      unchanged,
      results: { i: i.cases, b: b.cases },
      checks, ok: Object.values(checks).every(Boolean),
      findings: i.defects.map((id) => ({ id, owner: 'I', detail: i.cases.find((entry) => entry.id === id) })),
      notReached: [
        'B runner-service importing I attach-channel (unique selected implementation absent)',
        'same-Runner dual client through B actual service route',
        'B actual service-page budget/CAS/foreign-source fixes (B-owned)',
        'SIGKILL cross-process original Work recovery; no signal executed here',
      ],
      modelCalls: 0, vendorTurns: 0, signalsSent: 0,
      limits: ['in-process modules only; no daemon, no route, no user state, no credential', 'B module consumption is createBusinessChannel, not the full runner-service route'],
    }
    outJson(join(out, 'report.json'), redactValue(report, { home: homeDir() }))
    if (values.json === true) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else process.stdout.write([
      `selected-produce: ${report.ok ? 'OK' : 'UNEXPECTED'}`,
      `  I ${committed.I.head?.slice(0, 12)} checks=${Object.entries(iBaseChecks).filter(([, value]) => value).length}/${Object.keys(iBaseChecks).length} defect=${i.checks.freshIntentDefectObserved}`,
      `  B ${committed.B.head?.slice(0, 12)} checks=${Object.values(b.checks).filter(Boolean).length}/${Object.keys(b.checks).length}`,
      `  sources unchanged=${checks.sourcesUnchanged}; model=${report.modelCalls} signals=${report.signalsSent}`,
      `  NOT_REACHED: B runner-service importing I, same-Runner route, SIGKILL recovery`,
      `  root: ${redactPath(out, homeDir())}`,
    ].join('\n'))
    return report.ok ? EXIT.OK : EXIT.DEGRADED
  } catch (error) {
    process.stderr.write(`produce: REFUSED ${String(error?.code ?? error?.message ?? error)}\n`)
    return EXIT.DEGRADED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`produce: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
