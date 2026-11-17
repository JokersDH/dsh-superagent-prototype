# Agent E 第三十六轮交付交接

- 分支 `codex/g3-product-acceptance`，基线 `7e550991`，检查点 `105595d2`，本次证据源 `d199cd90888069df2fe6bcc7d30f8ae8ddd90f78`（干净工作树）。证据文件随源提交之后的提交一起交付；`git log` 的分支头即最终交付提交。
- 拥有路径：`tests/product-acceptance/`。未修改生产实现、root manifest/lock、公共 schema 或迁移。
- 模型预算：0 个真实模型任务；唯一模型对端是本机 loopback mock。原生执行：0。

## 恢复里程碑01：固定 W36 独立结论

| 项 | 同包结论 | 依据 |
| --- | --- | --- |
| 包身份/入口 | PASS | source 087a598e / build 14a6b457ea285988 / inner 13798190 / outer 43e06d5b；manifest/runtime/Node/ABI 与包内 Start/Stop/status/导入/复用同包。 |
| 真实 GUI 配置 | PASS | 包内 偏好设置→模型设置 保存：0600 私有文件、显式 HTTP 同意、0 模型请求、key 清空/不回显、重开无 key、重启 config_present；非法端点拒绝且不写。 |
| 分类历史三 kind + 实际点击 | PASS | 同 Work 的 GET contracts/verifications/acceptances 均 200 "work-completion-history/1"、available≥1；Work 详情展开后通过历史分类 select 依次点击三类，显示“本类来源/已显示”；坏 kind、limit 0/21 拒绝；loopback 无 bearer 200 且错 bearer 401。 |
| 非空原对象重开 | PASS | 同包两 Work、全部交付 artifact bytes、26 registry、停机前问题与 effect 行保留，restore 新根只读读回一致；answer/business 422、provider 0。 |
| 已有委托/检查/接受 | PASS | 受控 create_work→回答→verification PASS→accept_candidate→delivered；同 Work 产物重开。 |
| 原项目/槽/native | 保留未达 | 原项目 applicability 仍 NOT_REACHED（fixture 仅自身项目）；原 2/4 槽与原生故障恢复无 consumer，NOT_TESTED；D selected audit 5 个旧 hash 为 D 修复项，不影响本包字节结论。 |

## 第三十六轮四闭环（聚合旧九验收点）

| 闭环 | 结论 | 依据 |
| --- | --- | --- |
| 一、资源 query 未知阻断 signal/release | PASS | pgrep 非 0/1、error/timeout/坏输出即 unknown → 零 signal/release；缺 alive/query/sameIdentity 布尔拒绝；重复/外来/迟到 child 拒绝；产品断言先于释放；required operation 副本与产品内嵌 operation 逐字段绑定。 |
| 二、同 cohort 双原项目与历史 | journey=PASS；原项目 NOT_REACHED；history=NOT_TESTED | 两项目 preview/create/candidate/verification accept、composite stale 拒绝、重开全字节；sameProject 需每项目 7/30 scoped 200 且绑原 project/窗口，403 不替代；W35 包内 completion-history 实测 404 → NOT_INSTALLED，successor 输入已列。 |
| 三、非空 portability 与当前 W35 管理 | recovery=PASS；upgrade=PASS | W35 outer inner install 上两 Work、全部 4 交付 bytes、26 registry、held 问题与 effect 行保留，只读读回；W33→W35 CONFIRMED、post 数据保留、仅二进制回退成功（E 自测 raw），D 自报 W35 raw BLOCKED 保留为输入；旧 W33 retry/BLOCKED 历史未改。 |
| 四、当前产品 tiers 与维护交接 | model=PASS；alpha=PASS；functional=PASS | W35 真实 GUI 保存：0600 私有文件、显式 HTTP 同意、0 模型请求、key 清空且不回显、重开无 key、重启 config_present；outer 39c0…/59? inner 11027a…/launcher EEXIST 修复；多实例/doctor/端口/根隔离沿用；R1/W33/W35 分列，full 仍因 native 拒绝。 |

