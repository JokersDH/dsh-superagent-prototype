import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATUS } from './status.mjs'

export function createRun({ reportsRoot, suites, label }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const directory = join(reportsRoot, 'runs', `${stamp}${label ? `-${label}` : ''}`)
  mkdirSync(directory, { recursive: true })
  return { directory, stamp, suites }
}

export function writeJson(directory, name, value) {
  const path = join(directory, name)
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
  return path
}

export function summarize(cases) {
  const counts = Object.fromEntries(Object.values(STATUS).map((status) => [status, 0]))
  for (const item of cases) counts[item.status] = (counts[item.status] ?? 0) + 1
  return counts
}

export function printSummary({ report, release }) {
  const counts = summarize(report.cases)
  const lines = [
    `source ${report.source.commit}${report.source.dirty ? ' (dirty worktree)' : ''}`,
    `cases ${report.cases.length}: ` +
      Object.entries(counts)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
  ]
  for (const item of report.cases)
    if (item.status !== STATUS.PASS)
      lines.push(`  ${item.status} ${item.id}${item.reason ? `: ${item.reason}` : ''}`)
  if (release) {
    lines.push(`release ${release.tier}: ${release.status}`)
    for (const failure of release.failures) lines.push(`  gate ${failure.code}: ${failure.detail}`)
  }
  process.stdout.write(lines.join('\n') + '\n')
}
