#!/usr/bin/env node
/**
 * Builds the E5 handoff from one recorded acceptance run: a capability matrix, an execution status
 * file and a readable handoff. Every row points at the cases that produced it; a capability with no
 * passing case is reported as NOT_TESTED rather than as covered.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { STATUS } from './lib/status.mjs'
import { evaluateRelease } from './lib/release.mjs'
import { tier as releaseTier } from './lib/release-requirements.mjs'
import { resolveFixtureDigest } from './lib/fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const reports = join(here, 'reports')
const { values } = parseArgs({ options: { run: { type: 'string' } } })

const latest = existsSync(join(reports, 'latest.json'))
  ? JSON.parse(readFileSync(join(reports, 'latest.json'), 'utf8'))
  : undefined
const runDirectory = values.run ? resolve(values.run) : latest?.runDirectory
if (!runDirectory || !existsSync(join(runDirectory, 'report.json')))
  throw new Error('No run report found. Run `node tests/product-acceptance/run.mjs --suites=… --record` first.')

const report = JSON.parse(readFileSync(join(runDirectory, 'report.json'), 'utf8'))
const pilotPreflight = existsSync(join(here, 'pilot/reports/preflight.json'))
  ? JSON.parse(readFileSync(join(here, 'pilot/reports/preflight.json'), 'utf8'))
  : { status: 'NOT_EXECUTED', reasons: [{ code: 'no_preflight' }] }
const release = report.release ?? JSON.parse(readFileSync(join(runDirectory, 'release.json'), 'utf8'))
const stages = JSON.parse(readFileSync(join(here, 'stages.json'), 'utf8'))
const byId = new Map(report.cases.map((item) => [item.id, item]))
const upgradeEvidence = byId.get('E4-UPGRADE-ROLLBACK')?.evidence?.upgrade ?? {}
const artifactTuple = { baseline: upgradeEvidence.baseline ?? null, target: upgradeEvidence.target ?? null }
const caseStatus = (id) => byId.get(id)?.status ?? 'MISSING'

/**
 * Each row states which evidence lane actually supports the capability. `native` and `install` are
 * separate columns precisely so fixture success cannot be read as production readiness.
 */