## 第三十五轮九成果（三个连续工程包）

| 成果 | 结论 | 依据 |
| --- | --- | --- |
| E1 operation 协议 | PASS | 全 set fresh 后目标 fresh、重复/外来/迟到 child/UNKNOWN 拒绝、1:1 退出映射、assert 先于 release；outer/cohort operation=true/true。 |
| E2 完整 report 语义 | PASS | operation 矛盾、pending 停机前问题、effect/question/answer 行、direct registry、artifact ids、sameProject scoped403 全 report 拒绝。 |
| E3 原项目日常 | PASS；原项目 NOT_REACHED | 两项目 preview/create/candidate/verification accept，composite stale candidate 被拒，重开全字节相等；原项目 applicability 仍 NOT_REACHED。 |
| E4 outer+模型设置 | PASS；successor HELD | W33 46e 未配置/已配置/导入/复用/再启/停止；0644 config 在 start 被接受（记录 gap），无 secret 回显；模型保存 successor 需 D 以 4cde5883/8cd709ca 稳定组合冻结，source-only 不重贴 f880。 |
| E5 非空恢复 | PASS | 全部 bytes/两 Work/pending 前问题/effect 行/registry/错 bearer/422/provider0；停机后 phase 如实记录。 |
| E6 升级回退 | PASS | E 自测 W32→W33 CONFIRMED + 仅二进制回退；D 新 raw retry exit0 与原 BLOCKED 分开记录。 |
| E7 多实例 | PASS | 同装两独立 config/state/model 根同时运行、身份/端口/根隔离、停 A 后 B 可服务、doctor DEGRADED 且不泄 key。 |
| E8 原 Work 恢复 | NOT_REACHED | 缺 main/B/I 实际恢复 consumer；精确 owner 输入已记录，不以 callbacks/slot 替证。 |
| E9 分层交接 | controlled=PASS；alpha=PASS；functional=PASS | legacy R1 与 W33 subset 分列；full-product 仍因 native 拒绝。 |

## 第三十四轮六成果（两个连续工程包）

| 成果 | 结论 | 依据 |
| --- | --- | --- |
| E1 caller finally 完整资源 | PASS | 共享 operation 协议（完整 birth/每次 fresh/粘性 UNKNOWN/仅完整退出后 release）；outer=true，cohort=true；10 个纯控制含 retain 拒 release、parent 死 child 活、伪造 start、assert 失败保留、无 force API、caller 源码零直接删除。 |
| E2 完整资源映射 oracle | PASS | resourceRowsIssues 绑定 pid/start/uid/argv/root/config/op 与 1:1 同序 post 观察，应用于 outer/cohort/E32/journey；全 report 变异覆盖空 after、foreign pid、alive 行、cardinality、错 start。 |
| E3 两个原项目 scoped 旅程 | PASS；原项目执行 NOT_REACHED | 两项目 preview/create/candidate/verification accept；重开同 Work/phase/artifact IDs 与全部 bytes；sameProject 仅在 scoped 可读且 draft 完整时成立，scoped403 由最终 oracle 拒绝；接受面无 candidate 身份，stale-candidate 反例记 NOT_REACHED。 |
| E4 锁定 outer ZIP | PASS | W33 outer 46e（46e01c8c…，63481603 bytes）自身校验+包内 Node：未配置/已配置/导入/重开、端口冲突拒绝、status STOPPED、Settings 模板契约（GUI HELD 未启动）。 |
| E5 非空恢复/升级 | PASS + PASS | 全部 artifact bytes（4）与 history、2 Work/问题行、effect 行不变、冻结 Store registry 26、错 bearer 401、业务/回答 422、provider 0；W32→W33 CONFIRMED 升级与仅二进制回退（post 数据保留）。D 提交的 rollback raw BLOCKED 与 summary 冲突，NOT_ADMITTED。 |
| E6 整体 tier/交接 | controlled=PASS；installed-alpha=PASS；installed-functional=PASS | 分层结论；full-product 仅因原生缺失 FAIL（missing_required_case, case_not_pass, layer_not_allowed, required_evidence_missing）；原生/试点仍 0/BLOCKED。 |

