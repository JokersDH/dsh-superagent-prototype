/**
 * Field kit: one bounded, redacted support bundle for a colleague trial.
 *
 * Layers stay separate:
 *   - installed: exact tar preflight/machinecheck and the package's own help/status/doctor.
 *   - source: optional current I/B source consumer (in-process, no model, no signal).
 *   - fixture: readiness fixture only when explicitly requested; never a package daemon.
 * The kit never installs, starts, stops, upgrades or migrates, and never claims native/recovery value.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homeDir, redactPath, redactValue } from './redact.mjs'

const BIN = fileURLToPath(new URL('../bin/', import.meta.url))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function runCli(script, args, timeout) {
  const entry = script.startsWith('/') ? script : join(BIN, script)
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  return { exit: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function walk(root, files = []) {
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'extract') continue
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) { walk(absolute, files); continue }
    if (entry.isSymbolicLink()) { files.push({ path: absolute, symlink: true }); continue }
    files.push({ path: absolute, symlink: false })
  }
  return files
}

function manifest(root, home) {
  const files = []
  for (const entry of walk(root)) {
    const rel = redactPath(relative(root, entry.path), home)
    if (entry.symlink) { files.push({ path: rel, symlink: true }); continue }
    const info = lstatSync(entry.path)
    const bytes = readFileSync(entry.path)
    files.push({ path: rel, bytes: info.size, mode: (info.mode & 0o777).toString(8), sha256: sha256(bytes) })
  }
  return { protocol: 'trial-field-manifest/1', generatedAt: new Date().toISOString(), files }
}

function knownIssues(report) {
  const issues = []
  const unknownChecks = report.checks.filter((entry) => entry.status === 'UNKNOWN')
  for (const check of unknownChecks) {
    if (check.id === 'host_sqlite') issues.push({ id: 'host_sqlite_unknown', level: 'info', meaning: 'preflight cannot execute the native SQLite binding; the package doctor verifies it at runtime', action: 'run package doctor in a private root and keep the exit/check list' })
    else if (check.id === 'readiness.package_binding') issues.push({ id: 'readiness_no_package_identity', level: 'info', meaning: 'readiness reports configuration facts, not a package identity', action: 'bind the report to the tar/build/source tuple manually' })
    else if (check.id === 'support.reference') issues.push({ id: 'support_not_supplied', level: 'info', meaning: 'pa support opens a database with write pragmas and is not run automatically', action: 'run it yourself on a copy and pass --support' })
    else issues.push({ id: `unknown:${check.id}`, level: 'info', meaning: check.detail?.note ?? check.detail?.reason ?? 'unknown check', action: 'inspect the raw machinecheck report' })
  }
  const doctor = report.sections?.packageCli?.doctor?.checks ?? []
  for (const check of doctor) {
    if (check.status === 'FAIL') issues.push({ id: `doctor_fail:${check.id}`, level: 'error', meaning: 'package doctor reported FAIL', action: 'keep the doctor output and stop before using this package' })
    else if (check.status === 'WARN' && !['instance', 'state', 'ports', 'executor', 'review_executor'].includes(check.id))
      issues.push({ id: `doctor_warn:${check.id}`, level: 'warn', meaning: 'unexpected package doctor warning', action: 'inspect the doctor check detail' })
  }
  const status = report.sections?.packageCli?.status?.status
  if (status === 'STOPPED') issues.push({ id: 'instance_stopped', level: 'info', meaning: 'no managed instance is running in this private root', action: 'this is expected for a fresh trial root; do not start without an explicit own target' })
  return issues
}

export function runFieldKit({ tar, artifact, install, out, readinessFixture = false, timeoutMs = 600000, expectations = {}, sourceConsumer = false, commits = {} }) {
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const machineDir = join(out, 'machinecheck')
  const args = install === undefined ? ['--tar', tar, '--artifact', artifact, '--out', machineDir] : ['--install', install, '--out', machineDir]
  if (readinessFixture) args.push('--readiness-fixture')
  const flags = { 'expect-sha256': expectations.sha256, 'expect-build': expectations.build, 'expect-schema': expectations.schema, 'expect-source': expectations.source }
  for (const [flag, value] of Object.entries(flags)) if (value !== undefined && value !== null) args.push(`--${flag}`, String(value))
  const machine = runCli('trial-machinecheck.mjs', args, timeoutMs)
  const reportPath = join(machineDir, 'machinecheck-report.json')
  let report = null
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')) } catch { report = null }
  const source = { ran: false }
  if (sourceConsumer) {
    const sourceDir = join(out, 'source-consumer')
    const sourceArgs = ['--out', sourceDir]
    for (const [flag, value] of Object.entries({ 'i-commit': commits.i, 'b-commit': commits.b, 'i-root': commits.iRoot, 'b-root': commits.bRoot, 'main-root': commits.mainRoot })) if (value) sourceArgs.push(`--${flag}`, value)
    const sourceRun = runCli(fileURLToPath(new URL('../../../tests/operational-soak/selected/produce2.mjs', import.meta.url)), sourceArgs, timeoutMs)
    let sourceReport = null
    try { sourceReport = JSON.parse(readFileSync(join(sourceDir, 'report.json'), 'utf8')) } catch { sourceReport = null }
    source.ran = true
    source.exit = sourceRun.exit
    source.report = sourceReport === null ? null : redactValue(sourceReport, { home: homeDir() })
    source.stderr = sourceRun.stderr.slice(0, 2000)
  }
  const home = homeDir()
  const subject = report?.subject ?? null
  const checks = report?.checks ?? []
  const summary = {
    protocol: 'trial-field-summary/1',
    generatedAt: new Date().toISOString(),
    package: subject === null ? null : {
      name: subject.path?.split('/').pop() ?? null,
      archiveSha256: subject.archive?.sha256 ?? null,
      bytes: subject.archive?.bytes ?? null,
      buildId: subject.buildId ?? null,
      source: subject.source ?? null,
      schema: subject.schema ?? null,
    },
    result: report?.result ?? 'NO_REPORT',
    machinecheckExit: machine.exit,
    counts: { pass: checks.filter((entry) => entry.status === 'PASS').length, warn: checks.filter((entry) => entry.status === 'WARN').length, unknown: checks.filter((entry) => entry.status === 'UNKNOWN').length, fail: checks.filter((entry) => entry.status === 'FAIL').length },
    packageCli: report?.sections?.packageCli?.commands?.map((entry) => ({ id: entry.id, exit: entry.exit })) ?? [],
    readiness: report?.sections?.readiness?.readiness ?? null,
    knownIssues: report === null ? [{ id: 'machinecheck_missing', level: 'error', meaning: 'machinecheck report could not be read', action: 'inspect machinecheck stderr and rerun with a fresh output root' }] : knownIssues(report),
    sourceConsumer: source,
    layers: {
      installed: 'exact tar preflight + package help/status/doctor in private roots',
      source: sourceConsumer ? 'current I/B source consumer, in-process only' : 'not run',
      fixture: readinessFixture ? 'readiness fixture (not a package daemon)' : 'not requested',
      recovery: 'NOT_REACHED in this kit',
      native: 'NOT_MEASURED',
    },
    reproduction: [
      `node tools/trial-kit/bin/trial-field-kit.mjs ${install === undefined ? '--tar <exact.tar.gz> --artifact <install-artifact.json>' : '--install <exact-install-dir>'} --out <new-dir>${readinessFixture ? ' --readiness-fixture' : ''}`,
      'open machinecheck/machinecheck-report.json and diagnostics-bundle.json',
      'never paste tokens, headers, conversation bodies or private database content',
    ],
  }
  const summaryPath = join(out, 'support-summary.json')
  writeFileSync(summaryPath, `${JSON.stringify(redactValue(summary, { home }), null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  const notes = [
    '# 同事试用现场包',
    '',
    `生成时间：${summary.generatedAt}`,
    `包：${summary.package?.name ?? 'unknown'}  build=${summary.package?.buildId ?? 'unknown'}  schema=${summary.package?.schema ?? 'unknown'}`,
    `tar sha256：${summary.package?.archiveSha256 ?? 'unknown'}`,
    `machinecheck：${summary.result}（exit ${summary.machinecheckExit}），PASS=${summary.counts.pass} WARN=${summary.counts.warn} UNKNOWN=${summary.counts.unknown} FAIL=${summary.counts.fail}`,
    '',
    '## 一页清单',
    '1. 只使用显式 tar/install 与自己的新根；不要在旧用户实例上安装、停止或迁移。',
    '2. 先看 machinecheck 的 refuse/unknown；完整性 REFUSED 时不执行包内命令。',
    '3. 包内 status/doctor/readiness 是观察，不是安装/执行/授权结论。',
    '4. 遇到问题保留整个新输出根；不要删除 UNKNOWN 资源或修改用户数据库。',
    '5. 分享 support-summary.json、machinecheck-report.json、diagnostics-bundle.json 和实际命令 exit；不要分享 token、正文或私有 DB。',
    '',
    '## 已知问题 / 决策树',
    '...',
    ...summary.knownIssues.map((issue) => `- [${issue.level}] ${issue.id}: ${issue.meaning} → ${issue.action}`),
    '',
    '## 未达分层',
    `- installed: ${summary.layers.installed}`,
    `- source: ${summary.layers.source}`,
    `- fixture: ${summary.layers.fixture}`,
    `- recovery: ${summary.layers.recovery}`,
    `- native: ${summary.layers.native}`,
    '',
  ].join('\n')
  writeFileSync(join(out, 'FIELD-NOTES.md'), `${notes}\n`, { mode: 0o600, flag: 'wx' })
  const files = manifest(out, home)
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(files, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  return { summary, machineExit: machine.exit, machineStderr: machine.stderr, out }
}