const CAPABILITIES = [
  {
    id: 'conversation-chat',
    label: '主对话：普通消息持久化与重开',
    controlled: ['E2-REPLAY-AND-CONFLICT', 'E2-REOPEN-PERSISTENCE'],
    sdkMock: ['E2-ASSISTANT-SDK-MOCK'],
    native: 'NOT_TESTED',
    nativeReason: '真实模型回复与流式界面未在本轮执行；budget 0。',
  },
  {
    id: 'explicit-delegation',
    label: '明确委托到受控执行、验证与完成',
    controlled: ['E2-DAILY-VERTICAL'],
    sdkMock: [],
    native: 'NOT_TESTED',
    nativeReason: '真实 Codex 执行属于 B 的原生验收，E 未触发计费任务。',
  },
  {
    id: 'question-answer',
    label: '问题中心：打开、回答、投递与决策收件箱',
    controlled: ['E2-DAILY-VERTICAL', 'E3-QUESTION-FORM'],
    nativeReason: '真实原生权限/审批问题未执行；B 的原生证据未作为输入提供。',
  },
  {
    id: 'verification-completion',
    label: '机器检查、完整 patch、artifact 字节与人工接受',
    controlled: ['E2-DAILY-VERTICAL', 'E2-ARTIFACT-ROUNDTRIP', 'E3-ACCEPT-AND-DOWNLOAD'],
    native: 'NOT_TESTED',
    nativeReason: '原生注册检查与真实 deliverable 未在本轮复验。',
  },
  {
    id: 'verification-recovery',
    label: '验证阻断→明确重新检查→同一候选验证→接受→重开',
    controlled: ['E2-VERIFICATION-RECOVERY', 'E2-VERIFICATION-FINISHED-STATES', 'E3-VERIFICATION-RECOVERY-UI'],
    notTested: ['生产故障注入接口不存在；阻断由受控 completion port 注入，其余步骤走真实 HTTP。'],
  },
  {
    id: 'accepted-outcome-evidence',
    label: '接受结果投影与工作证据读取',
    controlled: ['E2-WORK-EVIDENCE'],
    notTested: ['工作台内进一步的时间线展示仍单列；source_missing/not_in_window 需要旧库来源缺失场景。'],
  },
  {
    id: 'machine-fail',
    label: '必需机器检查失败不可被人工接受',
    controlled: ['E2-MACHINE-FAIL'],
  },
  {
    id: 'replay-conflict',
    label: '同 commandId 幂等重放与冲突拒绝',
    controlled: ['E2-REPLAY-AND-CONFLICT'],
  },
  {
    id: 'stale-guards',
    label: '旧合同/旧候选/旧回答按业务规则拒绝',
    controlled: ['E2-STALE-BUSINESS-REJECTION'],
    notTested: ['旧提案与决定的撤销治理（C 未交付）'],
  },
  {
    id: 'isolation',
    label: '会话隔离与工作隔离',
    controlled: ['E2-SESSION-ISOLATION'],
    notTested: ['两个独立项目的隔离：受控 lane 只有一个项目。'],
  },
  {
    id: 'writer-identity',
    label: '停止后继续使用新 ticket，不重用旧执行',
    controlled: ['E2-ONE-WRITER', 'E4-BOUNDED-CYCLES'],
    native: 'NOT_TESTED',
    nativeReason: '真实原生写进程停止与物理资源屏障由 B 证明。',
  },
  {
    id: 'resource-recovery',
    label: '重启后交付、消息与 artifact 保留',
    controlled: ['E2-REOPEN-PERSISTENCE', 'E4-BOUNDED-CYCLES'],
    notTested: ['协调器 SIGKILL 后的原生恢复与重连（B 范围）。'],
  },
  {
    id: 'scope-profile-auth',
    label: '越权 scope、未知项目、未准入 profile、认证与 Origin',
    controlled: ['E2-SCOPE-AND-PROFILE-GUARDS', 'E2-AUTH-AND-ORIGIN'],
  },
  {
    id: 'ui-desktop',
    label: '桌面 1440×900 主对话中心布局',
    controlled: ['E3-DESKTOP-GEOMETRY'],
  },
  {
    id: 'ui-notebook',
    label: '笔记本 1280×800 布局',
    controlled: ['E3-NOTEBOOK-GEOMETRY'],
  },
  {
    id: 'ui-mobile',
    label: '窄屏 390×844 抽屉、键盘与关闭',
    controlled: ['E3-MOBILE-GEOMETRY', 'E3-KEYBOARD-AND-SCROLL'],
  },
  {
    id: 'ui-states',
    label: '加载/错误/离线与重连状态',
    controlled: ['E3-OFFLINE-AND-ERROR'],
  },
  {
    id: 'ui-download',
    label: '完整 patch 预览与 artifact 下载字节校验',
    controlled: ['E3-ACCEPT-AND-DOWNLOAD'],
    readonly: ['E2-ARTIFACT-ROUNDTRIP'],
  },
  {
    id: 'stability',
    label: '有界混合周期稳定性（受控）',
    controlled: ['E4-BOUNDED-CYCLES'],
    notTested: ['长时间 soak、负载与多实例并发。'],
  },
  {
    id: 'portability-tooling',
    label: '迁移清单验收规则（缺产物/坏 digest/无回滚拒绝）',
    readonly: ['E4-PORTABILITY-CHECKLIST'],
    controlled: ['E4-RECOVERY-PREFLIGHT'],
  },
  {
    id: 'install-first-run',
    label: '新目录/新账户安装与 first-run',
    installed: ['E4-INSTALL-FIRST-RUN', 'E4-INSTALL-REUSE-CONCURRENCY', 'E4-INSTALL-TAMPER', 'E4-INSTALL-CONFIG-ROOT'],
    notTested: ['PA_CONFIG_ROOT 覆盖后 release.json 不随 first-run 写入（owner D，已完成最小复现）。'],
  },
  {
    id: 'backup-restore',
    label: '完整备份、恢复与路径映射',
    installed: ['E4-BACKUP-RESTORE', 'E4-INSTALL-ROLLBACK'],
    notTested: ['恢复后的新授权/重绑定归 main（E4-REAUTHORIZATION NOT_TESTED）；旧项目绑定恢复仍只读。'],
  },
  {
    id: 'upgrade-rollback',
    label: '升级与回滚',
    installed: ['E4-INSTALL-ROLLBACK'],
    notTested: ['真实升级需要第二个冻结 buildId；state 回滚已在同一字节上通过。'],
  },
  {
    id: 'session-catalog',
    label: '会话目录、搜索、CAS 重命名、归档与恢复',
    controlled: ['E2-CONVERSATION-CATALOG', 'E3-CONVERSATION-UI'],
  },
  {
    id: 'attention-signal',
    label: '待办注意信号：未结束工作、归档可见、交付后清除',
    controlled: ['E2-ATTENTION-SIGNAL'],
    notTested: ['真实 decisionDeadline/expiresAt 与多 tab 重叠未验证；本项目只有一个受控项目。'],
  },
  {
    id: 'attention-workbench',
    label: '跨项目注意力收件箱：排序/筛选/分页/逐项打开',
    controlled: ['E3-ATTENTION-INBOX', 'E3-ATTENTION-INBOX-UI', 'E2-ATTENTION-WORKBENCH'],
    notTested: ['真实业务截止与授权过期后的问题失效仍无公开入口（E3-ATTENTION-DEADLINES、E3-DECISION-SOURCE-STATES）；deterministic_priority 排序与逐项动作已通过。'],
  },
  {
    id: 'review-timing',
    label: '验收等待与 UI 活动代理（unknown 不填 0）',
    controlled: ['E2-REVIEW-TIMING', 'E3-REVIEW-ACTIVITY-UI'],
    notTested: ['多 tab 重叠区间并集未直接测量；活动是可见/聚焦代理，不是人工思考时间。'],
  },
  {
    id: 'route-advice',
    label: '推荐建议只在显式实验入口；默认路径关闭',
    readonly: ['E2-ROUTE-FIXTURE'],
    notTested: ['C 的 packages/routing 与 main 的 HTTP/UI 入口未交付；0/1/多候选、身份漂移、旧政策等产品负例无法执行。'],
  },
  {
    id: 'controlled-review',
    label: '冻结候选 + 独立复核 + sealed copy + 人工审阅',
    readonly: ['E3-REVIEW-FIXTURES', 'E3-SEALED-COPY'],
    notTested: ['无 review Work/HTTP/证据发布入口；E3-REVIEW-PIPELINE 未执行。'],
  },
  {
    id: 'heterogeneous-review',
    label: '真实不同协议复核（版本/身份/预算/隔离/主题）',
    notTested: ['第二协议未实现，独立试点 preflight 为 BLOCKED；不能把替换模型或 fixture 当异构。'],
  },
  {
    id: 'project-settings-version',
    label: '项目设置版本化与归档',
    notTested: ['仅合同 revision 已验证；项目设置版本 API 未交付（RFC-E-001 缺口 2）。'],
  },
  {
    id: 'context-proposals-decisions',
    label: '上下文、提案与明确决定治理',
    controlled: ['E3-DECISION-WORKFLOW', 'E3-PROPOSAL-HTTP', 'E3-PROPOSAL-UI'],
    notTested: [
      '自动结构化提案确认仍未发布（owner C/main）；当前只验证显式 prepare/confirm/reject。',
      '源消息删除/授权过期/事务失败注入缺少公开入口（E3-DECISION-SOURCE-STATES）。',
    ],
  },
  {
    id: 'recovery-readonly',
    label: '恢复后首次启动只读、零业务发送',
    controlled: ['E4-RECOVERY-READONLY'],
    notTested: ['解除隔离后的新授权/环境重绑定未实现，不在本轮声明。'],
  },
  {
    id: 'assistant-state',
    label: '明确决定、授权上下文、结构化提案与事务消费',
    controlled: ['E3-DECISION-WORKFLOW'],
    readonly: ['E3-ASSISTANT-SCHEMA-FIXTURES'],
    notTested: ['自动提案确认与撤销后上下文失效未发布。'],
  },
  {
    id: 'distribution',
    label: '可迁移发行、安装、备份恢复、升级回滚',
    installed: [
      'E4-INSTALL-ARTIFACT-IDENTITY',
      'E4-INSTALL-FIRST-RUN',
      'E3-PERSONAL-COLD-START',
      'E4-INSTALL-CONFIG-ROOT',
      'E4-INSTALL-REUSE-CONCURRENCY',
      'E4-BACKUP-RESTORE',
      'E4-INSTALL-TAMPER',
      'E4-INSTALL-ROLLBACK',
    ],
    notTested: [
      '安装矩阵按 tar/sha/build/source/schema 参数化，不再固定 schema13 或端口；跨机器/跨 ABI 未测，只测 darwin/arm64 + Node 24.21.x + ABI 137。',
      '旧 config root 指向不同安装时 first-run 以 release_source_conflict 拒绝且不启动；迁移只经显式 upgrade。',
    ],
  },
  {
    id: 'two-binary-upgrade',
    label: 'D 托管 upgrade/rollback-install 与显式 baseline/target 字节',
    installed: ['E4-UPGRADE-ROLLBACK', 'E4-UPGRADE-CROSS-SCHEMA'],
    notTested: [
      'E4-UPGRADE-FAULTS：PA_UPGRADE_FAULT 崩溃窗口仍未稳定执行，保持 NOT_TESTED；不得以两次 fixture start 代替。',
      '升级前的 writer 资源屏障与旧队列隔离由 main/B 证明；E 只验证数据与二进制行为。',
    ],
  },
  {
    id: 'install-host-guards',
    label: '模式保持、未知活 PID 阻断与不误杀',
    installed: ['E4-INSTALL-HOST-GUARDS', 'E4-MULTI-STATE'],
    notTested: ['E4-MULTI-STATE 观测到 D 真实缺陷：对 state A 的 stop 返回 STOPPED 并杀掉共享安装下 state B 的 API 进程（launcher 仍活），launcher 死/API 活窗口因此无法测量。'],
  },
  {
    id: 'proposal-http',
    label: '结构化提案 prepare/confirm/reject（真实 HTTP/SQLite）',
    controlled: ['E3-PROPOSAL-HTTP'],
    notTested: ['source/grant 漂移与 outer receipt 失败注入未在 HTTP 层单独执行；网页层由 E3-PROPOSAL-UI 覆盖。'],
  },
  {
    id: 'proposal-ui',
    label: '提案网页预览/确认/拒绝与响应丢失重放',
    controlled: ['E3-PROPOSAL-UI'],
  },
  {
    id: 'context-window',
    label: '上下文来源/窗口/授权预览',
    controlled: ['E3-CONTEXT-PREVIEW'],
    notTested: [
      'E5-CONTEXT-USE 未执行：main 只有 preview 与 binding schema，没有 context-use 发送入口/provider 附加、同事务 binding+receipt、未知结果不自动重发和来源审计。',
      'E3-CONTEXT-GRANT-BOUNDARY 仍未执行：expired grant/purpose/超预算的 HTTP 级反例缺少入口。',
    ],
  },
  {
    id: 'recovery-preflight',
    label: '恢复只读 inspect/prepare 与重放/重启边界',
    controlled: ['E4-RECOVERY-PREFLIGHT'],
  },
  {
    id: 'work-evidence',
    label: '工作证据与分页历史',
    controlled: ['E2-WORK-EVIDENCE', 'E2-EVIDENCE-HISTORY'],
    notTested: ['storage_cap 与并发写入窗口未单独触发；历史窗口语义按 complete/caller_limit 已验证。'],
  },
  {
    id: 'recovery-activation',
    label: '恢复授权 commit、目标准备与激活切换',
    notTested: ['commit/activation 未发布；E5-RECOVERY-INTERRUPTION 记录四个中断窗口，prepare 不能替代授权。'],
  },
  {
    id: 'native-control',
    label: '真实原生停止/问题/恢复控制',
    notTested: ['B 的当前真实控制证据未作为输入提供；E 无该预算，不能把 fixture 当原生。'],
  },
  {
    id: 'review-pilot',
    label: '独立会话复核价值试点（8例三组）',
    notTested: [
      'Preflight BLOCKED：adapter_missing（没有经准入的单一实际 adapter 及其整 turn 硬上界/隔离/session/材料/main 准入）；0/24 turn；' +
        'runner 45 项 selftest 证明损坏账/伪造身份/裁小预留/缺接口 fallback 均拒绝且 fake 发送为 0，但没有准入就不发送；无价值结论。',
    ],
  },
  {
    id: 'actual-native',
    label: '真实原生执行、停止、审批与恢复',
    notTested: ['B 的原生证据未作为已提交输入提供；E 未获单独预算，不触发模型任务。'],
  },
]

