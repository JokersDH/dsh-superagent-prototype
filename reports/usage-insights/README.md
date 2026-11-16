# reports/usage-insights

G（`codex/g4-usage-insights`）的只读观测证据。全部内容都是从已有产品记录派生并脱敏的，不含用户原文、
私有绝对路径、token 或 payload；文件以 0600 独占创建。

| 路径 | 内容 |
| --- | --- |
| [`probe/two-project-20261114T074222.bundle.json`](probe/two-project-20261114T074222.bundle.json) | 由受控产品运行时经真实 HTTP 读接口采集的 bundle（`usage-insights-input/1`），两项目、含问答/接受/ReviewTiming |
| [`probe/two-project-20261114T074222.report.md`](probe/two-project-20261114T074222.report.md) | 同一 bundle 的可读报告：指标定义、逐指标来源 id、观察 subject、限制 |
| [`probe/two-project-20261114T074222.export.json`](probe/two-project-20261114T074222.export.json) | 上一轮的有界导出（`usage-insights-export/1`，12 行、无截断、0600）；v1 文档保留为历史证据 |
| [`probe/two-project-20261115T084148.bundle.json`](probe/two-project-20261115T084148.bundle.json) | 本轮受控两项目 bundle（同一产品运行时、真实 HTTP 读面） |
| [`probe/two-project-20261115T084148.report.md`](probe/two-project-20261115T084148.report.md) | 同一 snapshot 的报告（含 `Summary id` 与快照说明） |
| [`probe/two-project-20261115T084148.export.json`](probe/two-project-20261115T084148.export.json) | 同一 snapshot 的数值导出（`usage-insights-export/2`，含 `snapshot` 块） |
| [`probe/two-project-20261115T084148.display-export.json`](probe/two-project-20261115T084148.display-export.json) | 由真实 `/v1/insights` 响应生成的 display-only 导出（`usage-insights-display-export/1`，无数值字段） |
| [`probe/two-project-20261115T084148.crosscheck.json`](probe/two-project-20261115T084148.crosscheck.json) | 页面↔分析（`page`）与页面↔CLI 独立 HTTP 读（`http`）的逐行核对结果 |
| [`probe/two-project-20261115T152615.download.json`](probe/two-project-20261115T152615.download.json) | 主线 `GET /v1/insights/export` 实际交付给用户的 display-only 文件（`usage-insights-display-export/1`，12 行、无数值字段） |
| [`probe/two-project-20261115T152615.support.json`](probe/two-project-20261115T152615.support.json) | 同一次下载的 `verify --dto` 支持摘要：只有 scope/窗口/覆盖/行身份/是否有值，无 formatted 值 |
| [`probe/two-project-20261115T152615.support-report.json`](probe/two-project-20261115T152615.support-report.json) | 同一观察 + 实际运行包（build `4dcd28f758bbb265`、包 digest `405ecd02…`）的支持报告：含 `origin`/`capabilities`/`evidence.absentFacts` |
| [`probe/two-project-20261116T064839.download-envelope.json`](probe/two-project-20261116T064839.download-envelope.json) | 主线 `GET /v1/insights/export` 的真实外壳（observation + text + sha256） |
| [`probe/two-project-20261116T064839.support-report.json`](probe/two-project-20261116T064839.support-report.json) | 由该外壳 + 实际运行包生成的支持报告：`digest=verified`、守恒 4/4、`identitySource=install-manifest` |
| [`probe/two-project-20261116T112118.support-download.json`](probe/two-project-20261116T112118.support-download.json) | main 真实 `GET /v1/insights/support` 下载的诊断文件（无安装身份，`unknown-build`） |
| [`probe/two-project-20261116T112118.support-gap.json`](probe/two-project-20261116T112118.support-gap.json) | 同一文件的读取结果：`origin: null`、`exportCapability: unverified`（定位到的缺口） |
| [`probe/two-project-20261116T112118.support-with-runtime-identity.json`](probe/two-project-20261116T112118.support-with-runtime-identity.json) | 同一文件 + `--install`：`identitySource: install-manifest`、build `4dcd28f758bbb265`、`exportCapability: present` |
| [`support-contract.zh-CN.md`](support-contract.zh-CN.md) | 给 D/E/H 的支持契约：port/handler/文件/标签、运行身份、校验强度、exit、明确不包含与已知边界 |
| [`f-integration/consumer-view.example.json`](f-integration/consumer-view.example.json) | 给 F 的稳定投影样例（`TrialInsightsView` 形状） |
| [`f-integration/README.md`](f-integration/README.md) | F 接入契约与语义规则 |
| [`wave26-status.json`](wave26-status.json) | 第二轮（G1–G16）范围/未知/硬界/流式预算的交付与实测值 |
| [`wave27-status.json`](wave27-status.json) | 第三轮（G1–G20）嵌套计数、永久冲突、Node composition、F scope 对齐与五个结果 |
| [`wave28-status.json`](wave28-status.json) | 第四轮（G1–G24）真实 /v1/insights 前身 reader/DTO/F admission 验证 |
| [`wave29-status.json`](wave29-status.json) | 第二十九轮（G1–G24）真实 `/v1/insights`、7/30 窗口、行语义与有界导出 |
| [`wave30-status.json`](wave30-status.json) | 本轮（G1–G4 四成果）同授权窗口的报告/导出闭环、display-only 导出、跨读者逐行核对与快照连续性 |
| [`wave31-status.json`](wave31-status.json) | 本轮三包 12 成果：R1 固定 RC 基线与包能力核对、R2 主线默认下载全链、R3 重复观察与支持 |
| [`wave32-status.json`](wave32-status.json) | 上一轮整块：排障用支持报告、构建布局能力核对修正、导出/限额/错误复核与余项 |
| [`wave33-status.json`](wave33-status.json) | 上一轮三成果：支持 port/默认消费、观察语义与兼容、问题反馈闭环与余项 |
| [`wave34-status.json`](wave34-status.json) | 本轮两包六成果：观察/诊断边界、运行身份、真实反馈闭环、等待与审阅事实、兼容矩阵 |