## 第三十三轮三项成果

| 成果 | 结论 | 依据 |
| --- | --- | --- |
| 1. 两个原项目的真实完整旅程 | 模板正例 PASS；原项目同项目执行链 **NOT_REACHED**（不冒充 PASS） | E5-TWO-PROJECT-TEMPLATE-CREATE 记录两个原项目、预览、创建、候选、手动接受和执行身份连续性；最终 validator 拒绝 needs_input 却声称 applicable、跨项目 executionProjectId、scoped 403，以及重开缺 found/phase/artifacts。E32-ORIGINAL-PROJECT-APPLICABLE 仍是 NOT_REACHED：受控 fixture 中原登记项目不可派发，personal 无 executor。 |
| 2. 唯一准确安装 cohort 与 actual outer ZIP | **PASS（两个命名 cohort）** | E33-OUTER-ZIP：ZIP 自身 SHA256SUMS 与 package-result（zip 46e01c8c…）、内层 install/runtime/license digest、bundled Node 版本/ABI、私有 HOME 下 Start/Stop/status、未配置与已配置、端口冲突拒绝、重开、停止后 status=2 STOPPED；cohort=zip-inner buildId f880e5bc9c6c1c57。 |
| 3. 非空业务恢复、升级重开与完整停止 | **PASS（所测 cohort）**，其余保留 gap | E33-COHORT-RECOVERY：交付 Work + artifacts → backup CREATED/VERIFIED（eventSeq 73）→ 新 root restore → recovery_readonly 读回相同 artifact 字节/历史、业务写 422、provider 0、篡改 bundle 拒绝、固定集停止；E4-UPGRADE-ROLLBACK 在 baseline/target 对保留升级后写入并回滚二进制。W32 的 ZIP backup 记录了 20 个 artifact 但未恢复读回；非空恢复结论只由 E33-COHORT-RECOVERY 承担。 |

## 实际命令与结果

| 真实命令 | 覆盖病例 | 结果 |
| --- | --- | --- |
| `node tests/product-acceptance/pilot/harness.mjs --preflight` | 冻结输入/价格/ledger | BLOCKED（adapter_missing）；runner selftest 66/17 |
| `node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only` | E1-* | PASS 152 |
| `node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow` | E2-* | PASS 36 + NOT_TESTED 3 |
| `node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui` | E3-* | PASS 32 + NOT_TESTED 6 |
| `node tests/product-acceptance/run.mjs --suites=e4 --tier=installed-alpha` | E4-* / E5-NATIVE-CONTROL / E6-REVIEW-PILOT | PASS 21 + NOT_TESTED 5 |
| `node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record` | 全部 376 | PASS 354 + FAIL 0 + SKIPPED 0 + NOT_TESTED 22 + BLOCKED 0 + UNKNOWN 0 |

本次聚合：**PASS**（tier `controlled-product-workflow`）。证据目录 `/Users/hh/Desktop/joker/superagent-agent-e/tests/product-acceptance/reports/runs/2026-11-17T08-54-30-978Z`。

## 矩阵摘要

