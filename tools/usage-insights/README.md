# tools/usage-insights — 只读效率观测工具

`usage-insights` 把产品已经记录的事实（`ExecutionOutcome`、`ReviewTiming`、`AttentionPage`、
`WorkEvidence`）以及一份显式的 operator baseline，转成可追溯的指标、summary 和可读报告。

它**不**写 SQL、不读私有 DB、不改 runtime/HTTP/UI、不启动任务、不调用模型、不产生第二套账本，
也不授予执行、路由、预算或验收权限。

## 命令

```sh
node tools/usage-insights/cli.mjs help
node tools/usage-insights/cli.mjs catalogue                 # 指标目录：单位/聚合/精确定义
node tools/usage-insights/cli.mjs analyze --input /abs/bundle.json [--format terminal|json|markdown] [--out /abs/out]
node tools/usage-insights/cli.mjs report  --input /abs/bundle.json --out /abs/report.md
node tools/usage-insights/cli.mjs verify  --input /abs/bundle.json [--expect-digest <sha256>]
node tools/usage-insights/cli.mjs collect --base-url http://127.0.0.1:<port> \
  --token-file /abs/private/token --from 2026-11-13T00:00:00Z --to 2026-11-14T00:00:00Z \
  --project project-atlas --include-attention --out /abs/bundle.json [--report /abs/report.md]
```

退出码：

| 码 | 含义 |
| --- | --- |
| 0 | 观测完整（窗口完整枚举、无隔离记录）；不代表每个指标都有值 |
| 3 | 部分完成：来源有界/截断，或有记录被隔离 |
| 4 | 数据不足：来源缺失或未采集 |
| 5 | 来源不可用、摘要不符、输出不可写（含 `output_conflict`） |
| 2 | 参数/输入格式错误 |
| 1 | 内部错误（stdout/stderr 只给有限代码，不含 token） |

`analyze` 在 stderr 打印一行 `status=… coverage=… unavailableMetrics=… quarantine=…`，避免把 exit 0
误读成"指标齐全"。`stoppedBy` 区分**本工具的声明上限**（`records`/`works`/`pages`）与**采集端已截断**
（`source`）：前者由 `--max-records/--max-works/--max-pages` 触发，后者来自 bundle 的 `declaredCoverage`。

## collect：显式 loopback 与显式凭据

- `--base-url` 必须是**裸 loopback 源**：`http` + `127.0.0.1`/`localhost`/`[::1]`，不能带用户名密码、
  路径、query 或 fragment。
- `--token-file` 必须是**绝对路径的普通文件**（≤4KB、单个无空白 token、非符号链接）。token 只在内存中
  使用，不写入 bundle、报告、错误信息、argv 回显或 provenance。
- 只发 GET；任何 3xx 一律拒绝而不是跟随。每个请求有 `--request-timeout-ms`，整体有 `--deadline-ms`。
- 响应体**按流累计**并对照剩余字节预算：超出即 `cancel` 并报告 `bytesReceived`/`allowed`；声明的
  `Content-Length` 过大时在读取前拒绝（`declaredLength`）；错误/重定向的 body 也只在 16KB 内读取。
- 采集结束时才写入 `capturedAt`，因此快照的 `observedAt` 永远不晚于它所属的观测。
- 读取路径：`GET /v1/snapshot`（发现 work）→ `GET /v1/works/:id/evidence` +
  `GET /v1/works/:id/evidence/history`（分页）→ 可选 `GET /v1/attention`（每个项目）+ 可选
  `GET /v1/readiness`（仅作配置附录）。
- 边界：`--max-works`、`--history-pages`、`--history-limit`(≤100)、`--attention-pages`、
  `--attention-limit`(≤20)、`--max-bytes`。游标不前进就停止，不会无限翻页。
- 单个 work 失败不会让整次采集变成"空集"：失败写入 `collectionIssues`，`declaredCoverage` 降为
  `source_missing`/`caller_limit`。

不会做的事：不读 `$HOME`、不扫描全局 socket、不借用其他实例凭据、不跟随外部跳转、不写设置、不确认候选。

## 范围规则（所有记录类一致）

- 每条记录都受**声明的项目集**与**请求窗口**约束，不只是 outcome：
  - `outcomes` 按 `projectId` + `observedAt` 过滤；
  - `workEvidence`/`workHistories` 的条目按 `entry.at` 过滤，窗口前的问题/回答/接受只作参考，不计入人工介入；
  - `attention` 是**当前快照**：只保留声明项目的条目，捕获之后才观察到的页面被拒绝，超过 1 小时新鲜度的
    快照最多是 `partial`。
