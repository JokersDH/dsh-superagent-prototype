#!/usr/bin/env node
/**
 * trial-field-kit — one bounded, redacted support bundle for a colleague trial.
 * Usage: node tools/trial-kit/bin/trial-field-kit.mjs --tar <tar> --artifact <json> --out <new-dir>
 *        [--readiness-fixture] [--expect-sha256/--expect-build/--expect-schema/--expect-source]
 *        [--source-consumer --i-commit --b-commit --i-root --b-root --main-root] [--timeout-ms]
 */
import { EXIT, createOutputRoot, printHuman } from '../lib/output.mjs'
import { parseOptions } from '../lib/args.mjs'
import { runFieldKit } from '../lib/field-kit.mjs'

const USAGE = `trial-field-kit — 一次有界、脱敏的同事试用现场包
用法: node tools/trial-kit/bin/trial-field-kit.mjs --tar <包.tar.gz> --artifact <install-artifact.json> --out <新目录>
选项:
  --readiness-fixture                 使用已知 readiness fixture（不是产品 daemon）
  --expect-sha256 <hex>               绑定 tar 摘要
  --expect-build <id>                 绑定 buildId
  --expect-schema <n>                 绑定 productSchema
  --expect-source <40hex>             绑定 source commit
  --source-consumer                   追加当前 I/B source consumer（进程内、零模型、零信号）
  --i-commit/--b-commit <sha>         指定当前 source commit
  --i-root/--b-root/--main-root <dir> 指定 checkout
  --timeout-ms <n>                    单步 deadline（默认 600000）
退出: 0 OK, 1 DEGRADED, 2 REFUSED/用法, 3 INTERNAL
`

async function main() {
  let values
  try {
    values = parseOptions(process.argv.slice(2), {
      tar: 'string', artifact: 'string', out: 'string', 'readiness-fixture': 'boolean',
      'expect-sha256': 'string', 'expect-build': 'string', 'expect-schema': 'number', 'expect-source': 'string',
      'source-consumer': 'boolean', 'i-commit': 'string', 'b-commit': 'string',
      'i-root': 'string', 'b-root': 'string', 'main-root': 'string', 'timeout-ms': 'number',
      json: 'boolean', help: 'boolean',
    })
  } catch (error) {
    process.stderr.write(`trial-field-kit: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return EXIT.OK }
  if (!values.tar || !values.artifact || !values.out) { process.stderr.write(`trial-field-kit: REFUSED usage: --tar/--artifact/--out are required\n${USAGE}`); return EXIT.REFUSED }
  let out
  try { out = createOutputRoot(values.out) } catch (error) {
    process.stderr.write(`trial-field-kit: REFUSED ${error?.code ?? 'output'}: ${values.out}\n`)
    return EXIT.REFUSED
  }
  try {
    const result = runFieldKit({
      tar: values.tar, artifact: values.artifact, out,
      readinessFixture: values['readiness-fixture'] === true,
      timeoutMs: values['timeout-ms'] ?? 600000,
      expectations: { sha256: values['expect-sha256'], build: values['expect-build'], schema: values['expect-schema'], source: values['expect-source'] },
      sourceConsumer: values['source-consumer'] === true,
      commits: { i: values['i-commit'], b: values['b-commit'], iRoot: values['i-root'], bRoot: values['b-root'], mainRoot: values['main-root'] },
    })
    const { summary } = result
    const exit = summary.result === 'REFUSED' ? EXIT.REFUSED : summary.result === 'DEGRADED' || summary.machineExit === 1 ? EXIT.DEGRADED : summary.result === 'OK' ? EXIT.OK : EXIT.INTERNAL
    if (values.json === true) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    else printHuman([
      `field-kit: ${summary.result}`,
      `  package: ${summary.package?.name ?? 'unknown'} build=${summary.package?.buildId ?? 'unknown'}`,
      `  checks: PASS=${summary.counts.pass} WARN=${summary.counts.warn} UNKNOWN=${summary.counts.unknown} FAIL=${summary.counts.fail}`,
      `  source consumer: ${summary.sourceConsumer.ran ? `exit=${summary.sourceConsumer.exit}` : 'not run'}`,
      `  known issues: ${summary.knownIssues.length}`,
      `  material: ${out}`,
      '  scope: installed/source/fixture layers only; no daemon, recovery or native verdict',
    ])
    return exit
  } catch (error) {
    process.stderr.write(`trial-field-kit: INTERNAL ${String(error?.message ?? error)}\n`)
    return EXIT.INTERNAL
  }
}
process.exitCode = await main()
