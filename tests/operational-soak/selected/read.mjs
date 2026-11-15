#!/usr/bin/env node
/**
 * Re-read a selected-source consumer package from disk.
 *
 *   node tests/operational-soak/selected/read.mjs --run <produced-root> [--json]
 *
 * Verifies the recorded source identity, the materialized bytes that ran and the recorded checks; it
 * does not import or execute B/I again.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions } from '../../../tools/trial-kit/lib/args.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const USAGE = `read — 复核 selected source consumer 包
用法: node tests/operational-soak/selected/read.mjs --run <produced-root> [--json]
退出: 0 一致, 1 差异/缺材料, 2 参数/材料拒绝, 3 INTERNAL
`

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), { run: 'string', json: 'boolean', help: 'boolean' }) } catch (error) {
    process.stderr.write(`read: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return 2
  }
  if (values.help === true) { process.stdout.write(`${USAGE}\n`); return 0 }
  if (values.run === undefined) { process.stderr.write('read: REFUSED usage: --run <produced-root> is required\n'); return 2 }
  const root = resolve(values.run)
  try {
    const source = readJson(join(root, 'source.json'))
    const report = readJson(join(root, 'report.json'))
    const i = readJson(join(root, 'i.json'))
    const b = readJson(join(root, 'b.json'))
    const materializedOk = ['I', 'B'].every((role) => (source.materialized?.[role]?.files ?? []).every((file) => {
      try { return sha256(readFileSync(join(root, 'source', role, file.rel))) === file.sha256 } catch { return false }
    }))
    const iBase = Object.entries(i.checks).filter(([key]) => key !== 'freshIntentDefectObserved')
    const result = {
      protocol: 'selected-read/1',
      root,
      checks: {
        sourceOk: source.ok === true,
        materializedOk,
        reportOk: report.ok === true,
        iBaseOk: iBase.every(([, value]) => value === true),
        iDefectRecorded: i.checks.freshIntentDefectObserved === true || i.defects.length === 0,
        bOk: Object.values(b.checks).every(Boolean),
        zeroModel: report.modelCalls === 0 && report.vendorTurns === 0,
        zeroSignals: report.signalsSent === 0,
        notReachedRecorded: (report.notReached ?? []).length >= 3,
      },
    }
    result.ok = Object.values(result.checks).every(Boolean)
    if (values.json === true) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else process.stdout.write([
      `selected-read: ${result.ok ? 'OK' : 'DIFF'}`,
      `  source: I ${source.committed?.I?.head?.slice(0, 12)} commit ${source.committed?.I?.commit?.slice(0, 12)}; B ${source.committed?.B?.head?.slice(0, 12)} commit ${source.committed?.B?.commit?.slice(0, 12)}`,
      `  materialized bytes match=${materializedOk}; I base=${iBase.filter(([, value]) => value).length}/${iBase.length}; defect=${i.checks.freshIntentDefectObserved}; B=${Object.values(b.checks).filter(Boolean).length}/${Object.keys(b.checks).length}`,
      '  NOT_REACHED: B runner-service importing I, same-Runner route, SIGKILL recovery',
    ].join('\n'))
    return result.ok ? 0 : 1
  } catch (error) {
    process.stderr.write(`read: REFUSED ${String(error?.code ?? error?.message ?? error)}\n`)
    return 2
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`read: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = 3
})