const rowStatus = (ids) => {
  if (!ids || ids.length === 0) return 'NOT_TESTED'
  const statuses = ids.map(caseStatus)
  if (statuses.every((status) => status === STATUS.PASS)) return 'PASS'
  if (statuses.some((status) => status === STATUS.FAIL)) return 'FAIL'
  return statuses.find((status) => status !== STATUS.PASS) ?? 'UNKNOWN'
}

const rows = CAPABILITIES.map((capability) => {
  const controlled = rowStatus(capability.controlled)
  const sdkMock = rowStatus(capability.sdkMock)
  const readonly = rowStatus(capability.readonly)
  const native = capability.nativeReason ? 'NOT_TESTED' : rowStatus(capability.native)
  const installed = rowStatus(capability.installed)
  const notTested = [...(capability.notTested ?? [])]
  if (capability.nativeReason) notTested.push(capability.nativeReason)
  return {
    id: capability.id,
    capability: capability.label,
    controlledFixture: controlled,
    sdkMock,
    readonly,
    installed,
    actualNative: native,
    gaps: notTested,
    evidence: [...(capability.controlled ?? []), ...(capability.sdkMock ?? []), ...(capability.readonly ?? []), ...(capability.installed ?? [])].filter(
      (id) => byId.has(id),
    ),
  }
})

