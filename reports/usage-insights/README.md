# reports/usage-insights

G（`codex/g4-usage-insights`）的只读观测证据。全部内容都是从已有产品记录派生并脱敏的，不含用户原文、
私有绝对路径、token 或 payload；文件以 0600 独占创建。

| 路径 | 内容 |
| --- | --- |
| [`probe/two-project-20261108T120000Z.bundle.json`](probe/two-project-20261108T120000Z.bundle.json) | 由真实产品 HTTP 读接口采集的输入 bundle（`usage-insights-input/1`），两项目、受控层 |
| [`probe/two-project-20261108T120000Z.report-v2.md`](probe/two-project-20261108T120000Z.report-v2.md) | 当前格式的可读报告：指标定义、逐指标来源 id、观察 subject、限制 |
| [`probe/two-project-20261108T120000Z.report.md`](probe/two-project-20261108T120000Z.report.md) | 同一 bundle 的早期报告格式（保留原件，未覆盖） |
| [`f-integration/consumer-view.example.json`](f-integration/consumer-view.example.json) | 给 F 的稳定投影样例（`TrialInsightsView` 形状） |
| [`f-integration/README.md`](f-integration/README.md) | F 接入契约与语义规则 |
| [`wave25-status.json`](wave25-status.json) | G1–G16、四个结果、命令、退出码、实测值与未达项 |

## 这批证据说明了什么

- 两项目窗口通过真实产品 HTTP 读路径（鉴权、项目隔离、分页游标、attention 快照、timeline 投影）
  采集，重复采集同一窗口字节一致，不新增计数。
- 数据层只有 `controlled`：执行记录经产品公开 routing-evidence 端口写入。**没有原生执行**，
  `actual_native` 保持 `NOT_TESTED`，任何报告都没有把它写成原生样本。
- `queue.waitMs`、`review.readyToAcceptanceMs`、`review.activeMs` 在当前产品读面没有对应端点或
  未记录时序，因此报告里是 `null` + 明确原因，而不是 0。
- 没有 operator baseline 时输出单窗口观察；样例 baseline 仅用于演示比较口径（`observational_only`）。

## 这批证据不说明什么

- 不证明效率提升、节省工时、成本收益或因果。
- 不是发布、执行、路由、预算或验收授权；E 的 required assertions 独立判断。
- 不是 48 小时稳定性或广泛性能结论；有限 bounds 检查见 `packages/usage-insights/test/bounds.case.ts`。

## 复现

```sh
node tools/usage-insights/probe/observe-two-projects.mjs            # 不写仓库，仅打印检查结果
node tools/usage-insights/probe/observe-two-projects.mjs --keep     # 额外发布到本目录（独占创建，不覆盖）
```
