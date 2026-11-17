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
| 0 | 报告生成、观察 `ready`、文档通过自己的 contract（裸观察/展示文档也算，只是没有 payload digest） |
| 3 | 外壳没过产品 contract 或旧文件（`contractValid: false`）：摘要可用但未完全验证 |
| 4 | 观察为 `insufficient_data`（缺来源/未采集） |
| 5 | 文档不合法、摘要不符（`digest: mismatch`）、观察为 `unavailable`、归档/安装不可读 |
| 2 | 参数错误（相对路径、`--input` 与 `--dto` 同时给、`--package` 与 `--install` 同时给等） |

## 一次真实定位（本轮证据）

同一份 main 诊断下载文件（`GET /v1/insights/support`，`support-7d-…-unknown-build.json`）：

1. 直接读：`origin: null`、`exportCapability: unverified` —— **定位到的缺口**：诊断文件没有安装身份。
2. 同一文件加 `--install <安装目录>` 再读：`origin.identitySource: install-manifest`、build
   `4dcd28f758bbb265`、`exportCapability: present`、`missing: []` —— 身份由已安装文件与 manifest 证据补上。
3. 同 scope 再下载一次：`summaryId` 变化（新观察），身份缺口仍复现 —— 说明这是稳定缺口而非偶发。

两份报告分别在 `reports/usage-insights/probe/two-project-20261116T112118.support-gap.json` 与
`.support-with-runtime-identity.json`。默认产品输出仍未带身份（main 尚未接 `inspectRuntimeIdentity`），
这一项保持 SOURCE_READY。

`--out` 以 0600 独占创建、不覆盖；不给 `--out` 时只写 stdout。

## Node port（main 组合）

`packages/usage-insights/src/support-port.ts` 导出（Node only，不进 browser）：

| 导出 | 作用 |
| --- | --- |
| `readSupportDocument(document, {origin?})` | 接受三形态：`observation` / 下载文件 `export` / 下载外壳 `download`。外壳会**重算 sha256**（形状通过≠字节通过），并做字段守恒核对 |
| `buildSupportFile(report)` | 生成可分享文件 `usage-insights-support/1`：`fileName`、`mediaType`、`text`、`bytes`、`sha256`，默认 64 KiB 上限 |
| `readSupportFile(file)` | 校验并读回同事发来的支持文件 |
| `supportLabels(report)` | 直接喂 F 的 `TrialSupportInfo`：`packageLabel`（build / tar 前 12 位）、`sourceLabel`、`note`（缺能力/缺失事实）；无包时三个字段不编造 |
| `createSupportHandler({resolveOrigin})` | 框架无关 handler：`(document) => {status:200|422, body}`，body 为 `{protocol, report, digest, conservation}`；不把输入回显到错误里 |
| `originFromManifest(manifest, capabilities?, opts?)` | 唯一身份实现：manifest 有 build+40 位 commit → `install-manifest`；只有其一 → `incomplete-manifest` 且缺失项为 `null`；两者都无 → `null`；分支名/路径不会变成 commit |

`readSupportDocument` 返回的 `digest.state` 三态：`verified` / `mismatch` / `absent`（裸文档没有声明摘要，
`absent` 不是通过）。`conservation` 报告 `rowsMatch`/`scopeMatches`/`windowMatches`/`headerMatches`；
`contractValid: false` 表示这份外壳没过产品自己的 contract（旧版或被重写），但仍可给出摘要与守恒诊断。

## 运行身份（`inspectRuntimeIdentity`）

归档摘要只说明"发出的是哪些字节"，不说明"正在运行的是不是它"。`runtime-identity.ts` 读**安装目录本身**：

- `install/install.json`（与 D/main 同一输入）：build、40 位 source commit、dirty、files 数量；
  缺或只有一部分时 `identitySource` 为 `incomplete-manifest` 且缺项保持 `null`，没有声明就是
  `origin: null`；分支名、路径、仓库 HEAD 都不会变成 commit。
- 已安装文件的能力证据：usage-insights `dist/index.js` 的导出、coordinator 的
  `/v1/insights`、`/v1/insights/export`、`/v1/insights/support`、console 的下载引用。
  **manifest 声明不能把缺失能力变存在**。
- `archive.sha256` 只在显式给了 `--archive`/归档路径时才算；只给 expected 而无归档可算时
  `checks.archiveMatches` 为 `null`（自比不算证明），并在 `unknown` 里说明。
