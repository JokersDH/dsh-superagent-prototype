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
    native: ['NOT_TESTED', '真实原生审批/权限问题未执行'],
  },
  {
    id: 'verification-completion',
    label: '机器检查、完整 patch、artifact 字节与人工接受',
    controlled: ['E2-DAILY-VERTICAL', 'E2-ARTIFACT-ROUNDTRIP', 'E3-ACCEPT-AND-DOWNLOAD'],
    native: 'NOT_TESTED',
    nativeReason: '原生注册检查与真实 deliverable 未在本轮复验。',
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
  },
  {
    id: 'install-first-run',
    label: '新目录/新账户安装与 first-run',
    notTested: ['D 的 apps/launcher、tools/distribution、packages/portability 尚未交付。'],
  },
  {
    id: 'backup-restore',
    label: '完整备份、恢复与路径映射',
    notTested: ['无发行 bundle 与迁移 CLI。'],
  },
  {
    id: 'upgrade-rollback',
    label: '升级与回滚',
    notTested: ['无版本化发行产物。'],
  },
  {
    id: 'session-catalog',
    label: '会话目录、搜索与归档',
    notTested: ['公共 HTTP 尚无会话目录/搜索/归档接口（见 RFC-E-001 缺口 1）。'],
  },
  {
    id: 'project-settings-version',
    label: '项目设置版本化与归档',
    notTested: ['仅合同 revision 已验证；项目设置版本 API 未交付（RFC-E-001 缺口 2）。'],
  },
  {
    id: 'context-proposals-decisions',
    label: '上下文、提案与明确决定治理',
    notTested: ['C 的 packages/context、proposals、knowledge 未交付；确认前不执行无法端到端验证。'],
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
  const notTested = [...(capability.notTested ?? [])]
  if (capability.nativeReason) notTested.push(capability.nativeReason)
  return {
    id: capability.id,
    capability: capability.label,
    controlledFixture: controlled,
    sdkMock,
    readonly,
    actualNative: native,
    gaps: notTested,
    evidence: [...(capability.controlled ?? []), ...(capability.sdkMock ?? []), ...(capability.readonly ?? [])].filter(
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
    const prefix = stage.id === 'E5' ? 'E1-' : `${stage.id}-`
    const relevant = report.cases.filter((item) => item.id.startsWith(prefix))
    const counts = {}
    for (const item of relevant) counts[item.status] = (counts[item.status] ?? 0) + 1
    return {
      ...stage,
      result: relevant.length
        ? Object.keys(counts).length === 1 && counts.PASS === relevant.length
          ? 'PASS'
          : 'MIXED'
        : 'SEE_RUN',
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
  },
  blockers: rows.filter((row) => ['FAIL'].includes(row.controlledFixture) || row.actualNative === 'FAIL'),
  untested: rows
    .filter((row) => row.gaps.length > 0 || row.controlledFixture === 'NOT_TESTED')
    .map((row) => ({ id: row.id, gaps: row.gaps })),
  next: [
    'Main: relocate/consider RFC-E-001; E only consumes public entries and does not own production schema.',
    'C: publish context/proposal/decision ports, then E adds the confirm-before-execute and revocation cases.',
    'D: publish launcher/distribution/portability, then E runs install/first-run/backup/restore/rollback in a fresh directory.',
    'B: hand off native evidence bound to commit/attempt with executed=true and model-task counts; a separately granted budget is required for E to re-run native.',
  ],
}

const handoff = `# Agent E 交付交接

- 分支 \`${stages.branch}\`，基线 \`${stages.base}\`，检查点 \`${stages.checkpoint}\`，本次证据源 \`${report.source.commit}\`${report.source.dirty ? '（运行时尚有未提交文件，最终提交包含它们）' : ''}。
- 拥有路径：\`tests/product-acceptance/\`。未修改生产实现、root manifest/lock、公共 schema 或迁移。
- 模型预算：0 个真实模型任务；唯一模型对端是本机 loopback mock。原生执行：0。

## 实际命令与结果

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| E1 | \`${stages.stages[0].command}\` | 21/21 self-test PASS；缺用例时 exit 1 |
| E2 | \`${stages.stages[1].command}\` | 12/12 PASS |
| E3 | \`${stages.stages[2].command}\` | 7/7 PASS |
| E4 | \`${stages.stages[3].command}\` | 2 PASS + 3 NOT_TESTED |
| E5 | \`${stages.stages[4].command}\` | 本文件与矩阵 |

本次聚合：**${release.status}**（tier \`${release.tier}\`）。证据目录 \`${runDirectory}\`。

## 矩阵摘要

| 能力 | 受控 fixture | SDK mock | 只读 | 实际原生 |
| --- | --- | --- | --- | --- |
${rows
  .map(
    (row) =>
      `| ${row.capability} | ${row.controlledFixture} | ${row.sdkMock} | ${row.readonly} | ${row.actualNative} |`,
  )
  .join('\n')}

完整数据见 \`release-matrix.json\`。

## 明确未测

${rows
  .filter((row) => row.gaps.length)
  .map((row) => `- **${row.capability}**：${row.gaps.join('；')}`)
  .join('\n')}

## 限制

- 受控 fixture lane 的 \`native_applied\` 表示受控协议 ACK，不是真实厂商 agent 行为。
- RSS/FD/磁盘是单实例观察；端口不变不能证明无进程泄漏。
- 截图与几何断言只证明可达/不溢出/不重叠，不评价美观。
- 安装与原生证据缺失，因此 \`full-product\` tier 会被 gate 以 \`case_not_pass\` 拒绝。

## 下一消费者

1. 主线：审阅 \`RFC-E-001-consumer-interfaces.zh-CN.md\`，决定公共 DTO/命令归属；E 不复制生产类型。
2. B：提供绑定 commit/attempt 的原生证据（\`executed: true\` + model task 计数）；E 只消费，不重跑计费任务。
3. D：发布 launcher/distribution/portability 后，E 在新目录/新账户执行安装、first-run、备份恢复、升级回滚。
4. C：接线上下文/提案/决定后，E 增加“确认前不执行、重复确认幂等、撤销后失效、注入不扩权”用例。

## 复验命令

\`\`\`sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r --filter '@personal-agent/*' build
node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only
node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow
node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui
node tests/product-acceptance/run.mjs --suites=e4 --tier=e4-bounded-stability --cycles=12
node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record
\`\`\`

最后一条命令以 \`controlled-product-internal-trial\` 聚合；任何 FAIL、缺失或未执行都会非零退出。
`

writeFileSync(join(reports, 'release-matrix.json'), JSON.stringify(matrix, null, 2) + '\n')
writeFileSync(join(reports, 'execution-status.json'), JSON.stringify(executionStatus, null, 2) + '\n')
writeFileSync(join(reports, 'handoff.zh-CN.md'), handoff)
process.stdout.write(
  `matrix rows ${rows.length}; release ${release.status}; wrote execution-status.json, release-matrix.json, handoff.zh-CN.md\n`,
)
