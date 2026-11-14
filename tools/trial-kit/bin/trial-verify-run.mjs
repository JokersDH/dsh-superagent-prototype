#!/usr/bin/env node
/**
 * `trial-verify-run` — re-derive one run's consistency from its raw samples.
 *
 *   trial-verify-run --run <run-directory> [--out <new-directory>] [--json]
 *
 * Read-only over the run material. With `--out`, writes `run-check.json` (0600, no overwrite) into
 * that new directory; without it, prints only.
 */
import { join } from 'node:path'
import { parseOptions } from '../lib/args.mjs'
import { EXIT, TrialKitError, createOutputRoot, printHuman, writePrivateJson } from '../lib/output.mjs'
import { verifyRun } from '../lib/check-run.mjs'

const USAGE = `trial-verify-run — 从原始 run.json + samples.ndjson 复核一次运行
用法: trial-verify-run --run <run目录> [--out <新目录>] [--json]
退出: 0 一致, 1 发现不一致, 2 输入拒绝, 3 INTERNAL
`

const SPEC = { run: 'string', out: 'string', json: 'boolean', help: 'boolean' }

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), SPEC) } catch (error) {
    process.stderr.write(`verify-run: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { printHuman([USAGE]); return EXIT.OK }
  try {
    if (values.run === undefined) throw new TrialKitError('usage', '--run <run-directory> is required')
    const report = await verifyRun(values.run)
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    if (values.out !== undefined) {
      const out = createOutputRoot(values.out)
      writePrivateJson(out, 'run-check.json', report)
      report.outputRoot = out
    }
    if (values.json === true) process.stdout.write(serialized)
    else {
      printHuman([
        `verify-run: ${report.consistency.ok ? 'CONSISTENT' : 'INCONSISTENT'}`,
        `  run: ${report.run.status} ${report.run.startedAt} .. ${report.run.endedAt} actual=${report.run.wallElapsedSeconds}s requested=${report.run.requestedDurationSeconds ?? 'n/a'}s`,
        `  samples: lines=${report.samples.lines} lastElapsedMs=${report.samples.lastElapsedMs} sha256=${report.samples.sha256.slice(0, 16)}...`,
        `  issues: ${report.consistency.issues.length === 0 ? 'none' : report.consistency.issues.join(', ')}`,
      ])
    }
    return report.consistency.ok ? EXIT.OK : EXIT.DEGRADED
  } catch (error) {
    const known = error instanceof TrialKitError ? error : new TrialKitError('internal', String(error?.message ?? error), undefined, EXIT.INTERNAL)
    process.stderr.write(`verify-run: REFUSED ${known.code}: ${known.message}\n`)
    return known.exitCode ?? EXIT.REFUSED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`verify-run: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
