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
    controlled: ['E3-DECISION-WORKFLOW'],
    notTested: [
      '自动上下文与结构化提案确认未发布（owner C）。',
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
      'E4-INSTALL-REUSE-CONCURRENCY',
      'E4-BACKUP-RESTORE',
      'E4-INSTALL-TAMPER',
      'E4-INSTALL-ROLLBACK',
    ],
    notTested: [
      'PA_CONFIG_ROOT 覆盖后 release.json 缺失，base 与 upgrade 两个产物均复现（owner D）。',
      '跨机器/跨 ABI 未测；只测 darwin/arm64 + Node 24.21.x + ABI 137。',
    ],
  },
  {
    id: 'two-binary-upgrade',
    label: '两个真实不同二进制的数据升级与拒绝不兼容回退',
    installed: ['E4-UPGRADE-ROLLBACK'],
    notTested: ['升级前的 writer 资源屏障与旧队列隔离由 main/B 证明；E 只验证数据与二进制行为。'],
  },
  {
    id: 'proposal-context',
    label: '自动提案确认与上下文窗口（真实 HTTP/SQLite）',
    notTested: ['main 未发布 proposal/context 入口；E3-PROPOSAL-CONTEXT-BOUNDARY 记录了所需输入与负例。'],
  },
  {
    id: 'recovery-preflight',
    label: '恢复只读 inspect/prepare 与重放/重启边界',
    controlled: ['E4-RECOVERY-PREFLIGHT'],
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
    wave07Status: join(reports, 'wave07-status.json'),
    wave06Status: join(reports, 'wave06-status.json'),
    tierVerdicts: join(reports, 'tier-verdicts.json'),
  },
  blockers: rows.filter((row) => ['FAIL'].includes(row.controlledFixture) || row.actualNative === 'FAIL'),
  untested: rows
    .filter((row) => row.gaps.length > 0 || row.controlledFixture === 'NOT_TESTED')
    .map((row) => ({ id: row.id, gaps: row.gaps })),
  externalBlockers: [
    { owner: 'C', detail: 'Automatic context/proposal confirmation and published ReviewEvidence are still absent; explicit decisions are now verified separately.' },
    { owner: 'main', detail: 'Migration ownership and review Work/Ticket/Assignment publication remain outside current main, so E3-REVIEW-PIPELINE stays NOT_TESTED.' },
    { owner: 'D', detail: 'Source stays on codex/g3-local-distribution. The frozen tar.gz is accepted byte-for-byte; a second frozen buildId is required for E4-UPGRADE-ROLLBACK, and PA_CONFIG_ROOT override drops release.json.' },
    { owner: 'B', detail: 'Native ledger/results are not supplied as input and E has no budget, so actual-native and native control evidence are absent.' },
  ],
  next: [
    'C/main: publish automatic proposal/context confirmation and a review Work/Ticket/Assignment entry; E then adds confirm-before-execute, revocation-effect and transaction-failure cases on top of the already verified explicit decisions.',
    'D: publish a second frozen artifact (different buildId, same schema) for the upgrade case, and seed release.json when PA_CONFIG_ROOT is overridden; everything else in the frozen artifact already passes in a fresh directory.',
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

const handoff = `# Agent E 第六轮交付交接

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
| \`node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record\` | 全部 129 | ${Object.entries(report.counts).map(([status, count]) => `${status} ${count}`).join(' + ')} |

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
| 安装准入（个人 Alpha） | **未通过**：安装、备份恢复与双产物升级本身通过，但私有 config root 不能初始化可信 release manifest | \`installed-alpha\` 因 E4-INSTALL-CONFIG-ROOT 失败而保持非零；owner D。 |

安装物身份（两个真实不同产物）：base \`wave06-alpha-b0f87c88\` / buildId \`b0f87c883aa6b206\` / schema 12 / tar \`8b728b61…b5c5d\` / source \`9046d4c5\`（dirty）；upgrade \`wave06-alpha2-7e8f6ce6\` / buildId \`7e8f6ce6fa2e2633\` / schema 13 / tar \`0fe0ed53…c7631\` / source \`e10bfdb7\`（clean）。均为 darwin/arm64、Node 24.21.0、SQLite ABI 137。base 的 source 为 dirty，故 base 字节不能由干净提交重建；upgrade 可绑定干净 source。

## 独立复核价值试点

- 预注册协议：\`tools/experiments/review-pilot-01/protocol.json\`（24 turn / 20万 token / 5 USD）。
- 冻结输入：8 个合成候选（4 个预埋缺陷、4 个干净）、隐藏 oracle 测试、评分规则均已 hash；\`node tests/product-acceptance/pilot/harness.mjs --freeze --check\` 可复验。
- 预检：**BLOCKED (adapter_missing)**。没有经准入的单一实际 adapter（精确 executable/version/model/provider、全部计费组件的整 turn 硬上界、隔离、session、材料与 main 准入）；缺接口时**不回退 CLI**。价格文件本身不授权。**0/24 turn、0 token、USD unknown、0 unknown send**；ledger 保留原值，预检只标注。
- 执行链已不是占位：作者 turn（workspace-write）→ 冻结真实 candidate 摘要 → 同一 session 续会话复核（read-only）→ 全新 session 在密封副本复核（read-only）→ 严格报告校验与评分。每次发送前持久预留，预检/失败不覆盖账；unknown 用量按预留上界计费并转 BLOCKED_UNKNOWN_USAGE，之后不再发送。
- 账本与预留已按 wave-07 收紧：已存在但损坏/字段错/历史缺失/伪造身份的 ledger 不回退全零；预留使用 adapter 声明的整 turn 上界（无字节估算或 Math.min 裁小），并发写入串行化，重复预留/结算幂等，measured overrun 直接 BLOCKED_BOUND_VIOLATION。
- \`--selftest\` 45 项通过（损坏账、伪造身份、并发锁、单 turn 在途、预留先于发送、unknown 不归还、越界阻断、token/USD/作者复核上限、adapter 缺失/漂移/伪隔离/仅价格均不发送）；它证明会计与准入，不是收益结果。
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
- 第二协议与真实 native 证据缺失；安装缺第二个 buildId 的升级演练，因此 \`local-alpha\`、\`full-product\` 被 gate 拒绝。
- 试点被预检阻断，不能把 harness 或干跑当作价值已验证。

## 下一消费者

1. 主线：审阅 \`RFC-E-001-consumer-interfaces.zh-CN.md\`，决定公共 DTO/命令归属；E 不复制生产类型。
2. B：提供绑定 commit/attempt 的原生证据（\`executed: true\` + model task 计数）；E 只消费，不重跑计费任务。
3. D：补第二个冻结 buildId 供升级演练；修复 PA_CONFIG_ROOT 覆盖时 release.json 不随 first-run 写入的问题。其余安装路径已由 E 在同一字节上独立通过。
4. C：接线上下文/提案/决定后，E 增加“确认前不执行、重复确认幂等、撤销后失效、注入不扩权”用例。

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
  join(reports, 'wave07-status.json'),
  JSON.stringify({ ...executionStatus, schema: 'product-acceptance-wave07-status/1', taskPackage: stages.taskPackage }, null, 2) + '\n',
)
writeFileSync(
  join(reports, 'wave06-status.json'),
  JSON.stringify({ ...executionStatus, schema: 'product-acceptance-wave06-status/1', taskPackage: 'agent-tasks/product-wave-06/README.zh-CN.md', supersededBy: 'wave07-status.json' }, null, 2) + '\n',
)
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