| 能力 | 受控 fixture | SDK mock | 只读 | 安装（同一字节） | 实际原生 |
| --- | --- | --- | --- | --- | --- |
| 主对话：普通消息持久化与重开 | PASS | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 明确委托到受控执行、验证与完成 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 问题中心：打开、回答、投递与决策收件箱 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 机器检查、完整 patch、artifact 字节与人工接受 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 验证阻断→明确重新检查→同一候选验证→接受→重开 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 接受结果投影与工作证据读取 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 必需机器检查失败不可被人工接受 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 同 commandId 幂等重放与冲突拒绝 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 旧合同/旧候选/旧回答按业务规则拒绝 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 会话隔离与工作隔离 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 停止后继续使用新 ticket，不重用旧执行 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 重启后交付、消息与 artifact 保留 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 越权 scope、未知项目、未准入 profile、认证与 Origin | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 桌面 1440×900 主对话中心布局 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 笔记本 1280×800 布局 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 窄屏 390×844 抽屉、键盘与关闭 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 加载/错误/离线与重连状态 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 完整 patch 预览与 artifact 下载字节校验 | PASS | NOT_TESTED | PASS | NOT_TESTED | NOT_TESTED |
| 有界混合周期稳定性（受控） | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 迁移清单验收规则（缺产物/坏 digest/无回滚拒绝） | PASS | NOT_TESTED | PASS | NOT_TESTED | NOT_TESTED |
| 新目录/新账户安装与 first-run | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 完整备份、恢复与路径映射 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 升级与回滚 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 会话目录、搜索、CAS 重命名、归档与恢复 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 待办注意信号：未结束工作、归档可见、交付后清除 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 跨项目注意力收件箱：排序/筛选/分页/逐项打开 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 验收等待与 UI 活动代理（unknown 不填 0） | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 推荐建议只在显式实验入口；默认路径关闭 | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED | NOT_TESTED |
| 冻结候选 + 独立复核 + sealed copy + 人工审阅 | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED | NOT_TESTED |
| 真实不同协议复核（版本/身份/预算/隔离/主题） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 项目设置版本化与归档 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 上下文、提案与明确决定治理 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 显式选源消息、同事务绑定、审计、SSE 与丢响应重放 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 完成回复先落盘、失败重开补齐且不重复请求 | PASS | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 真实 D 数据库迁移到当前 A schema 且数据保留 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| B 真实生产 begin/answer/stop 与独立进程恢复 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 恢复后首次启动只读、零业务发送 | PASS | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 明确决定、授权上下文、结构化提案与事务消费 | PASS | NOT_TESTED | PASS | NOT_TESTED | NOT_TESTED |
| 可迁移发行、安装、备份恢复、升级回滚 | NOT_TESTED | NOT_TESTED | PASS | PASS | NOT_TESTED |
| D 托管 upgrade/rollback-install 与显式 baseline/target 字节 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 模式保持、未知活 PID 阻断与不误杀 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 结构化提案 prepare/confirm/reject（真实 HTTP/SQLite） | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 提案网页预览/确认/拒绝与响应丢失重放 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 上下文来源/窗口/授权预览 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 恢复只读 inspect/prepare 与重放/重启边界 | PASS | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 工作证据与分页历史 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 显式恢复 personal 项目的只读审阅入口与拒绝面 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| D 归属/safety helper 与安装 subject 同一冻结包（旧包失败对照） | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 恢复授权 commit、目标准备与激活切换 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 真实原生停止/问题/恢复控制 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 独立会话复核价值试点（8例三组） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 真实原生执行、停止、审批与恢复 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |

完整数据见 `release-matrix.json`。