- work 的项目只能来自 collector 写入的 `workIndex`（取自产品自己的 snapshot/work 视图）或该 work 自己的
  outcome。两者都没有时该 work 是 **unmapped**：隔离为 `project_unknown`，其人工介入计数进入 unknown，
  绝不当成"一次已观察问题"或"完整零"。
- 身份冲突（同 id 不同 body、index 与 outcome 指向不同项目）会**整条隔离**，不替用户选版本。

## 输入 bundle（`usage-insights-input/1`）

```jsonc
{
  "protocol": "usage-insights-input/1",
  "inputId": "window-2026-11-13",
  "capturedAt": "2026-11-13T12:00:00Z",      // 分析基准时刻，纯函数只依赖它，不读时钟
  "timezone": "Asia/Shanghai",                // IANA 时区，非法值直接拒绝
  "window": { "from": "2026-11-13T00:00:00Z", "to": "2026-11-14T00:00:00Z" }, // from 含、to 不含
  "projects": [{ "projectId": "project-atlas" }],
  "workIndex": [{ "workId": "work-1", "projectId": "project-atlas" }],   // collector 写入的可验证映射
  "source": { "kind": "http_read|verified_file|operator_file|synthetic_fixture",
              "descriptor": "loopback …", "digest": null, "layerAssertion": "recorded_by_producer",
              "capturedAt": "…" },
  "declaredCoverage": { "outcomes": "complete", "workEvidence": "complete", "attention": "complete" },
  "limits": { "maxRecords": 50000, "maxWorks": 50, "maxPages": 20 },  // 解析前生效
  "outcomes": [], "attentionPages": [], "workEvidence": [], "workHistories": [],
  "queueFacts": [],                            // 可选：显式 queuedAt/dispatchedAt + 同 attempt 身份
  "baseline": null,                             // 可选：operator-baseline/1
  "configSnapshot": null,                       // 可选：readiness 等配置观察，不参与指标
  "collectionIssues": []                        // 可选：采集器记录的脱敏问题
}
```

记录集合用 `unknown[]`：单条坏记录被隔离（`invalid_record`）并计入覆盖损失，不会静默丢弃或被改成 0；
信封本身是 strict 的，未知字段、倒序窗口、非法时区都会被拒绝。

### 声明上限如何生效

`maxRecords`/`maxWorks`/`maxPages` **在解析之前**执行：超出预算的记录根本不会被解析（因此也不会产生
`invalid_record`），只在 `losses.<source>.notParsed` 与 `limits` 中计数，`stoppedBy` 记录是哪一类上限先到。

计数口径（`limits.recordUnit`）：

- 一条 outcome、一个 work/history 容器、一条 timeline entry、一个 attention item 各算 **1 个单位**；
- 容器与它派生出的记录一起计费，**原子准入**：装不下的容器整条不解析，不会只算父记录一次；
- `maxPages` 只数页面文档（history/attention 页），页内条目仍计入 `maxRecords`；
- 刚好等于上限**不是**截断（完整枚举，`notParsed=0`）；采集端已截断则显示 `stoppedBy=source`。

例：`maxRecords=1` 时，一个内含 2 条 outcome 的 WorkEvidence 成本为 3，整条被拒绝 —— 不会出现
accepted2/complete。

### 损失如何传播

`losses` 对 outcome/work/attention 分别给出 `seen/accepted/notParsed/invalid/conflicted/outOfScope/
outsideWindow/unmapped`；`invalid/conflicted/notParsed/unmapped` 会把对应来源的 coverage 降为 `partial`，
指标的 unknownCount 同步增加。`outOfScope/outsideWindow` 是声明范围的效果，会计数但不降低覆盖。
因此 `workEvidence=[{}]` 得到的是 `value=null, coverage=partial, unknownCount>=1`，而不是 `0/complete`。

## 指标口径

| metricId | 单位/聚合 | 说明 |
| --- | --- | --- |
| `outcomes.count` / `outcomes.accepted` | count / sum | 分证据层的不同 outcome 数；accepted 只认 `acceptance: accepted` |
| `execution.durationMs` | ms / mean | 产生方记录的耗时；**不是**排队时间 |
| `queue.waitMs` | ms / mean | 仅当同一 attempt 同时有排队与派发端点；缺失即 null |
| `review.readyToAcceptanceMs` | ms / mean | 候选就绪到接受；并用两个时间戳独立复核 |
| `review.activeMs` | ms / mean | **UI 可见性代理**，部分覆盖；不是人类工时或质量分数 |
| `usage.inputTokens` / `outputTokens` | tokens / sum | 只累加已知值；未知单列 |
| `usage.cost` | 每种币种一行 | 不同币种绝不合并；不补查价格、不假设订阅免费 |
| `interventions.*` | count / sum | 可追溯的独立问题/明确回答/接受事实；重复 receipt、assistant 消息不计 |

