# reports/usage-insights

G（`codex/g4-usage-insights`）的只读观测证据。全部内容都是从已有产品记录派生并脱敏的，不含用户原文、
私有绝对路径、token 或 payload；文件以 0600 独占创建。

| 路径 | 内容 |
| --- | --- |
| [`probe/two-project-20261114T074222.bundle.json`](probe/two-project-20261114T074222.bundle.json) | 由受控产品运行时经真实 HTTP 读接口采集的 bundle（`usage-insights-input/1`），两项目、含问答/接受/ReviewTiming |
| [`probe/two-project-20261114T074222.report.md`](probe/two-project-20261114T074222.report.md) | 同一 bundle 的可读报告：指标定义、逐指标来源 id、观察 subject、限制 |
| [`f-integration/consumer-view.example.json`](f-integration/consumer-view.example.json) | 给 F 的稳定投影样例（`TrialInsightsView` 形状） |
| [`f-integration/README.md`](f-integration/README.md) | F 接入契约与语义规则 |
| [`wave25-status.json`](wave25-status.json) | G1–G16、四个结果、命令、退出码、实测值与未达项 |

## 这批证据说明了什么

- 数据来自真实受控产品运行时：两个项目各有一条 work 经 `create_work → 原生问题 → 明确回答 →
  验证 → UI 可见性审阅 → 接受` 全链，产出真实的 `question.opened`/`runtime.answer.observed`/
  `verification.recorded`/`acceptance.recorded`/`execution.outcome`（含产品自己的 `ReviewTiming`）。
- 采集走真实 HTTP 读面（鉴权、项目隔离、分页游标、attention 快照、timeline 投影）；重复采集同一窗口
  的历史事实完全一致（`observedAt` 读时间是唯一例外），采集不产生产品事件，两个 **同名 goal** 的 work
  仍按 identity 分开计数。
- `workIndex` 由 collector 从产品自身 snapshot/work 视图写入，未映射 work 会被隔离而非猜测归属。
- 数据层只有 `controlled`：执行记录经产品公开 routing-evidence 端口写入。**没有原生执行**，
  `actual_native` 保持 `NOT_TESTED`，任何报告都没有把它写成原生样本。
- `review.readyToAcceptanceMs` 与 `review.activeMs` 来自真实接受记录（后者是 700ms 的 UI 可见性
  代理，`partial`，不是人类工时）；`queue.waitMs` 与 `execution.durationMs` 在当前读面/受控执行中
  没有可用端点，因此是 `null` + 明确原因，而不是 0；`usage` 未知（受控执行不记录 token/cost）。
- 没有 operator baseline 时输出单窗口观察；样例 baseline 仅用于演示比较口径（`observational_only`）。

## 这批证据不说明什么

- 不证明效率提升、节省工时、成本收益或因果。
- 不是发布、执行、路由、预算或验收授权；E 的 required assertions 独立判断。
- 不是 48 小时稳定性或广泛性能结论；有限 bounds 检查见 `packages/usage-insights/test/bounds.case.ts`。

## 复现

在一个新 checkout 上先准备 workspace（不修改根 lock；`--lockfile=false` 只链接本地依赖）：

```sh
pnpm install --lockfile=false --ignore-scripts
pnpm -r --filter "./packages/**" build
pnpm --dir packages/usage-insights build
```

然后：

```sh
node tools/usage-insights/probe/observe-two-projects.mjs            # 不写仓库，仅打印检查结果
node tools/usage-insights/probe/observe-two-projects.mjs --keep     # 额外发布到本目录（独占创建，不覆盖）
node --test tools/usage-insights/test/*.case.mjs
```

探针在进程内起真实产品 HTTP 服务并异步调用 CLI，因此必须用 `spawn` 而不是阻塞式执行。
