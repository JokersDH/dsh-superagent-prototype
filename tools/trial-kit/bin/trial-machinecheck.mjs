#!/usr/bin/env node
/**
 * `trial-machinecheck` — immutable-package machine checks + optional readiness observation +
 * sanitized diagnostics bundle for a colleague reproduction.
 *
 *   trial-machinecheck --tar <package.tar.gz> --artifact <install-artifact.json> --out <new-dir>
 *   trial-machinecheck --install <install-dir> --out <new-dir> [--readiness http://127.0.0.1:PORT --token-file <0600>]
 *
 * Writes three 0600 files into the new output root: `machinecheck-report.json`,
 * `diagnostics-bundle.json` and `reproduce.txt`. No package is installed, started, stopped or
 * migrated; no other home credential is read; the executor probe is redirected to a local fixture.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseOptions, requireOneOf } from '../lib/args.mjs'
import { LIMITS, TOOL } from '../lib/limits.mjs'
import { EXIT, TrialKitError, createOutputRoot, nowIso, printHuman, writePrivateFile, writePrivateJson } from '../lib/output.mjs'
import { loadArtifact } from '../lib/package-preflight.mjs'
import { machinecheck, sanitizeSupport } from '../lib/machinecheck.mjs'
import { readReadiness, readTokenFile } from '../lib/readiness.mjs'
import { assertNoSecrets, homeDir, redactPath, redactValue } from '../lib/redact.mjs'

const USAGE = `trial-machinecheck — 不可变包机器检查 + 只读 readiness + 脱敏诊断包
用法:
  trial-machinecheck --tar <package.tar.gz> --out <新目录> [--artifact <install-artifact.json>]
  trial-machinecheck --install <安装目录> --out <新目录>
选项:
  --readiness <loopback-url>             显式 127.0.0.1/::1/localhost 地址
  --readiness-fixture                    在本进程启动已知 fixture 服务（无需 token 文件；用于可复现正向）
  --token-file <0600 文件>               显式 bearer token（不打印、不写入报告）
  --token-env <变量名>                   从显式环境变量读取 token
  --timeout-ms <n>                       单次 HTTP deadline（默认 5000）
  --max-observation-age-seconds <n>      拒绝过期 readiness 观察
  --expect-configuration-revision <hex>  绑定 readiness configurationRevision
  --expect-mode <fixture|product|personal>
  --expect-startup-mode <normal|recovery_readonly>
  --support <file>                       引用你自己采集的 pa-support/1 诊断（只保留白名单字段）
  --run-support                          仅当显式自有 data 根尚无 state.sqlite 时运行包内 pa support
  --no-package-cli                       跳过包内 help/status/doctor
  --keep-extract                         保留 <out>/extract
  --json                                 只输出机器 JSON
退出: 0 OK, 1 DEGRADED, 2 REFUSED, 3 INTERNAL
`

const SPEC = {
  tar: 'string', install: 'string', out: 'string', artifact: 'string',
  'expect-sha256': 'string', 'expect-build': 'string', 'expect-schema': 'number', 'expect-source': 'string',
  readiness: 'string', 'readiness-fixture': 'boolean', 'token-file': 'string', 'token-env': 'string', 'timeout-ms': 'number',
  'max-observation-age-seconds': 'number', 'expect-configuration-revision': 'string',
  'expect-mode': 'string', 'expect-startup-mode': 'string',
  support: 'string', 'run-support': 'boolean', 'no-package-cli': 'boolean', 'keep-extract': 'boolean',
  json: 'boolean', help: 'boolean',
}

async function loadSchema() {
  const moduleUrl = new URL('../../../packages/contracts/src/trial-readiness.ts', import.meta.url)
  const module = await import(moduleUrl.href)
  return module.TrialReadinessSchema
}

function reproduceLines({ kind, inputPath, artifactPath, out, readiness, tokenSource, supportPath, keepExtract }) {
  const lines = [
    '# 最短复现（在 trial-kit 所在 checkout 执行；替换 <NEW-OUT> 为新目录）',
  ]
  if (kind === 'tar') lines.push(`node tools/trial-kit/bin/trial-machinecheck.mjs --tar '${inputPath}' --out <NEW-OUT>${artifactPath ? ` --artifact '${artifactPath}'` : ''}`)
  else lines.push(`node tools/trial-kit/bin/trial-machinecheck.mjs --install '${inputPath}' --out <NEW-OUT>${artifactPath ? ` --artifact '${artifactPath}'` : ''}`)
  if (keepExtract) lines.push('# note: --keep-extract keeps <NEW-OUT>/extract for inspection')
  if (readiness) lines.push(`# readiness: add --readiness '${readiness}' ${tokenSource === 'file' ? '--token-file <YOUR-0600-TOKEN>' : '--token-env <YOUR_ENV_NAME>'}`)
  if (supportPath) lines.push(`# support: add --support '${supportPath}' (your own pa support bundle)`)
  lines.push('', '# 只读复跑包内命令（同样使用本次新根，不碰个人 state）')
  lines.push(`'<EXTRACT>/bin/pa' help`)
  lines.push(`PA_CONFIG_ROOT='<NEW-OUT>/roots/config' PA_DATA_ROOT='<NEW-OUT>/roots/data' '<EXTRACT>/bin/pa' status --json`)
  return lines
}

async function main() {
  let values
  try {
    values = parseOptions(process.argv.slice(2), SPEC)
  } catch (error) {
    process.stderr.write(`machinecheck: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { printHuman([USAGE]); return EXIT.OK }

  let out = null
  try {
    const kind = requireOneOf(values, ['tar', 'install'], 'Give exactly one of --tar <file> or --install <dir>')
    if (values.out === undefined) throw new TrialKitError('usage', '--out <new-directory> is required')
    if (values.readiness !== undefined && values['readiness-fixture'] === true)
      throw new TrialKitError('usage', 'Give either --readiness <url> or --readiness-fixture, not both')
    if (values.readiness !== undefined && values['token-file'] === undefined && values['token-env'] === undefined)
      throw new TrialKitError('usage', 'Readiness needs an explicit --token-file or --token-env; this tool does not discover credentials')
    if (values['token-file'] !== undefined && values['token-env'] !== undefined)
      throw new TrialKitError('usage', 'Give only one of --token-file or --token-env')
    const secrets = []
    let token = null
    let tokenSource = null
    if (values['token-file'] !== undefined) {
      token = readTokenFile(resolve(values['token-file']))
      tokenSource = 'file'
      secrets.push(token)
    } else if (values['token-env'] !== undefined) {
      const name = values['token-env']
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new TrialKitError('usage', '--token-env must be a plain environment variable name')
      const value = process.env[name]
      if (typeof value !== 'string' || value.length === 0) throw new TrialKitError('token_unavailable', 'Named token environment variable is empty or missing', { variable: name })
      token = value
      tokenSource = 'env'
      secrets.push(token)
    }
    if (values['expect-mode'] !== undefined && !['fixture', 'product', 'personal'].includes(values['expect-mode']))
      throw new TrialKitError('usage', '--expect-mode must be fixture, product or personal')
    if (values['expect-startup-mode'] !== undefined && !['normal', 'recovery_readonly'].includes(values['expect-startup-mode']))
      throw new TrialKitError('usage', '--expect-startup-mode must be normal or recovery_readonly')

    const artifact = await loadArtifact(values.artifact)
    out = createOutputRoot(values.out)

    let readinessResult = null
    let fixtureReadiness = null
    if (values['readiness-fixture'] === true) {
      const { FIXTURE_AUTHORIZATION, startFixtureServer } = await import('../lib/fixture-server.mjs')
      const fixture = await startFixtureServer({ readiness: 'ready' })
      try {
        const schema = await loadSchema()
        readinessResult = await readReadiness({ url: fixture.url, token: FIXTURE_AUTHORIZATION, schema, timeoutMs: values['timeout-ms'] ?? LIMITS.networkTimeoutMs, maxBytes: LIMITS.maxResponseBytes, expectations: { mode: 'fixture', maxAgeSeconds: 300 } })
        fixtureReadiness = { url: fixture.url, mode: 'ready', note: 'in-process known fixture, not the product readiness endpoint' }
      } finally {
        await fixture.close()
      }
    } else if (values.readiness !== undefined) {
      const schema = await loadSchema()
      readinessResult = await readReadiness({
        url: values.readiness,
        token,
        schema,
        timeoutMs: values['timeout-ms'] ?? LIMITS.networkTimeoutMs,
        maxBytes: LIMITS.maxResponseBytes,
        expectations: {
          configurationRevision: values['expect-configuration-revision'],
          mode: values['expect-mode'],
          startupMode: values['expect-startup-mode'],
          maxAgeSeconds: values['max-observation-age-seconds'],
        },
      })
    }

    let supportReference = null
    if (values.support !== undefined) supportReference = sanitizeSupport(resolve(values.support))

    const result = await machinecheck({
      preflightInput: {
        kind, tarPath: values.tar, installPath: values.install === undefined ? undefined : resolve(values.install), artifact, out,
        keepExtract: values['keep-extract'] === true,
        expectations: {
          sha256: values['expect-sha256'], build: values['expect-build'],
          schema: values['expect-schema'], source: values['expect-source'],
        },
      },
      readinessResult,
      supportReference,
      withPackageCli: values['no-package-cli'] !== true,
    })

    // Optional, explicitly guarded support collection: only against an empty own data root.
    let supportRun = null
    if (values['run-support'] === true) {
      const dataRoot = join(out, 'roots', 'data')
      if (existsSync(join(dataRoot, 'state.sqlite'))) {
        supportRun = { ok: false, reason: 'own_data_root_has_database', note: 'pa support opens the database with write pragmas; run it yourself on a copy' }
      } else if (kind !== 'install') {
        supportRun = { ok: false, reason: 'tar_input_without_extracted_cli' }
      } else {
        const supportOut = join(out, 'package-support.json')
        const environment = { ...process.env, PA_CONFIG_ROOT: join(out, 'roots', 'config'), PA_DATA_ROOT: dataRoot,
          PA_CACHE_ROOT: join(out, 'roots', 'cache'), PA_LOGS_ROOT: join(out, 'roots', 'logs'), PA_WORKSPACE_ROOT: join(out, 'roots', 'workspaces') }
        const run = spawnSync(join(resolve(values.install), 'bin/pa'), ['support', '--out', supportOut], { encoding: 'utf8', timeout: 60_000, env: environment })
        supportRun = { ok: run.status === 0, exit: run.status, stderr: (run.stderr ?? '').slice(0, 400) }
        if (run.status === 0) {
          const sanitized = sanitizeSupport(supportOut)
          supportReference = sanitized
          result.checks.push({ id: 'support.collected', status: sanitized.ok ? 'PASS' : 'FAIL', detail: sanitized.ok ? { digest: sanitized.digest } : sanitized })
        } else {
          result.checks.push({ id: 'support.collected', status: 'FAIL', detail: supportRun })
        }
        const failures = result.checks.filter((entry) => entry.status === 'FAIL')
        result.result = failures.length > 0 ? 'REFUSED' : result.checks.some((entry) => ['WARN', 'UNKNOWN'].includes(entry.status)) ? 'DEGRADED' : 'OK'
        result.exitCode = result.result === 'OK' ? 0 : result.result === 'DEGRADED' ? 1 : 2
      }
    }

    const report = {
      protocol: 'trial-machinecheck/1',
      tool: { ...TOOL, command: 'machinecheck' },
      observedAt: nowIso(),
      subject: {
        kind, path: redactPath(values.tar ?? values.install),
        archive: result.sections.preflight.observed.archiveSha256 === undefined ? null
          : { sha256: result.sections.preflight.observed.archiveSha256, bytes: result.sections.preflight.observed.archiveBytes },
        buildId: result.sections.preflight.observed.buildId ?? null,
        source: result.sections.preflight.observed.sourceCommit === undefined ? null
          : { commit: result.sections.preflight.observed.sourceCommit, dirty: result.sections.preflight.observed.sourceDirty ?? null },
        schema: result.sections.preflight.observed.productSchema ?? null,
        producer: result.sections.preflight.observed.producer ?? null,
      },
      checks: result.checks,
      refused: result.checks.filter((entry) => entry.status === 'FAIL').map((entry) => ({ id: entry.id, detail: entry.detail ?? null })),
      unknowns: result.unknowns,
      sections: result.sections,
      result: result.result,
      exitCode: result.exitCode,
      redaction: { home: '~', token: '<redacted>', tokenSource },
      outputRoot: redactPath(out),
    }
    const redactedReport = redactValue(report, { home: homeDir(), secrets })

    const diagnostics = {
      protocol: 'trial-diagnostics/1',
      generatedAt: nowIso(),
      tool: { ...TOOL, command: 'machinecheck' },
      subject: redactedReport.subject,
      environment: { platform: process.platform, arch: process.arch, node: process.versions.node, abi: process.versions.modules },
      summary: { result: result.result, exitCode: result.exitCode, unknowns: result.unknowns },
      preflight: {
        result: result.sections.preflight.result,
        observed: redactValue(result.sections.preflight.observed, { home: homeDir(), secrets }),
        checks: result.checks.filter((entry) => entry.id.startsWith('package_cli.') === false && entry.id.startsWith('readiness.') === false && entry.id.startsWith('support.') === false),
      },
      packageCli: redactValue(result.sections.packageCli, { home: homeDir(), secrets }),
      readiness: redactValue(result.sections.readiness, { home: homeDir(), secrets }),
      readinessFixture: fixtureReadiness,
      support: redactValue(result.sections.support, { home: homeDir(), secrets }),
      failures: redactedReport.refused,
      redaction: { ...redactedReport.redaction, secretValuesRedacted: secrets.length },
      method: {
        limits: LIMITS,
        packageCommands: result.sections.packageCli?.commands ?? [],
        sideEffects: [
          'tar listing/extraction into <out>/extract (our new root only)',
          'temporary loopback bind attempts by the package doctor on ports 5190 and 8790 (availability probe; it never stops a process)',
          'executor probe redirected to <out>/fixture/codex-fixture with an empty CODEX_HOME',
        ],
      },
    }
    const diagnosticsSerialized = `${JSON.stringify(redactValue(diagnostics, { home: homeDir(), secrets }), null, 2)}\n`
    const reportSerialized = `${JSON.stringify(redactedReport, null, 2)}\n`
    if (Buffer.byteLength(reportSerialized) > LIMITS.maxReportBytes || Buffer.byteLength(diagnosticsSerialized) > LIMITS.maxReportBytes)
      throw new TrialKitError('report_too_large', 'Report exceeds the byte budget')
    if (!assertNoSecrets(reportSerialized, secrets) || !assertNoSecrets(diagnosticsSerialized, secrets)) {
      throw new TrialKitError('redaction_failed', 'A token value survived redaction; refusing to write material', undefined, EXIT.INTERNAL)
    }
    const reproduce = reproduceLines({
      kind, inputPath: redactPath(values.tar ?? values.install), artifactPath: values.artifact === undefined ? null : redactPath(values.artifact),
      out, readiness: values.readiness ?? null, tokenSource, supportPath: values.support === undefined ? null : redactPath(values.support),
      keepExtract: values['keep-extract'] === true,
    }).join('\n')
    const written = {
      report: writePrivateJson(out, 'machinecheck-report.json', redactedReport),
      diagnostics: writePrivateFile(out, 'diagnostics-bundle.json', diagnosticsSerialized),
      reproduce: writePrivateFile(out, 'reproduce.txt', `${reproduce}\n`),
    }

    if (values.json === true) process.stdout.write(reportSerialized)
    else {
      printHuman([
        `machinecheck: ${result.result}`,
        `  subject: ${redactedReport.subject.kind} ${redactedReport.subject.path}`,
        `  identity: build=${redactedReport.subject.buildId ?? 'unknown'} schema=${redactedReport.subject.schema ?? 'unknown'} source=${redactedReport.subject.source?.commit?.slice(0, 12) ?? 'unknown'}`,
        `  checks: ${result.checks.length} (PASS=${result.checks.filter((entry) => entry.status === 'PASS').length} WARN=${result.checks.filter((entry) => entry.status === 'WARN').length} UNKNOWN=${result.checks.filter((entry) => entry.status === 'UNKNOWN').length} FAIL=${result.checks.filter((entry) => entry.status === 'FAIL').length})`,
        `  package cli: ${result.sections.packageCli === null ? 'skipped' : `help=${result.sections.packageCli.help.exit} status=${result.sections.packageCli.status.exit} doctor=${result.sections.packageCli.doctor.exit}(${result.sections.packageCli.doctor.status ?? 'no-json'})`}`,
        `  readiness: ${result.sections.readiness === null ? 'not_requested' : `${result.sections.readiness.readiness?.mode ?? 'unavailable'}/${result.sections.readiness.readiness?.startupMode ?? 'unknown'} at ${result.sections.readiness.metadata.address}`}${fixtureReadiness === null ? '' : ' (fixture)'}`,
        `  material: ${written.report.path.replace(homeDir(), '~')} (0600), ${written.diagnostics.path.split('/').pop()} (0600), ${written.reproduce.path.split('/').pop()} (0600)`,
        '  note: 原始观察材料；不是发布/执行/授权结论，E 仍独立断言',
      ])
      for (const entry of result.checks.filter((entry) => entry.status === 'FAIL').slice(0, 10))
        printHuman([`  FAIL ${entry.id}: ${JSON.stringify(entry.detail ?? null).slice(0, 240)}`])
      if (supportRun !== null && supportRun.ok !== true) printHuman([`  support: not collected (${supportRun.reason ?? supportRun.exit})`])
    }
    return result.exitCode
  } catch (error) {
    const known = error instanceof TrialKitError ? error : new TrialKitError('internal', String(error?.message ?? error), undefined, EXIT.INTERNAL)
    if (out !== null) {
      try {
        writePrivateJson(out, 'machinecheck-report.json', {
          protocol: 'trial-machinecheck/1', tool: { ...TOOL, command: 'machinecheck' }, observedAt: nowIso(),
          subject: null, checks: [{ id: 'invocation', status: 'FAIL', detail: { code: known.code, message: known.message, detail: known.detail ?? null } }],
          refused: [{ id: 'invocation', code: known.code }], unknowns: [], result: 'REFUSED', exitCode: known.exitCode ?? EXIT.REFUSED,
          outputRoot: redactPath(out),
        })
      } catch { /* keep the primary error */ }
    }
    if (values.json === true) process.stderr.write(`${JSON.stringify({ result: 'REFUSED', code: known.code, message: known.message })}\n`)
    else process.stderr.write(`machinecheck: REFUSED ${known.code}: ${known.message}${out === null ? '' : ` (material kept in ${redactPath(out)})`}\n`)
    return known.exitCode ?? EXIT.REFUSED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`machinecheck: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