## 分开的三类结论

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 研究价值（独立会话复核是否值得继续） | **BLOCKED — 无价值结论** | 8 例三组一例未发；adapter_missing（无经准入的实际 adapter/整 turn 上界/隔离/材料/main 准入）；0/24 turn。BLOCKED 不是 no-go，也不是正收益。 |
| 产品准入（普通受控工作流） | 见 `controlled-product-workflow` tier | 真实 HTTP/SQLite/受控执行，不依赖试点。 |
| 安装准入（个人 Alpha） | **PASS（仅所测 tuple）**：cold personal、fixture 安装版 context、non-empty default-off→建议、候选 GET/prepare/confirm/replay/reject、非空第二根 readonly（候选/context/history/held work/原 body）、同包 source prepare/confirm/audit/进程重开、篡改拒绝、requested-data-root/copied-record stop、legacy16→18 迁移、跨 schema 拒绝 | E3-PERSONAL-COLD-START、E6-INSTALLED-CONTEXT、E7-BACKUP-CONTEXT-REPLY、E4-INSTALL-*、E4-BACKUP-RESTORE、E4-UPGRADE-CROSS-SCHEMA、E8-LEGACY16-MIGRATION、E7-OWNERSHIP-COPY；E33-OUTER-ZIP=PASS、E33-COHORT-RECOVERY=PASS。tuple=8296720d8a25f38c/schema 18，main schema 18；current-main install=PASS (actual personal discussion-only + mock provider HTTP context/history/source/reply)；E4-UPGRADE-ROLLBACK/FAULTS/CROSS、E7 copy/wrong-install、非空 backup 已执行；M1/discussionReadiness=true；D safety mocks=PASS（helper 从 ee tar 提取并核对文件 hash；旧97仅mock失败对照）；candidate installed=PASS；second root=PASS（probeScope=fixture+recovery_readonly）；installed source confirm=PASS；installed stability=PASS；workflow formats=PASS（按包能力：default1+explicit2）；personal review=PASS（consumerOrigin=package，digest=585a3095…，scopeDiagnostics=present）；refusals=PASS；review reuse=PASS（same=REUSED，digestSame=true，different=BLOCKED）。personal旧项目只读重绑定未到，对应项NOT_REACHED，403不自动放宽。 |

安装物身份（从本轮真实 tar tuple 读取，位置可用 PA_E_INSTALL_*_DIR 覆盖）：baseline buildId `2d94a7c31ef97b57` / schema 18 / tar `daee1a94…` / source `1fbaf940`；target buildId `8296720d8a25f38c` / schema 18 / tar `04926739…` / source `82ee5b8f`。均为 darwin/arm64、Node 24.21.0、SQLite ABI 137。verdict 只对所测 tuple 成立，旧版本结果未改标签。

## 独立复核价值试点

- 预注册协议：`tools/experiments/review-pilot-01/protocol.json`（24 turn / 20万 token / 5 USD）。
- 冻结输入：8 个合成候选（4 个预埋缺陷、4 个干净）、隐藏 oracle 测试、评分规则均已 hash；`node tests/product-acceptance/pilot/harness.mjs --freeze --check` 可复验。
- 预检：**BLOCKED (adapter_missing)**。没有经准入的单一实际 adapter（精确 executable/version/model/provider、全部计费组件的整 turn 硬上界、隔离、session、材料与 main 准入）；缺接口时**不回退 CLI**。价格文件本身不授权。**0/24 turn、0 token、USD unknown、0 unknown send**；ledger 保留原值，预检只标注。
- 执行链已不是占位：E 不再自己拼 CLI；唯一发送入口是 B 拥有的 sender 模块（E 只 import 并传 reservationId，不 spawn 命令），E 只做持久预留。作者 turn → 冻结真实 candidate 摘要 → 同一 session 续会话复核 → 全新 session 在密封副本复核 → 严格报告校验与评分。每次发送前持久预留，预检/失败不覆盖账；unknown 用量按预留上界计费并转 BLOCKED_UNKNOWN_USAGE，之后不再发送。
- 账本与预留已按 wave-07 收紧：已存在但损坏/字段错/历史缺失/伪造身份的 ledger 不回退全零；预留使用 adapter 声明的整 turn 上界（无字节估算或 Math.min 裁小），并发写入串行化，重复预留/结算幂等，measured overrun 直接 BLOCKED_BOUND_VIOLATION。
- `--selftest` 66 项通过（v1 legacy 全套身份/上限/历史/unknown 拒绝、损坏/伪造账、并发锁、单 turn 在途、预留先于发送、完整计费链：只有 totalTokens 时 costOf 返回 unknown 并按上界计费阻断、越界阻断、sender 必须回显 reservation 身份、缺 B sender 模块不发送）；它证明会计与准入，不是收益结果。
- 干跑：`--dry-run` 用合成报告验证评分/预算/拒绝机制（检出、误报、缺 usage、预算不一致、挑例、改 oracle、报告越权均被正确处理）；干跑不是收益结果。
- 要解除阻断：操作者提供 `pilot/pricing.json`（model、inputPerMillion、outputPerMillion、USD、source、observedAt）；预检 PASS 后才允许 `--execute --confirm-grant`，且仍受原 24/200000/USD5 上限。

