#!/usr/bin/env node
/**
 * `trial-preflight` — read-only identity/environment preflight for one staged install.
 *
 *   trial-preflight --tar <package.tar.gz>  [--artifact <install-artifact.json>] --out <new-dir>
 *   trial-preflight --install <install-dir>                                    --out <new-dir>
 *
 * Explicit input only: exactly one tar or install directory, one brand-new output root, optional
 * published tuple assertions. Nothing is installed, started, migrated or written outside the new
 * output root; the input package is re-hashed afterwards to prove it was not modified.
 */
import { parseOptions, requireOneOf } from '../lib/args.mjs'
import { LIMITS, TOOL } from '../lib/limits.mjs'
import { EXIT, TrialKitError, createOutputRoot, nowIso, printHuman, writePrivateJson } from '../lib/output.mjs'
import { loadArtifact, preflight } from '../lib/package-preflight.mjs'
import { assertNoSecrets, homeDir, redactPath, redactValue } from '../lib/redact.mjs'

const USAGE = `trial-preflight — 只读包/环境预检（不安装、不启动、不迁移）
用法:
  trial-preflight --tar <package.tar.gz> --out <新目录> [选项]
  trial-preflight --install <已展开安装目录> --out <新目录> [选项]
选项:
  --artifact <install-artifact.json>  绑定已发布 tar/closure/manifest 摘要
  --expect-sha256 <hex>               期望 tar 摘要（--install 时比较 closureDigest）
  --expect-build <buildId>            期望 buildId
  --expect-schema <n>                 期望 productSchema
  --expect-source <40hex>             期望源码 commit
  --keep-extract                      保留 --out/extract（默认校验后删除）
  --json                              只输出机器 JSON
  --help                              显示本说明
退出: 0 OK, 1 DEGRADED(未测量的兼容性/未绑定), 2 REFUSED(完整性/输入拒绝), 3 INTERNAL
`

const SPEC = {
  tar: 'string', install: 'string', out: 'string', artifact: 'string',
  'expect-sha256': 'string', 'expect-build': 'string', 'expect-schema': 'number', 'expect-source': 'string',
  'keep-extract': 'boolean', json: 'boolean', help: 'boolean',
}

function refusalReport(error, { input, out }) {
  return {
    protocol: 'trial-preflight/1',
    tool: { ...TOOL, command: 'preflight' },
    observedAt: nowIso(),
    subject: input === null ? null : { kind: input.kind, path: redactPath(input.path ?? null) },
    observed: {},
    checks: [{ id: 'invocation', status: 'FAIL', detail: { code: error.code ?? 'error', message: error.message, detail: error.detail ?? null } }],
    refused: [{ id: 'invocation', code: error.code ?? 'error', message: error.message }],
    unknowns: [],
    method: { limits: { ...LIMITS } },
    result: 'REFUSED',
    exitCode: error.exitCode ?? EXIT.REFUSED,
    outputRoot: out === null ? null : redactPath(out),
  }
}

