# F 接入说明：效率观测 summary

本目录是 G 交付给体验层（F）的稳定接口样例。F 不实现第二套统计，只渲染这里提供的聚合值与
unknown/coverage/限制。main 负责在根 workspace 注册 `@personal-agent/usage-insights` 依赖与导出。

## 契约

```ts
import { analyzeUsageInsights, toInsightConsumerView } from '@personal-agent/usage-insights'
import type { UsageInsightsSummary } from '@personal-agent/usage-insights'

const summary: UsageInsightsSummary = /* 由 CLI collect+analyze 生成的 bundle 分析结果，或 main 注入的稳定 JSON */
const view = toInsightConsumerView(summary)
```

`view` 与 `apps/console/src/trial/insights.ts` 的 `TrialInsightsView` **结构完全一致**，可直接赋值：

```ts
interface TrialInsightsView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  readonly windowLabel?: string
  readonly sampleCount: number | null
  readonly coverage?: string
  readonly metrics: readonly { readonly id: string; readonly label: string; readonly value: string | null; readonly detail?: string }[]
  readonly limitations: readonly string[]
}
```

G 的 `test/consumer.case.ts` 里保留该形状的本地副本并有编译期赋值断言：任何一侧改字段都会编译失败，
而不是在运行时被默认值掩盖。

## 语义

| 字段 | 规则 |
| --- | --- |
| `status` | `unavailable`：来源缺失/未采集；`insufficient_data`：窗口完整但没有任何可测样本；`ready`：至少一个 outcome 指标有真实值 |
| `value` | 已格式化字符串；**未知保持 `null`**，不写 `0`、不写 `''`、不补默认值 |
| `sampleCount` | 实际观察到的 outcome 数；来源缺失时为 `null`；完整空窗口为 `0` |
| `coverage` | 整体覆盖的展示文本（完整/部分/来源缺失/未采集/不支持） |
| `detail` | 样本数、未知数、覆盖、证据层；层名保留原值（`controlled`/`actual_native`/…） |
| `limitations` | 必须原样展示的边界（例如 activeReview 只是 UI 可见性代理、cost 未知不补价） |

F 只能用 `status === 'ready'` 显示 `trialInsightsRows(view)`；`insufficient_data`/`unavailable`
不显示数字。G 不产生"提升百分比""节省工时"字段，F 也不应自行计算。

## 样例

- [`consumer-view.example.json`](consumer-view.example.json)：由
  [`probe/two-project-20261108T120000Z.bundle.json`](../probe/two-project-20261108T120000Z.bundle.json)
  经 `analyzeUsageInsights` + `toInsightConsumerView` 生成，含已知值、`null` 未知项与限制文本。
- 该样例的数据层是 `controlled`（经产品公开 routing-evidence 端口写入的受控记录），
  **不是** `actual_native`；样例中没有原生执行，报告与 summary 都保持 `NOT_TESTED`。

## 复现

```sh
pnpm --dir packages/usage-insights build
node -e "import('./packages/usage-insights/dist/index.js').then(async m => {
  const { readFileSync } = await import('node:fs')
  const bundle = JSON.parse(readFileSync('reports/usage-insights/probe/two-project-20261108T120000Z.bundle.json','utf8'))
  console.log(JSON.stringify(m.toInsightConsumerView(m.analyzeUsageInsights(bundle).summary), null, 2))
})"
```

`toInsightConsumerView` 只做投影：同输入必得同输出，不读时钟、不读文件、不做网络请求。