## 与主线的实际接线（2026-11-15）

main 已把本包源码接回产品并实现真实路径：

| 组成 | 归属 | 现状 |
| --- | --- | --- |
| 授权 reader | main | `ProductUsageObservation` + 已授权 users 的 `listWorks`/`workEvidence` |
| 独立上限 | main | 50 works / 10000 nested records / 2 MiB / 单次 2 秒 |
| 窗口 | main | `days=7|30`，半开区间，`to = observedAt` |
| DTO | main | `usage-observation/1`，header sample = 枚举 work 数，行保留 sample/layer/unit |
| HTTP/App | main | `GET /v1/insights`；`useUsageObservation` 按需读取，`TrialWorkspace` 直接渲染 |
| 分析语义/工具/报告 | G | scope/去重/quarantine/limits/层/币种/unknown、CLI、报告 |

`reports/usage-insights/probe/` 里的 bundle/report 仍来自 G 自己的只读采集（HTTP/file），用于 CLI 与
报告的可复现证据；`weekly`/`7-30` 的窗口语义与 main 一致。安装包层面：当前 `1cd` 包**没有**
usage-insights/observation 入口，本包源码能力不能贴到它的 installed 结论上（由 D 冻结新包后另行核对）。

## 本轮新增（wave 30）

- **一份观察、三个出口**：同一 bundle 分析同时产出报告与 `usage-insights-export/2`，两者都带同一个
  `snapshotId`；`collect --report --export` 在**一次**读取后写出全部产物。
- **页面↔报告/导出可互核**：`two-project-20261115T084148.crosscheck.json` 记录两次逐行核对——
  `page`（main 的 reader 服务的 DTO ↔ 同窗口分析）与 `http`（同一 DTO ↔ CLI 独立 HTTP 采集的分析）
  都是 13/13 一致、0 分歧。`crossCheckAnalysisWithDisplay` 只在核验时解析服务端字符串，解析值不进入任何导出。
- **display-only 导出**：`display-export.json` 直接由真实 `/v1/insights` 响应生成，只有服务端已格式化的
  字符串与身份/层/单位/样本数，没有数值字段，因此不可能被反解成“测量值”。
- **重新读取即新快照**：同一窗口再次采集得到不同的 `snapshotId`，第二次导出声明
  `continuity: new_snapshot` 并写出 `previous`；旧导出只提供身份，不复用任何旧值。
- `two-project-20261115T084148.export.json` 的 `snapshot.snapshotId` 与同目录报告中的 `Summary id`
  相同；`display-export.json` 的 `snapshot.snapshotId` 是服务端 DTO 的 `summaryId`（`13e9e314…`），
  两个 identity 属于两条 reader 路径，不互相冒充。

## 本轮新增（wave 31）

三个交付包分列，不互相贴结论：

- **包一（R1，固定 829RC）**：`package --tar` 只读核对出该归档的实际能力 —— sha256
  `04926739…`、20481470 bytes、manifest source `82ee5b8f…` / build `8296720d8a25f38c`、
  `pageObservation` 存在，`numericExport` 与 `displayDownload` **不在包内**（dist 无对应入口、
  无 `/v1/insights/export`、无 `download(`、无 `downloadUsageObservation`）。因此 R1 用户只能看页面，
  下载能力准确未达；G 的工具/checkout 能力不冒充 RC 功能。
- **包二（R2，main 303b2c6a）**：`GET /v1/insights/export` 真实路由 + 真实 `download` + main 的
  `usage-observation-download/1` contract 全部通过：200、`cache-control: no-store`、sha256 与实际
  文本一致、文件名含 summary 前 12 位、`snapshot.snapshotId` 等于本次观察、`truncation.bytes` 等于
  实际 UTF-8 字节、行与同次 `observation` 逐字段一致、无数值字段。交付文件见
  `two-project-20261115T152615.download.json`（5140 bytes、12 行）。
- **包三（R3）**：同一 scope 再次读取是新观察（不同 `summaryId`/`snapshotId`），行身份与值不变、
  未知行不会被上一次的值填满；导出后再读原 Work 仍可用，导出与读取期间产品事件增量 **0**。支持摘要
  （`support.json`）只含元数据，可用于同事排障。

## 这批证据说明了什么

- 数据来自真实受控产品运行时：两个项目各有一条 work 经 `create_work → 原生问题 → 明确回答 →
  验证 → UI 可见性审阅 → 接受` 全链，产出真实的 `question.opened`/`runtime.answer.observed`/
  `verification.recorded`/`acceptance.recorded`/`execution.outcome`（含产品自己的 `ReviewTiming`）。
- 采集走真实 HTTP 读面（鉴权、项目隔离、分页游标、attention 快照、timeline 投影）；重复采集同一窗口
  的历史事实完全一致（`observedAt` 读时间是唯一例外），采集不产生产品事件，两个 **同名 goal** 的 work
  仍按 identity 分开计数。
- `workIndex` 由 collector 从产品自身 snapshot/work 视图写入，未映射 work 会被隔离而非猜测归属；
  同一 work 出现两个项目会被**永久 tombstone**，重排/重复条目都不能复活它。
- 记录上限按**单位**计费（outcome／容器／entry／page item），容器与派生记录一起原子准入，父记录不能替
  子记录挡上限。
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
