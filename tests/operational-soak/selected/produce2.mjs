#!/usr/bin/env node
/**
 * Produce the wave-29 current-source consumer package.
 *
 *   node tests/operational-soak/selected/produce2.mjs --out <new-directory> [--json]
 *
 * Defaults are the current I/B/H checkouts (no old head pin). It binds exact commits/blobs, materializes
 * those commits read-only into the new root, runs the current I module and current B runner-service,
 * then re-verifies source blobs and materialized bytes. It never edits B/I/main.
 */
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'
import { EXIT, nowIso } from '../../../tools/trial-kit/lib/output.mjs'
import { homeDir, redactValue } from '../../../tools/trial-kit/lib/redact.mjs'
import { bindCurrent, FILES, materializeTree, ROOTS, verifyCurrent, verifyMaterializedTree } from './source2.mjs'
import { runICurrentConsumer } from './i-consumer2.mjs'
import { runBCurrentConsumer } from './b-service-consumer2.mjs'

const USAGE = `produce2 — current selected source 三consumer包
用法: node tests/operational-soak/selected/produce2.mjs --out <新目录> [--i-commit <sha>] [--b-commit <sha>] [--json]
退出: 0 全部按预期, 1 有未预期差异, 2 source/参数拒绝, 3 INTERNAL
`