const matrix = {
  schema: 'product-acceptance-matrix/1',
  agent: 'E',
  source: report.source,
  environment: report.environment,
  checkedAt: report.checkedAt,
  release: { tier: release.tier, status: release.status, failureCodes: release.failures.map((item) => item.code) },
  counts: report.counts,
  rows,
}

const executionStatus = {
  schema: 'agent-execution-status/1',
  agent: stages.agent,
  branch: stages.branch,
  base: stages.base,
  checkpoint: stages.checkpoint,
  head: report.source.commit,
  worktreeDirtyAtRun: report.source.dirty,
  checkedAt: report.checkedAt,
  budget: stages.budget,
  stages: stages.stages.map((stage) => {
    const prefix = `${stage.id}-`
    const relevant = report.cases.filter((item) => item.id.startsWith(prefix))
    const counts = {}
    for (const item of relevant) counts[item.status] = (counts[item.status] ?? 0) + 1
    const blocking = relevant.filter((item) => ['FAIL', 'UNKNOWN', 'BLOCKED'].includes(item.status))
    const result = relevant.length === 0 ? 'SEE_RUN' : blocking.length > 0 ? 'FAIL' : 'PASS_WITH_GAPS'
    return {
      ...stage,
      result: counts.PASS === relevant.length ? 'PASS' : result,
      counts,
      cases: relevant.map((item) => ({ id: item.id, status: item.status, reason: item.reason ?? null })),
    }
  }),
  release,
  runDirectory,
  evidence: {
    report: join(runDirectory, 'report.json'),
    release: join(runDirectory, 'release.json'),
    screenshots: report.artifacts?.screenshots ?? [],
    matrix: join(reports, 'release-matrix.json'),
    executionStatus: join(reports, 'execution-status.json'),
    wave09Status: join(reports, 'wave09-status.json'),
    wave10Status: join(reports, 'wave10-status.json'),
    wave08Status: join(reports, 'wave08-status.json'),
    wave07Status: join(reports, 'wave07-status.json'),
    wave06Status: join(reports, 'wave06-status.json'),
    tierVerdicts: join(reports, 'tier-verdicts.json'),
  },
  blockers: rows.filter((row) => ['FAIL'].includes(row.controlledFixture) || row.installed === 'FAIL' || row.actualNative === 'FAIL'),
  untested: rows
    .filter((row) => row.gaps.length > 0 || row.controlledFixture === 'NOT_TESTED')
    .map((row) => ({ id: row.id, gaps: row.gaps })),
  externalBlockers: [
    { owner: 'D', code: 'stop_claims_other_state', detail: 'One install, two state roots: `pa stop --data-root <state A>` returned 0/STOPPED while state B was recorded, and state B\'s API process died (launcher remained). Minimal repro: start A, stop A, start B, then stop with A\'s data root; observed exit 0, bAlive true, bApiAlive false. D must bind the instance record to the exact state root and refuse to stop another state.' },
    { owner: 'main/C', detail: 'Context preview and evidence history are verified over real HTTP; context use (explicit selection, pre-send revalidation, same-transaction binding/receipt, no auto-resend, source audit) and recovery activation are unpublished.' },
    { owner: 'main', detail: 'Migration ownership and review Work/Ticket/Assignment publication remain outside current main, so E3-REVIEW-PIPELINE stays NOT_TESTED.' },
    { owner: 'D', detail: 'The wave-09 target tuple (6830e38 build f2390ffd, schema 15) passes byte-for-byte, personal cold start and same-schema managed upgrade; cross-schema old-binary refusal is measured. Any newer target must be named with its own tar/source/build/schema and independently re-tested.' },
    { owner: 'B', detail: 'Native ledger/results are not supplied as input and E has no budget, so actual-native and native control evidence are absent.' },
  ],
  next: [
    'D: bind the single install instance record to its exact data root and make a stop aimed at another state refuse without signalling that state\'s launcher/API; then E can measure launcher-dead/API-alive and PID/start reuse windows.',
    'C/main: publish automatic proposal/context confirmation, the context-use send path (explicit selection, revalidation, same-transaction binding/receipt, no auto-resend, source audit) and recovery activation; E then converts E5-CONTEXT-USE and E5-RECOVERY-INTERRUPTION from NOT_TESTED.',
    'D: keep the target immutable; a new target needs its own explicit identity (tar/sha/source/build/schema) and a fresh E4 run, not a mapping from build f2390ffd.',
    'B: hand off native evidence bound to commit/attempt/command with executed=true and model-task counts; only a separately granted budget lets E re-run native.',
    'Main: treat controlled-product-workflow PASS as workflow evidence only; local-alpha and full-product remain non-zero until installation and native evidence exist.',
  ],
}

