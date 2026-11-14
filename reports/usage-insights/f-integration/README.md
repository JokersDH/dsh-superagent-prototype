# F 接入说明：效率观测 summary

本目录是 G 交付给体验层（F）的稳定接口样例。F 不实现第二套统计，只渲染这里提供的聚合值与
unknown/coverage/限制。main 负责在根 workspace 注册 `@personal-agent/usage-insights` 依赖与导出。

## 契约

浏览器只消费已验证的 summary，**不要** import 包根（分析依赖 Node `crypto`）：

```ts
// 浏览器 / UI bundle
import { toInsightConsumerView, consumerAdmission } from '@personal-agent/usage-insights/browser'
import type { UsageInsightsSummary } from '@personal-agent/usage-insights/browser'

const summary: UsageInsightsSummary = /* main 的授权 Node 读取产出的稳定 JSON */
const view = toInsightConsumerView(summary)
const admission = consumerAdmission(view, activeProjectId)

// Node / coordinator
import { analyzeUsageInsights, composeUsageInsightsInput } from '@personal-agent/usage-insights'
```

包 `exports` 已分离：`.` 是 Node 分析入口（含 composition、crypto、采集），`./browser` 只含
协议类型、投影与 admission 镜像，不触及 `node:` 内置模块（有 import-graph 测试守住）。

`view` 与 `apps/console/src/trial/insights.ts` 的 `TrialInsightsView` **结构完全一致**，可直接赋值：

```ts
interface TrialInsightsView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  readonly windowLabel?: string
  readonly coverage?: string
  readonly coverageState?: 'complete' | 'partial' | 'unknown'
  readonly scope?: {
    readonly projectIds: readonly string[]
    readonly aggregation: 'single_project' | 'declared_multi_project' | 'cross_project'
    readonly label?: string
  }
  readonly sampleCount: number | null
  readonly unknownCount?: number | null
  readonly metrics: readonly {
    readonly id: string; readonly label: string; readonly value: string | null
    readonly detail?: string; readonly unit?: string
    readonly layer?: 'observed' | 'controlled' | 'native' | 'operator' | 'unknown'
    readonly sampleCount?: number | null
  }[]
  readonly limitations: readonly string[]
  readonly partial: boolean
}
```

G 的 `test/consumer.case.ts` 里保留该形状的本地副本并有编译期赋值断言：任何一侧改字段都会编译失败，
而不是在运行时被默认值掩盖。

## 语义

| 字段 | 规则 |
| --- | --- |
| `status` | `unavailable`：来源缺失/未采集；`insufficient_data`：没有任何可测样本，**或**有记录被隔离（部分未知，不展示为完整）；`ready`：有真实样本且无隔离 |
| `scope` | 指标覆盖的项目与聚合类型。`projectIds` 非空才是声明范围；**两个及以上项目是 `cross_project`**，标签写明"跨项目（N 个项目）"，不会被画成当前单项目总计 |
| `coverageState` | `complete`/`partial`/`unknown`，与 `coverage` 文本同源 |
| `unknownCount` | 固定为 `null`：各行统计不同对象（outcome/介入/币种），相加会编造总数 |
| `metrics[].layer` | `observed`（产品交互记录）/`controlled`/`native`/`operator`/`unknown`，由记录层映射而来，不升级 |
| `metrics[].sampleCount` | 不可用行为 `null`，不是 0 |
| `partial` | `true` 表示可用但不完整：有界来源、代理指标、陈旧/缺失快照或有隔离记录。**F 必须显示这个标记，不能给"完整"徽章** |
| `value` | 已格式化字符串；**未知保持 `null`**，不写 `0`、不写 `''`、不补默认值 |
| `sampleCount` | 实际观察到的 outcome 数；来源缺失时为 `null`；完整空窗口为 `0` |
| `coverage` | 整体覆盖的展示文本（完整/部分/来源缺失/未采集/不支持） |
| `detail` | 样本数、未知数、覆盖、证据层；层名保留原值（`controlled`/`actual_native`/…） |
| `limitations` | 必须原样展示的边界（例如 activeReview 只是 UI 可见性代理、cost 未知不补价） |

F 只能用 `status === 'ready'` 显示 `trialInsightsRows(view)`；`insufficient_data`/`unavailable`
不显示数字。G 不产生"提升百分比""节省工时"字段，F 也不应自行计算。

## 准入

`consumerAdmission(view, activeProjectId?)` 与工作台 `trialInsightsAdmission` 规则一致：
`ready`、非空 `scope.projectIds`、当前项目在范围内、`windowLabel`、`coverage`、非空指标，缺一即拒绝并给出原因。
F 自己仍会再校验一次；Node 侧提前判可以避免生成会被 UI 静默隐藏的视图。

## 样例

- [`consumer-view.example.json`](consumer-view.example.json)：由
  [`probe/two-project-20261114T074222.bundle.json`](../probe/two-project-20261114T074222.bundle.json)
  经 `analyzeUsageInsights` + `toInsightConsumerView` 生成，含已知值、`null` 未知项与限制文本。
- 该样例的数据层是 `controlled`：来自受控产品运行时真实的 create/question/answer/verify/accept 链，
  **不是** `actual_native`；样例中没有原生执行，报告与 summary 都保持 `NOT_TESTED`。

## 复现

```sh
pnpm --dir packages/usage-insights build
node -e "import('./packages/usage-insights/dist/index.js').then(async m => {
  const { readFileSync } = await import('node:fs')
  const bundle = JSON.parse(readFileSync('reports/usage-insights/probe/two-project-20261114T074222.bundle.json','utf8'))
  console.log(JSON.stringify(m.toInsightConsumerView(m.analyzeUsageInsights(bundle).summary), null, 2))
})"
```

`toInsightConsumerView` 只做投影：同输入必得同输出，不读时钟、不读文件、不做网络请求。