规则：

1. 缺观测 = `null` + 原因（`timing_missing`/`endpoint_missing`/`acceptance_unknown`/`source_missing`/
   `not_collected`/`insufficient_data`），从不为 0。
2. 证据层不合并；每个 outcome 指标行带唯一层。交互指标不带层（它们是产品记录，不是执行证据）。
3. 同一 identity 同 body 重复出现只计一次；同 id 不同 body 全部隔离，不替用户选版本。
4. 截断页/受限扫描只能让覆盖变差，不能变好。
5. 完整空窗口是"完整 + 0 样本"，与"未采集/来源缺失"区分。
6. 生产方自写的 `actual_native` 标签只记为"来源记录"，不升级为原生证据。

## baseline（`operator-baseline/1`）

必须显式给出 source、definition、项目、窗口、时区、metricId、unit、aggregation、currency、
targetLayer、sampleCount、value、coverage；手填工时/预期节省写在 `operatorNote`。
只有同 metric/单位/聚合/币种/层、baseline 完整、分母非 0、窗口不重叠时才比较，结果恒为
`observation: observational_only`，delta/ratio 是原始数字，不生成百分比节省或因果结论。

## 输出安全

- bundle/报告以 `0600` **独占创建**：目标已存在、目标是符号链接、父目录是符号链接、父目录不存在或不可写，
  都明确失败，旧报告不会被覆盖或删除。
- 写入先落到同目录私有临时文件，`link` 成功后删除临时文件；失败只清理自己创建的临时文件。
- 报告只含聚合值、指标定义和**标识符**引用；不写用户路径、原文、prompt、payload、token。
  不可信文本（operator note、source 描述、work/project id）在 Markdown 中转义。

## 常见问题

| 现象 | 含义与处理 |
| --- | --- |
| exit 3 + `coverage=partial` | 有界/截断来源；查看报告 Coverage 与 `stoppedBy`，需要更大窗口请显式调大 bounds |
| exit 4 | 来源缺失或未采集；确认 `--project`/`--work`、token 权限与实例是否暴露对应读接口 |
| `endpoint_missing` on `queue.waitMs` | 产品读面没有排队端点；这不是 0 排队时间，也不要从 `durationMs` 改名 |
| `acceptance_unknown` | 没有 acceptance 事实，不能算"就绪到接受" |
| `unstable_cursor` | 本地服务返回了不前进的游标；采集已停止，报告为部分 |
| `output_conflict` | 目标文件已存在；换一个新路径，工具不会覆盖历史报告 |
| `source_unavailable`（摘要不符） | bundle 自身记录的 digest 与文件字节不一致；不要分析被改动过的来源 |
| `verify --expect-digest` 失败 | 文件字节与之前固定的摘要不一致；重新采集或确认来源被改动 |
| `stoppedBy=records/works/pages` | 是你给的声明上限先到；调大对应 `--max-*` 或缩小窗口 |
| `unmapped_work` | work 缺少可验证项目映射；用 `--project`/`--work` 让 collector 重新取 `workIndex` |

不需要删账本/DB/队列、不需要重设预算、也不应该提供家目录凭据——以上问题都能通过显式参数定位。

## 测试

```sh
# 新 checkout 先链接 workspace 依赖并构建（不改根 lock）
pnpm install --lockfile=false --ignore-scripts
pnpm -r --filter "./packages/**" build
pnpm --dir packages/usage-insights build

pnpm --dir packages/usage-insights typecheck
pnpm --dir packages/usage-insights test
node --test tools/usage-insights/test/*.case.mjs
node tools/usage-insights/probe/observe-two-projects.mjs          # 真实产品 HTTP 两项目观测
```

CLI 优先加载 `packages/usage-insights/dist`；未构建时回退到 `src/index.ts`（Node 类型剥离），
但 `@personal-agent/contracts` 仍需 workspace 链接。

fixtures 在 `tools/usage-insights/fixtures/`，全部为合成数据并标注来源；它们不是原生执行证据。