const tierVerdicts = {}
for (const name of ['module', 'controlled-product', 'actual-native-control', 'installed-alpha', 'advisory-routing', 'controlled-review', 'actual-heterogeneous-review', 'review-value', 'local-alpha', 'full-product']) {
  tierVerdicts[name] = evaluateRelease({
    report,
    requirement: releaseTier(name),
    expectedSource: report.source.commit,
    resolveFixture: resolveFixtureDigest,
  })
}

const stageSummary = (id) => {
  const entry = executionStatus.stages.find((item) => item.id === id)
  if (!entry?.counts) return entry?.result ?? 'SEE_RUN'
  return Object.entries(entry.counts)
    .map(([status, count]) => `${status} ${count}`)
    .join(' + ')
}

/** Counts for one real command, derived from the case ids it produced in this run. */
const commandSummary = (prefixes) => {
  const relevant = report.cases.filter((item) => prefixes.some((prefix) => item.id.startsWith(prefix)))
  if (relevant.length === 0) return '无病例'
  const counts = {}
  for (const item of relevant) counts[item.status] = (counts[item.status] ?? 0) + 1
  return Object.entries(counts)
    .map(([status, count]) => `${status} ${count}`)
    .join(' + ')
}

const handoff = `# Agent E 第十轮交付交接

- 分支 \`${stages.branch}\`，基线 \`${stages.base}\`，检查点 \`${stages.checkpoint}\`，本次证据源 \`${report.source.commit}\`${report.source.dirty ? '（运行时尚有未提交文件，最终提交包含它们）' : '（干净工作树）'}。证据文件随源提交之后的提交一起交付；\`git log\` 的分支头即最终交付提交。
- 拥有路径：\`tests/product-acceptance/\`。未修改生产实现、root manifest/lock、公共 schema 或迁移。
- 模型预算：0 个真实模型任务；唯一模型对端是本机 loopback mock。原生执行：0。

## 实际命令与结果

| 真实命令 | 覆盖病例 | 结果 |
| --- | --- | --- |
| \`node tests/product-acceptance/pilot/harness.mjs --preflight\` | 冻结输入/价格/ledger | ${pilotPreflight.status === 'BLOCKED' ? `BLOCKED（${[...new Set(pilotPreflight.reasons.map((item) => item.code))].join(', ')}）` : pilotPreflight.status}；runner selftest ${pilotPreflight.runnerSelfTest?.passes ?? '?'}/17 |
| \`node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only\` | E1-* | ${commandSummary(['E1-'])} |
| \`node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow\` | E2-* | ${commandSummary(['E2-'])} |
| \`node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui\` | E3-* | ${commandSummary(['E3-'])} |
| \`node tests/product-acceptance/run.mjs --suites=e4 --tier=installed-alpha\` | E4-* / E5-NATIVE-CONTROL / E6-REVIEW-PILOT | ${commandSummary(['E4-', 'E5-NATIVE-CONTROL', 'E6-REVIEW-PILOT'])} |
| \`node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record\` | 全部 ${report.cases.length} | ${Object.entries(report.counts).map(([status, count]) => `${status} ${count}`).join(' + ')} |

本次聚合：**${release.status}**（tier \`${release.tier}\`）。证据目录 \`${runDirectory}\`。

## 矩阵摘要

| 能力 | 受控 fixture | SDK mock | 只读 | 安装（同一字节） | 实际原生 |
| --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (row) =>
      `| ${row.capability} | ${row.controlledFixture} | ${row.sdkMock} | ${row.readonly} | ${row.installed} | ${row.actualNative} |`,
  )
  .join('\n')}

完整数据见 \`release-matrix.json\`。

## 分开的三类结论

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 研究价值（独立会话复核是否值得继续） | **BLOCKED — 无价值结论** | 8 例三组一例未发；adapter_missing（无经准入的实际 adapter/整 turn 上界/隔离/材料/main 准入）；0/24 turn。BLOCKED 不是 no-go，也不是正收益。 |
| 产品准入（普通受控工作流） | 见 \`controlled-product-workflow\` tier | 真实 HTTP/SQLite/受控执行，不依赖试点。 |
| 安装准入（个人 Alpha） | **${tierVerdicts['installed-alpha'].status}（仅所测 tuple）**：cold install/config root/doctor、普通 personal cold start、模式保持、备份恢复、托管 upgrade、升级后新数据、binary-only rollback、跨 schema 精确拒绝 | E3-PERSONAL-COLD-START、E4-INSTALL-*、E4-BACKUP-RESTORE、E4-INSTALL-ROLLBACK、E4-UPGRADE-ROLLBACK、E4-UPGRADE-CROSS-SCHEMA。E4-MULTI-STATE 观测到 D 的 stop 误杀另一 state；E4-UPGRADE-FAULTS 仍 NOT_TESTED。 |

安装物身份（从本轮真实 tar tuple 读取，位置可用 PA_E_INSTALL_*_DIR 覆盖）：baseline buildId \`${artifactTuple.baseline?.buildId ?? 'unknown'}\` / schema ${artifactTuple.baseline?.schema ?? '?'} / tar \`${String(artifactTuple.baseline?.tarSha256 ?? '').slice(0, 8)}…\` / source \`${String(artifactTuple.baseline?.source ?? '').slice(0, 8)}\`；target buildId \`${artifactTuple.target?.buildId ?? 'unknown'}\` / schema ${artifactTuple.target?.schema ?? '?'} / tar \`${String(artifactTuple.target?.tarSha256 ?? '').slice(0, 8)}…\` / source \`${String(artifactTuple.target?.source ?? '').slice(0, 8)}\`。均为 darwin/arm64、Node 24.21.0、SQLite ABI 137。verdict 只对所测 tuple 成立，旧版本结果未改标签。

## 独立复核价值试点

- 预注册协议：\`tools/experiments/review-pilot-01/protocol.json\`（24 turn / 20万 token / 5 USD）。
- 冻结输入：8 个合成候选（4 个预埋缺陷、4 个干净）、隐藏 oracle 测试、评分规则均已 hash；\`node tests/product-acceptance/pilot/harness.mjs --freeze --check\` 可复验。
- 预检：**BLOCKED (adapter_missing)**。没有经准入的单一实际 adapter（精确 executable/version/model/provider、全部计费组件的整 turn 硬上界、隔离、session、材料与 main 准入）；缺接口时**不回退 CLI**。价格文件本身不授权。**0/24 turn、0 token、USD unknown、0 unknown send**；ledger 保留原值，预检只标注。
- 执行链已不是占位：E 不再自己拼 CLI；唯一发送入口是 B 拥有的 sender 模块（E 只 import 并传 reservationId，不 spawn 命令），E 只做持久预留。作者 turn → 冻结真实 candidate 摘要 → 同一 session 续会话复核 → 全新 session 在密封副本复核 → 严格报告校验与评分。每次发送前持久预留，预检/失败不覆盖账；unknown 用量按预留上界计费并转 BLOCKED_UNKNOWN_USAGE，之后不再发送。
- 账本与预留已按 wave-07 收紧：已存在但损坏/字段错/历史缺失/伪造身份的 ledger 不回退全零；预留使用 adapter 声明的整 turn 上界（无字节估算或 Math.min 裁小），并发写入串行化，重复预留/结算幂等，measured overrun 直接 BLOCKED_BOUND_VIOLATION。
- \`--selftest\` 66 项通过（v1 legacy 全套身份/上限/历史/unknown 拒绝、损坏/伪造账、并发锁、单 turn 在途、预留先于发送、完整计费链：只有 totalTokens 时 costOf 返回 unknown 并按上界计费阻断、越界阻断、sender 必须回显 reservation 身份、缺 B sender 模块不发送）；它证明会计与准入，不是收益结果。
- 干跑：\`--dry-run\` 用合成报告验证评分/预算/拒绝机制（检出、误报、缺 usage、预算不一致、挑例、改 oracle、报告越权均被正确处理）；干跑不是收益结果。
- 要解除阻断：操作者提供 \`pilot/pricing.json\`（model、inputPerMillion、outputPerMillion、USD、source、observedAt）；预检 PASS 后才允许 \`--execute --confirm-grant\`，且仍受原 24/200000/USD5 上限。

## Tier 判定（同一份证据）

| tier | 结果 |
| --- | --- |
${Object.entries(tierVerdicts)
  .map(([name, verdict]) => `| \`${name}\` | ${verdict.status}${verdict.failures.length ? `（${[...new Set(verdict.failures.map((item) => item.code))].join(', ')}）` : ''} |`)
  .join('\n')}