async function main() {
  let values
  try {
    values = parseOptions(process.argv.slice(2), SPEC)
  } catch (error) {
    const known = error instanceof TrialKitError ? error : new TrialKitError('internal', String(error?.message ?? error), undefined, EXIT.INTERNAL)
    process.stderr.write(`preflight: REFUSED ${known.code}: ${known.message}\n${USAGE}`)
    return known.exitCode ?? EXIT.REFUSED
  }
  if (values.help === true) {
    printHuman([USAGE])
    return EXIT.OK
  }
  let out = null
  let input = null
  try {
    const kind = requireOneOf(values, ['tar', 'install'], 'Give exactly one of --tar <file> or --install <dir>')
    if (values.out === undefined) throw new TrialKitError('usage', '--out <new-directory> is required')
    input = { kind, path: kind === 'tar' ? values.tar : values.install }
    const artifact = await loadArtifact(values.artifact)
    out = createOutputRoot(values.out)
    const report = await preflight({
      kind,
      tarPath: values.tar,
      installPath: values.install,
      artifact,
      out,
      keepExtract: values['keep-extract'] === true,
      expectations: {
        sha256: values['expect-sha256'],
        build: values['expect-build'],
        schema: values['expect-schema'],
        source: values['expect-source'],
      },
    })
    const redacted = redactValue(report, { home: homeDir(), secrets: [] })
    const document = {
      protocol: 'trial-preflight/1',
      tool: { ...TOOL, command: 'preflight' },
      observedAt: nowIso(),
      subject: {
        kind,
        path: redactPath(values.tar ?? values.install),
        archive: report.observed.archiveSha256 === undefined ? null : { sha256: report.observed.archiveSha256, bytes: report.observed.archiveBytes },
      },
      manifest: {
        buildId: report.observed.buildId ?? null,
        source: report.observed.sourceCommit === undefined ? null : { commit: report.observed.sourceCommit, dirty: report.observed.sourceDirty ?? null },
        producer: redacted.observed?.producer ?? null,
        supportMatrix: redacted.observed?.supportMatrix ?? null,
        dependencies: redacted.observed?.dependencies ?? null,
        workspacePackages: redacted.observed?.workspacePackages ?? null,
      },
      observed: redacted.observed,
      checks: redacted.checks,
      refused: redacted.checks.filter((entry) => entry.status === 'FAIL').map((entry) => ({ id: entry.id, detail: entry.detail ?? null })),
      unknowns: redacted.unknowns,
      method: redacted.method,
      result: report.result,
      exitCode: report.exitCode,
      redaction: { home: '~', secretValues: 0, note: 'absolute operator home paths are shown as ~; no credential is read' },
      outputRoot: redactPath(out),
    }
    const serialized = `${JSON.stringify(document, null, 2)}\n`
    if (Buffer.byteLength(serialized) > LIMITS.maxReportBytes) throw new TrialKitError('report_too_large', 'Report exceeds the byte budget')
    if (!assertNoSecrets(serialized, [])) throw new TrialKitError('redaction_failed', 'Report contains an unredacted secret value')
    const written = writePrivateJson(out, 'preflight-report.json', document)
    if (values.json !== true) {
      const counts = report.checks.reduce((acc, entry) => { acc[entry.status] = (acc[entry.status] ?? 0) + 1; return acc }, {})
      printHuman([
        `preflight: ${report.result}`,
        `  subject: ${document.subject.kind} ${document.subject.path}`,
        `  identity: build=${document.manifest.buildId ?? 'unknown'} schema=${document.manifest.producer?.productSchema ?? 'unknown'} source=${document.manifest.source?.commit?.slice(0, 12) ?? 'unknown'}`,
        `  archive: sha256=${document.subject.archive?.sha256 ?? 'n/a'}`,
        `  closure: ${document.observed.closureDigest ?? 'unknown'}  files=${document.observed.fileCounts?.files ?? 'unknown'} links=${document.observed.fileCounts?.symlinks ?? 'unknown'}`,
        `  checks: PASS=${counts.PASS ?? 0} WARN=${counts.WARN ?? 0} UNKNOWN=${counts.UNKNOWN ?? 0} FAIL=${counts.FAIL ?? 0}`,
        `  report: ${written.path.replace(homeDir(), '~')} (0600)`,
        `  note: 只读观察；不授权安装、启动或迁移，也不证明跨机器可用`,
      ])
      for (const entry of report.checks.filter((entry) => ['FAIL', 'WARN'].includes(entry.status)).slice(0, 8))
        printHuman([`  ${entry.status} ${entry.id}: ${JSON.stringify(entry.detail ?? null).slice(0, 240)}`])
    } else {
      process.stdout.write(serialized)
    }
    return report.exitCode
  } catch (error) {
    const known = error instanceof TrialKitError ? error : new TrialKitError('internal', String(error?.message ?? error), undefined, EXIT.INTERNAL)
    if (out !== null) {
      try { writePrivateJson(out, 'preflight-report.json', refusalReport(known, { input, out })) } catch { /* keep the primary error */ }
    }
    if (values.json === true) process.stderr.write(`${JSON.stringify({ result: 'REFUSED', code: known.code, message: known.message, detail: known.detail ?? null })}\n`)
    else process.stderr.write(`preflight: REFUSED ${known.code}: ${known.message}${out === null ? '' : ` (material kept in ${redactPath(out)})`}\n`)
    return known.exitCode ?? EXIT.REFUSED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`preflight: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