## Tier 判定（同一份证据）

| tier | 结果 |
| --- | --- |
| `module` | PASS |
| `controlled-product` | PASS |
| `actual-native-control` | FAIL（case_not_pass, layer_not_allowed） |
| `installed-alpha` | PASS |
| `installed-functional` | PASS |
| `advisory-routing` | FAIL（case_not_pass, layer_not_allowed） |
| `controlled-review` | FAIL（case_not_pass, layer_not_allowed, missing_required_case） |
| `actual-heterogeneous-review` | FAIL（case_not_pass, layer_not_allowed, missing_required_case） |
| `review-value` | FAIL（case_not_pass, layer_not_allowed） |
| `local-alpha` | PASS |
| `full-product` | FAIL（missing_required_case, case_not_pass, layer_not_allowed, required_evidence_missing） |

## 明确未测

- **主对话：普通消息持久化与重开**：真实模型回复与流式界面未在本轮执行；budget 0。
- **明确委托到受控执行、验证与完成**：真实 Codex 执行属于 B 的原生验收，E 未触发计费任务。
- **问题中心：打开、回答、投递与决策收件箱**：真实原生权限/审批问题未执行；B 的原生证据未作为输入提供。
- **机器检查、完整 patch、artifact 字节与人工接受**：原生注册检查与真实 deliverable 未在本轮复验。
- **验证阻断→明确重新检查→同一候选验证→接受→重开**：生产故障注入接口不存在；阻断由受控 completion port 注入，其余步骤走真实 HTTP。
- **接受结果投影与工作证据读取**：工作台内进一步的时间线展示仍单列；source_missing/not_in_window 需要旧库来源缺失场景。
- **旧合同/旧候选/旧回答按业务规则拒绝**：旧提案与决定的撤销治理（C 未交付）
- **会话隔离与工作隔离**：两个独立项目的隔离：受控 lane 只有一个项目。
- **停止后继续使用新 ticket，不重用旧执行**：真实原生写进程停止与物理资源屏障由 B 证明。
- **重启后交付、消息与 artifact 保留**：协调器 SIGKILL 后的原生恢复与重连（B 范围）。
- **有界混合周期稳定性（受控）**：长时间 soak、负载与多实例并发。
- **新目录/新账户安装与 first-run**：PA_CONFIG_ROOT 覆盖后 release.json 不随 first-run 写入（owner D，已完成最小复现）。
- **完整备份、恢复与路径映射**：恢复后的新授权/重绑定归 main（E4-REAUTHORIZATION NOT_TESTED）；旧项目绑定恢复仍只读。
- **升级与回滚**：真实升级需要第二个冻结 buildId；state 回滚已在同一字节上通过。
- **待办注意信号：未结束工作、归档可见、交付后清除**：真实 decisionDeadline/expiresAt 与多 tab 重叠未验证；本项目只有一个受控项目。
- **跨项目注意力收件箱：排序/筛选/分页/逐项打开**：真实业务截止与授权过期后的问题失效仍无公开入口（E3-ATTENTION-DEADLINES、E3-DECISION-SOURCE-STATES）；deterministic_priority 排序与逐项动作已通过。
- **验收等待与 UI 活动代理（unknown 不填 0）**：多 tab 重叠区间并集未直接测量；活动是可见/聚焦代理，不是人工思考时间。
- **推荐建议只在显式实验入口；默认路径关闭**：C 的 packages/routing 与 main 的 HTTP/UI 入口未交付；0/1/多候选、身份漂移、旧政策等产品负例无法执行。
- **冻结候选 + 独立复核 + sealed copy + 人工审阅**：无 review Work/HTTP/证据发布入口；E3-REVIEW-PIPELINE 未执行。
- **真实不同协议复核（版本/身份/预算/隔离/主题）**：第二协议未实现，独立试点 preflight 为 BLOCKED；不能把替换模型或 fixture 当异构。
- **项目设置版本化与归档**：仅合同 revision 已验证；项目设置版本 API 未交付（RFC-E-001 缺口 2）。
- **上下文、提案与明确决定治理**：自动结构化提案确认仍未发布（owner C/main）；当前只验证显式 prepare/confirm/reject。；源消息删除/授权过期/事务失败注入缺少公开入口（E3-DECISION-SOURCE-STATES）。
- **显式选源消息、同事务绑定、审计、SSE 与丢响应重放**：E3-CONTEXT-HISTORY/SOURCES 与 UI history tab 已覆盖签名分页、原文核对、model-off 与损坏 bundle；readonly/跨 principal 历史由各自层报告。；E3-CONTEXT-UI 已覆盖单 tab 丢响应重放、mobile、双 tab 与 history tab；未覆盖真实崩溃恢复中的浏览器 pending 多进程场景。
- **完成回复先落盘、失败重开补齐且不重复请求**：历史正文本轮由 E7-SECOND-ROOT-READONLY 在第二根重新读取；候选在安装包内 default-off→显式开启后验证非空建议与 confirm/replay/reject。
- **B 真实生产 begin/answer/stop 与独立进程恢复**：E4-B-PRODUCTION-RECOVERY：main 当前产品未消费 B 新生产控制；fixture/WORK 存在不等于真实 Runner begin/answer/stop 恢复。
- **恢复后首次启动只读、零业务发送**：解除隔离后的新授权/环境重绑定未实现，不在本轮声明。
- **明确决定、授权上下文、结构化提案与事务消费**：自动提案确认与撤销后上下文失效未发布。
- **可迁移发行、安装、备份恢复、升级回滚**：安装矩阵按 tar/sha/build/source/schema 参数化，不再固定 schema13 或端口；跨机器/跨 ABI 未测，只测 darwin/arm64 + Node 24.21.x + ABI 137。；旧 config root 指向不同安装时 first-run 以 release_source_conflict 拒绝且不启动；迁移只经显式 upgrade。；E6-CURRENT-MAIN-INSTALL：99832f6 实测 context/history/sources/replyResults=true，但 discussionReadiness=false；无执行器 personal 探针实际 BLOCKED，因此不是当前 M1 安装。
- **D 托管 upgrade/rollback-install 与显式 baseline/target 字节**：已执行 crash_after_stop、crash_after_stop_kill、target_unhealthy 三窗口 recovering previous + data preserved；pointer/spawn/record/ACK after-switch 仍未单独注入。；升级前的 writer 资源屏障与旧队列隔离由 main/B 证明；E 只验证数据与二进制行为。
- **模式保持、未知活 PID 阻断与不误杀**：E4-MULTI-STATE 在 schema18 字节通过 requested-root 拒绝；launcher 死后 API 已随 launcher 退出时该窗口标 NOT_TESTED（无可用窗口）。E7 copied-record 与 wrong-install 通过。E5-D-OWNERSHIP-MOCKS 的 UID/argv/operation/journal/scanner/role mock 仍 NOT_TESTED。
- **结构化提案 prepare/confirm/reject（真实 HTTP/SQLite）**：source/grant 漂移与 outer receipt 失败注入未在 HTTP 层单独执行；网页层由 E3-PROPOSAL-UI 覆盖。
- **上下文来源/窗口/授权预览**：E3-CONTEXT-GRANT-BOUNDARY 仍未执行：expired grant/purpose/超预算的 HTTP 级反例缺少入口。
- **工作证据与分页历史**：storage_cap 与并发写入窗口未单独触发；历史窗口语义按 complete/caller_limit 已验证。
- **显式恢复 personal 项目的只读审阅入口与拒绝面**：有效签名下的过期/foreign principal/host 拒绝由 main 模块契约覆盖；E 不伪造 probe-owned key。
- **D 归属/safety helper 与安装 subject 同一冻结包（旧包失败对照）**：只测 launcher helper 的 same-UID child 归属；广泛 live stop/cleanup 仍按 D 自有矩阵执行。
- **恢复授权 commit、目标准备与激活切换**：commit/activation 未发布；E5-RECOVERY-INTERRUPTION 记录四个中断窗口，prepare 不能替代授权。
- **真实原生停止/问题/恢复控制**：B 的当前真实控制证据未作为输入提供；E 无该预算，不能把 fixture 当原生。
- **独立会话复核价值试点（8例三组）**：Preflight BLOCKED：adapter_missing（没有经准入的单一实际 adapter 及其整 turn 硬上界/隔离/session/材料/main 准入）；0/24 turn；runner 45 项 selftest 证明损坏账/伪造身份/裁小预留/缺接口 fallback 均拒绝且 fake 发送为 0，但没有准入就不发送；无价值结论。
- **真实原生执行、停止、审批与恢复**：B 的原生证据未作为已提交输入提供；E 未获单独预算，不触发模型任务。