## 明确未测

${rows
  .filter((row) => row.gaps.length)
  .map((row) => `- **${row.capability}**：${row.gaps.join('；')}`)
  .join('\n')}

## 限制

- 受控 fixture lane 的 \`native_applied\` 表示受控协议 ACK，不是真实厂商 agent 行为。
- RSS/FD/磁盘是单实例观察；端口不变不能证明无进程泄漏。
- 截图与几何断言只证明可达/不溢出/不重叠，不评价美观。
- 推荐/复核仍只在实验入口；advisory/controlled-review/heterogeneous tier 因生产者缺失而非零。
- 真实 native 投递/控制证据缺失，因此 \`full-product\` 仍被 gate 拒绝；\`installed-alpha\` 与 \`local-alpha\` 只对所测 baseline→target 组合成立，且当前 D 的跨 state stop 缺陷使 installed-alpha 不能放行。
- 试点被预检阻断，不能把 harness 或干跑当作价值已验证。

## 下一消费者

1. D：先修 \`stop\` 的 state 归属：单 install 多 state 时，针对 state A 的 stop 必须拒绝且不得信号 state B 的 launcher/API；再补 launcher 死/API 活与 PID/start reuse 窗口。最小复现见 \`externalBlockers.stop_claims_other_state\`。
2. main/C：发布 context-use 发送路径（显式选择、发送前复验、同事务 binding/receipt、unknown 不自动重发、来源审计）与 recovery activation；E 再把 E5-CONTEXT-USE / E5-RECOVERY-INTERRUPTION 转成实测。
3. B：提供绑定 commit/attempt 的原生证据（\`executed: true\` + model task 计数）；E 只消费，不重跑计费任务。
4. 主线：审阅 \`RFC-E-001-consumer-interfaces.zh-CN.md\`；E 不复制生产类型。旧安装结果与 wave09 ledger 原样保留。

## 复验命令

\`\`\`sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r --filter '@personal-agent/*' build
node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only
node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow
node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui
node tests/product-acceptance/pilot/harness.mjs --selftest
node tests/product-acceptance/run.mjs --suites=e4 --tier=e4-bounded-stability
node tests/product-acceptance/run.mjs --suites=e4 --tier=installed-alpha
node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record
\`\`\`

最后一条命令以 \`controlled-product-workflow\` 聚合；同一份报告还要分别用 \`--tier=installed-alpha\` 与 \`--tier=review-value\` 判读，任何缺失的必需项都会让该 tier 保持非零。
`