function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(redactValue(value, { home: homeDir() }), null, 2)}\n`, { mode: 0o600 }) }

function shaMap(files) { return Object.fromEntries(files.map((file) => [file.rel, file.sha256])) }

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { out: 'string', json: 'boolean', help: 'boolean', 'i-commit': 'string', 'b-commit': 'string', 'i-root': 'string', 'b-root': 'string', 'main-root': 'string' }) } catch (error) {
    process.stderr.write(`produce2: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (values.out === undefined) { process.stderr.write('produce2: REFUSED usage: --out <new-directory> is required\n'); return EXIT.REFUSED }
  const out = resolve(values.out)
  try { mkdirSync(out, { mode: 0o700, recursive: false }) } catch (error) {
    process.stderr.write(`produce2: REFUSED ${error?.code === 'EEXIST' ? 'output_exists' : 'output_unavailable'}: ${out}\n`)
    return EXIT.REFUSED
  }
  try {
    const bindings = {
      I: bindCurrent({ role: 'I', root: values['i-root'] ?? undefined, commit: values['i-commit'] ?? null }),
      B: bindCurrent({ role: 'B', root: values['b-root'] ?? undefined, commit: values['b-commit'] ?? null }),
      main: bindCurrent({ role: 'main', root: values['main-root'] ?? undefined }),
    }
    const source = {
      protocol: 'selected-source-current/1', observedAt: nowIso(),
      roots: Object.fromEntries(Object.entries(ROOTS).map(([role, root]) => [role, redactValue(root, { home: homeDir() })])),
      bindings: Object.fromEntries(Object.entries(bindings).map(([role, value]) => [role, {
        ok: value.ok, root: redactValue(value.root, { home: homeDir() }), branch: value.branch, head: value.head, commit: value.commit,
        issues: value.issues, files: value.files, zod: value.zod ?? null,
      }])),
      ok: Object.values(bindings).every((value) => value.ok === true),
    }
    writeJson(join(out, 'source.json'), source)
    if (!source.ok) {
      process.stderr.write(`produce2: REFUSED current source mismatch (${Object.entries(bindings).filter(([, value]) => !value.ok).map(([role, value]) => `${role}:${value.issues.join('|')}`).join('; ')})\n`)
      return EXIT.REFUSED
    }
    const iTree = materializeTree({ root: bindings.I.root, commit: bindings.I.commit, paths: ['apps/runner/src/attach-channel', 'packages/contracts/src'], dest: join(out, 'source', 'I'), nodeModulesFrom: join(bindings.I.root, 'node_modules') })
    const bTree = materializeTree({ root: bindings.B.root, commit: bindings.B.commit, paths: ['apps/runner/src', 'packages/contracts/src', 'packages/driver-kit/src', 'packages/drivers', 'packages/environment-preparation/src', 'packages/execution/src', 'packages/testing/src'], dest: join(out, 'source', 'B'), nodeModulesFrom: join(bindings.B.root, 'node_modules') })
    // Bare workspace imports resolve through the owner's installed package links (dist deps only;
    // consumed source remains the materialized commit).
    for (const [role, tree, binding] of [['I', iTree, bindings.I], ['B', bTree, bindings.B]]) {
      void role
      for (const link of [['apps/runner/node_modules'], ['packages/node_modules']]) {
        try { symlinkSync(join(binding.root, link[0]), join(tree.dest, link[0]), 'dir') } catch { /* optional */ }
      }
      // Materialized packages resolve their own workspace links from the owner's per-package node_modules.
      const walk = (absolute) => {
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue
          const child = join(absolute, entry.name)
          const rel = relative(tree.dest, child)
          const ownerModules = join(binding.root, rel, 'node_modules')
          if (existsSync(ownerModules)) {
            try { symlinkSync(ownerModules, join(child, 'node_modules'), 'dir') } catch { /* optional */ }
          }
          if (rel.split('/').length <= 3) walk(child)
        }
      }
      walk(join(tree.dest, 'packages'))
    }
    const materialized = {
      I: { ...iTree, verify: iTree.ok ? verifyMaterializedTree(iTree, shaMap(bindings.I.files)) : { ok: false, issues: iTree.issues } },
      B: { ...bTree, verify: bTree.ok ? verifyMaterializedTree(bTree, shaMap(bindings.B.files)) : { ok: false, issues: bTree.issues } },
    }
    const materializedOk = Object.values(materialized).every((entry) => entry.ok && entry.verify.ok)
    if (!materializedOk) {
      writeJson(join(out, 'materialized.json'), materialized)
      process.stderr.write('produce2: REFUSED materialized committed source mismatch\n')
      return EXIT.REFUSED
    }

    const i = await runICurrentConsumer({ treeRoot: iTree.dest })
    const b = await runBCurrentConsumer({ treeRoot: bTree.dest, root: join(out, 'b-service') })
    const afterBindings = { I: verifyCurrent(bindings.I), B: verifyCurrent(bindings.B), main: verifyCurrent(bindings.main) }
    const afterMaterialized = {
      I: verifyMaterializedTree(iTree, shaMap(bindings.I.files)),
      B: verifyMaterializedTree(bTree, shaMap(bindings.B.files)),
    }
    writeJson(join(out, 'i.json'), i)
    writeJson(join(out, 'b.json'), b)
    writeJson(join(out, 'materialized.json'), materialized)
    const checks = {
      sourcesOk: Object.values(bindings).every((value) => value.ok === true),
      sourcesUnchanged: Object.values(afterBindings).every((value) => value.ok === true),
      materializedUnchanged: Object.values(afterMaterialized).every((value) => value.ok === true),
      iChecks: Object.values(i.checks).every(Boolean),
      bChecks: Object.values(b.checks).every(Boolean),
      bSinkFinding: b.findings.some((entry) => entry.id === 'B29-SINK-ONLY-NATIVE-HOOK-AUTOBYPASS'),
      zeroModel: i.modelCalls === 0 && b.modelCalls === 0 && i.vendorTurns === 0 && b.vendorTurns === 0,
      zeroSignals: i.signalsSent === 0 && b.signalsSent === 0,
    }
    const report = {
      protocol: 'selected-current-report/1', generatedAt: nowIso(), root: redactValue(out, { home: homeDir() }),
      selected: {
        I: { commit: bindings.I.commit, branch: bindings.I.branch, files: bindings.I.files, zod: bindings.I.zod },
        B: { commit: bindings.B.commit, branch: bindings.B.branch, files: bindings.B.files, zod: bindings.B.zod },
        main: { commit: bindings.main.commit, branch: bindings.main.branch, files: bindings.main.files },
      },
      results: { i: i.cases, b: { normal: b.normal.counts, deny: b.deny.counts, sinkOnly: b.sinkOnly.counts } },
      findings: [...b.findings],
      checks, ok: Object.values(checks).every(Boolean),
      notReached: [
        'same-Runner dual client as a real process handover on a product/B route',
        'SIGKILL original Work/question recovery; no product/B SIGKILL executed',
        'recovered candidate/accept; B ordinary5PASS is not recovery',
        'real product readonly/SSE target and vendor/native',
      ],
      note: 'B now imports the current I attach-channel blobs; sink-only native hook still resolves without an external guard and is reported, not fixed.',
      modelCalls: 0, vendorTurns: 0, signalsSent: 0,
    }
    writeJson(join(out, 'report.json'), report)
    if (values.json === true) process.stdout.write(`${JSON.stringify(redactValue(report, { home: homeDir() }), null, 2)}\n`)
    else process.stdout.write([
      `current-produce: ${report.ok ? 'OK' : 'UNEXPECTED'}`,
      `  I ${bindings.I.commit?.slice(0, 12)} checks=${Object.values(i.checks).filter(Boolean).length}/${Object.keys(i.checks).length} freshIntentFixed=${i.checks.freshIntentFixed}`,
      `  B ${bindings.B.commit?.slice(0, 12)} checks=${Object.values(b.checks).filter(Boolean).length}/${Object.keys(b.checks).length} sinkOnlyFinding=${checks.bSinkFinding}`,
      `  source/materialized unchanged=${checks.sourcesUnchanged && checks.materializedUnchanged}; model=0 signals=0`,
      '  NOT_REACHED: same-Runner route, SIGKILL recovery, recovered candidate/accept, product target',
    ].join('\n'))
    return report.ok ? EXIT.OK : EXIT.DEGRADED
  } catch (error) {
    process.stderr.write(`produce2: REFUSED ${String(error?.code ?? error?.message ?? error)}\n`)
    return EXIT.DEGRADED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`produce2: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