## 限制

- 受控 fixture lane 的 `native_applied` 表示受控协议 ACK，不是真实厂商 agent 行为。
- RSS/FD/磁盘是单实例观察；端口不变不能证明无进程泄漏。
- 截图与几何断言只证明可达/不溢出/不重叠，不评价美观。
- 推荐/复核仍只在实验入口；advisory/controlled-review/heterogeneous tier 因生产者缺失而非零。
- 真实 native 投递/控制证据缺失，因此 `full-product` 仍被 gate 拒绝；`installed-alpha` 与 `local-alpha` 只对所测 baseline→target 组合成立。wave-17 的 installed-alpha PASS 因 E5-D-OWNERSHIP-MOCKS 从 D checkout import helper 给旧 97 安装补证，属跨 subject 放行，已在 wave-18 明确撤销；旧 report/证据文件保留为历史，不重贴给新 tuple。
- 试点被预检阻断，不能把 harness 或干跑当作价值已验证。

## 下一消费者

1. D：65102f7/schema18 已通过同包 helper 5/5（旧 97 同探针 2 PASS/3 FAIL 作为失败对照）、current-main personal discussion-only（context/history/source/reply/候选）、default-off→建议、第二根 readonly 与 source 确认。后续新 tar 只需保持同一 tuple 契约；旧 97 的对话数据 scope 保留，但不再向新包或新源码外借。
2. main/B：发布真实恢复 activation（私有 host/resources/许可）与 B 生产 begin/answer/stop 消费者；E 已关闭 A18 回复/SIGKILL/坏 artifact、context history/source/frozen UI、同包 source 确认和第二根非空恢复。第二根 source 确认始终 not_granted/startupAvailable=false。
3. main：继续交 recovery activation 与真实空目标启动；E 已独立验证 context-use/SSE/audit、单 tab 丢响应、双 tab 独立旧 selection、mobile 再选源和 reply consumer，不重复把入口未发布当阻断。
4. B：提供绑定 commit/attempt 的原生证据（`executed: true` + model task 计数）；E 只消费，不重跑计费任务。旧安装结果、wave09/wave10 ledger 与报告原样保留。

## 复验命令

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r --filter '@personal-agent/*' build
node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only
node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow
node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui
node tests/product-acceptance/pilot/harness.mjs --selftest
node tests/product-acceptance/run.mjs --suites=e4 --tier=e4-bounded-stability
node tests/product-acceptance/run.mjs --suites=e4 --tier=installed-alpha
node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record
```

最后一条命令以 `controlled-product-workflow` 聚合；同一份报告还要分别用 `--tier=installed-alpha` 与 `--tier=review-value` 判读，任何缺失的必需项都会让该 tier 保持非零。