writeFileSync(join(reports, 'release-matrix.json'), JSON.stringify(matrix, null, 2) + '\n')
writeFileSync(join(reports, 'execution-status.json'), JSON.stringify(executionStatus, null, 2) + '\n')
writeFileSync(
  join(reports, 'wave10-status.json'),
  JSON.stringify({ ...executionStatus, schema: 'product-acceptance-wave10-status/1', taskPackage: 'agent-tasks/product-wave-10/README.zh-CN.md', supersedes: 'wave09-status.json', artifactTuple }, null, 2) + '\n',
)
// Historical wave06-09 status files are frozen inputs; wave10 supersedes rather than rewrites them.
writeFileSync(join(reports, 'handoff.zh-CN.md'), handoff)

// Over-claim check: the same recorded evidence must fail the full-product tier while native and
// installation evidence are absent. This is recorded, not asserted from the outside.
const overclaim = evaluateRelease({
  report,
  requirement: releaseTier('full-product'),
  expectedSource: report.source.commit,
  resolveFixture: resolveFixtureDigest,
})
writeFileSync(join(reports, 'full-product-verdict.json'), JSON.stringify(overclaim, null, 2) + '\n')
writeFileSync(join(reports, 'tier-verdicts.json'), JSON.stringify(tierVerdicts, null, 2) + '\n')

process.stdout.write(
  `matrix rows ${rows.length}; release ${release.status}; full-product ${overclaim.status} ` +
    `(${overclaim.failures.map((item) => item.code).join(', ')}); wrote execution-status.json, ` +
    `release-matrix.json, handoff.zh-CN.md, full-product-verdict.json\n`,
)