- `checks`（build/source/archive 是否与 expected 一致）与 `differences` 保留旧安装配新 source 的差异。

## 身份证据级别（wave 35 收紧）

静态 manifest 与文本扫描**不能自证运行身份**。`inspectRuntimeIdentity` 分三级：

| `evidence` | 含义 |
| --- | --- |
| `self_declared` | 只有 manifest 自述（或其 inventory 校验未过）。真伪未知，不能当"正在运行的是它" |
| `inventory_verified` | manifest 自带文件清单的 size/sha256 已对磁盘逐项核对通过（`verify: hash`，或 `size`） |
| `running_confirmed` | 以上 + main/D 提供的**进程启动记录**里的 root 与本安装 root 完全相同 |

- 清单路径相对 `install.json` 所在目录解析（调用方给 extract root 还是 `install` 目录都成立）。
- 有 mismatch/缺文件/伪 digest → `inventory.state: partial`，`evidence` 退回 `self_declared`，
  差异逐条列出；不再"因为 manifest 合法就是已验证"。
- 能力判定扫描**去掉注释**后的代码：仅写在注释里的路由不算能力；扫描覆盖整个 dist 闭包，
  因为符号可能从兄弟模块 re-export。
- 运行证据必须来自 main/D 的**原始 start record**（`{source:'main-start-record', entry, root, pid,
  startedAt, uid, argv, config}`）：G 只做一致性核对——entry 在 root 内且是本包 `bin/pa`、
  `argv[0]` 等于 entry、config 在安装或私有区内。裸 `{root}` 字符串只用于比较，`provenance` 记为
  `caller-string`，**永不升级**为 `running_confirmed`。
- G **不验证进程存活**（macOS 上等于全局发现），所以 `running_confirmed` 的含义是"这条 start record
  与这棵安装树一致"，不是"此刻该进程在运行"。
- `--install` 且 `evidence: self_declared` 时 CLI 打 `unverified_identity` 并 exit 3。

## 校验强度与旧文件

`readSupportDocument` 返回 `verification`：

| 值 | 含义 |
| --- | --- |
| `contract-digest` | 产品 contract 通过，且声明的 sha256 与文本一致 |
| `digest-only` | 字节与声明摘要一致，但外壳没过产品 contract（`contractValid: false`） |
| `shape-only` | 没有声明摘要可核（裸文档/旧摘要），只做了形状与严格重投影 |

**未知字段一律拒绝**（typed `invalid_document`），不做"丢弃后声称已清干净"。旧版支持文件
（wave-32 形态，缺 `origin`/`evidence`/`exportCapability`/`documentKind`）不拒收也不当可信：
`readSupportFile` 返回 `schema: 'legacy'` + `missingFields`，缺的字段按 unknown 补齐，
`exportCapability: 'unverified'`，CLI exit 3。

## 给 D/E/H 的最小使用约定

- **D**：`package --tar <冻结包> --json` 得到能力、`identitySource` 与身份；把 `<buildId>@<sha256前12位>`
  作为包标识。`identitySource` 是 `install-manifest` 才说明 build/source 由清单声明；
  `incomplete-manifest` 表示清单缺字段，缺失项仍是 `null`（不是猜的）。
- **E**：不接受 G 的 `exportCapability: present` 作为发行准入；E 自己的同包断言仍然独立。
- **H**：同事附上 `support.md`（含 `origin` 与 `absentFacts`）即可定位“缺哪个能力/哪几行没有值”，
  不需要发送下载文件本身或任何原始 prompt。

## 已知边界

- 能力判定读的是**包内文件**：源码布局扫 `apps/console/src/**`，构建布局扫
  `apps/console/dist/assets/*.js`；两种布局都报告 `console.layout`。库里有函数但没有产品路由/触发入口
  时只算库能力，不算用户可下载。
- 扫描有界（协调器/控制台文本合计上限 32 MiB），超出预算的成员会被跳过而不是让整份报告失败。
- 安装清单本身可到数 MB（内含完整文件清单），解析上限 8 MiB；`manifestState` 区分
  `parsed`/`absent`/`too_large`/`invalid`，不会把“读不了”说成“没有声明”。
- 归档预算按文件大小检查；解压另设上限（归档预算的 8 倍，至少 64 MiB、最多 2 GiB），
  小归档不会因为解压后更大而被拒绝。
