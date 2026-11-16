# 支持摘要契约（供 D/E/H 与同事排障使用）

`reports/usage-insights/support-contract.zh-CN.md` — G 拥有。实现：`packages/usage-insights/src/support.ts`；
CLI：`tools/usage-insights/cli.mjs verify --dto … [--package …] [--out …]`。

## 这份东西解决什么

一次真实试用出问题时，同事通常只有两样东西：控制台/页面看到的现象，和用户下载下来的
`observation-<7|30>d-<summary12>.json`。支持摘要把这两样变成一份**只含元数据**的报告，回答：

1. 看到的是什么范围（项目、7/30 天、时区、窗口、覆盖）；
2. 是哪一次观察（`summaryId`，即快照身份）；
3. 哪个版本产生的（`origin.buildId` / `sourceCommit` / 包 digest）；
4. 缺哪项能力（`origin.missing`，例如 `displayDownload`）；
5. 哪些事实**没有**被记录（`evidence.absentFacts`，例如 N 行没有观察值）——这些不是 0。

## 协议

`usage-insights-support-summary/1`（`protocol` 字段）。输入接受两种文档，`documentKind` 区分：

| 输入 | `documentKind` | 来源 |
| --- | --- | --- |
| `usage-observation/1` | `observation` | coordinator `GET /v1/insights` 响应 |
| `usage-insights-display-export/1` | `display_export` | 用户下载的文件本身 |

字段（JSON 顶层）：

| 字段 | 含义 |
| --- | --- |
| `status` | `ready` / `insufficient_data` / `unavailable` |
| `summaryId` | 快照身份；`null` 表示本次没有可导出的观察 |
| `observedAt` / `days` / `timezone` / `window` | 观察时间与半开窗口 |
| `scope.projectIds` / `aggregation` / `label` | 声明的项目范围；多项目不等于任一单项目总量 |
| `coverage` / `coverageState` | 服务端给的覆盖文本与状态 |
| `counts.rows` / `withValue` / `unknown` / `sampleCount` | 行数、有值行、无值行、header 样本数 |
| `rows[]` | `rowId`（`metric@layer@currency`）、`layer`、`unit`、`hasValue`、`sampleCount` |
| `limitations[]` | 服务端声明的限制文本 |
| `origin` | `null`，或 `{kind,buildId,sourceCommit,archiveSha256,capabilities,browserTrigger,missing}` |
| `evidence` | `{coverageState,rowsWithValue,rowsWithoutValue,sampleCount,partial,absentFacts}` |
| `exportCapability` | `present` / `absent` / `unverified`（未提供 `--package` 时恒为 `unverified`） |
| `numericValues` | 恒为 `false`：这份报告没有、也不会补出数值 |
| `authorization` | 恒为 `none` |

`origin` 只在提供 `--package` 时出现，来自 `package --tar` 的只读能力报告；三个 capability 必须
都是布尔值才被采信，否则整块降级为 `unverified`，不会把格式错误读成“缺功能”。

## 明确不包含

- 任何 `formatted` 值、`label`、`detail`、prompt、key、token、私有绝对路径；
- 任何从 formatted 字符串反解出来的数字；
- 任何效率/收益/工时结论（没有 operator baseline 就不报提升）。

## 命令与退出码

```sh
# 只核对观察（不涉及版本）：输出 unverified
node tools/usage-insights/cli.mjs verify --dto /abs/observation-7d-abc123def456.json

# 同时核对运行包：报告里出现 build/source/包 digest 与缺失能力
node tools/usage-insights/cli.mjs verify --dto /abs/observation-….json \
  --package /abs/app.tar.gz --format markdown --out /abs/support.md
```

| exit | 含义 |
| --- | --- |
| 0 | 报告生成且观察为 `ready` |
| 4 | 观察为 `insufficient_data`（缺来源/未采集） |
| 5 | 文档不合法、观察为 `unavailable`、归档不可读或摘要不符 |
| 2 | 参数错误（相对路径、`--input` 与 `--dto` 同时给等） |

`--out` 以 0600 独占创建、不覆盖；不给 `--out` 时只写 stdout。

## 给 D/E/H 的最小使用约定

- **D**：`package --tar <冻结包> --json` 得到能力与身份；把结果 `<buildId>@<sha256前12位>` 作为包标识。
- **E**：不接受 G 的 `exportCapability: present` 作为发行准入；E 自己的同包断言仍然独立。
- **H**：同事附上 `support.md`（含 `origin` 与 `absentFacts`）即可定位“缺哪个能力/哪几行没有值”，
  不需要发送下载文件本身或任何原始 prompt。

## 已知边界

- 能力判定读的是**包内文件**：源码布局扫 `apps/console/src/**`，构建布局扫
  `apps/console/dist/assets/*.js`；两种布局都报告 `console.layout`。库里有函数但没有产品路由/触发入口
  时只算库能力，不算用户可下载。
- 扫描有界（协调器/控制台文本合计上限 32 MiB），超出预算的成员会被跳过而不是让整份报告失败。
- 归档预算按文件大小检查；解压另设上限（归档预算的 8 倍，至少 64 MiB、最多 2 GiB），
  小归档不会因为解压后更大而被拒绝。
