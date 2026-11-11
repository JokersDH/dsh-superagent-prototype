# Agent E 第六轮交付交接

- 分支 `codex/g3-product-acceptance`，基线 `531c6b6`，检查点 `6977bd9`，本次证据源 `4c38bd6d55523e42c2beaf59ee96cfa5e02d86be`（干净工作树）。证据文件随源提交之后的提交一起交付；`git log` 的分支头即最终交付提交。
- 拥有路径：`tests/product-acceptance/`。未修改生产实现、root manifest/lock、公共 schema 或迁移。
- 模型预算：0 个真实模型任务；唯一模型对端是本机 loopback mock。原生执行：0。

## 实际命令与结果

| 真实命令 | 覆盖病例 | 结果 |
| --- | --- | --- |
| `node tests/product-acceptance/pilot/harness.mjs --preflight` | 冻结输入/价格/ledger | BLOCKED（adapter_missing）；runner selftest 66/17 |
| `node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only` | E1-* | PASS 74 |
| `node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow` | E2-* | PASS 20 + NOT_TESTED 3 |
| `node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui` | E3-* | PASS 19 + NOT_TESTED 6 |
| `node tests/product-acceptance/run.mjs --suites=e4 --tier=installed-alpha` | E4-* / E5-NATIVE-CONTROL / E6-REVIEW-PILOT | PASS 13 + NOT_TESTED 5 |
| `node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record` | 全部 129 | PASS 126 + FAIL 0 + SKIPPED 0 + NOT_TESTED 15 + BLOCKED 0 + UNKNOWN 0 |

本次聚合：**PASS**（tier `controlled-product-workflow`）。证据目录 `/Users/hh/Desktop/joker/superagent-agent-e/tests/product-acceptance/reports/runs/2026-11-11T11-15-31-572Z`。

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
| 恢复后首次启动只读、零业务发送 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 明确决定、授权上下文、结构化提案与事务消费 | PASS | NOT_TESTED | PASS | NOT_TESTED | NOT_TESTED |
| 可迁移发行、安装、备份恢复、升级回滚 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| D 托管 upgrade/rollback-install 与显式 baseline/target 字节 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 模式保持、未知活 PID 阻断与不误杀 | NOT_TESTED | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 结构化提案 prepare/confirm/reject（真实 HTTP/SQLite） | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 提案网页预览/确认/拒绝与响应丢失重放 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 上下文来源/窗口/授权预览 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 恢复只读 inspect/prepare 与重放/重启边界 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
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
| 安装准入（个人 Alpha） | **PASS（仅所测 baseline→target tuple）**：cold install/config root/doctor、模式保持、备份恢复、D 托管 upgrade、升级后新数据、binary-only rollback 与未知 PID 阻断 | E4-INSTALL-*、E4-BACKUP-RESTORE、E4-INSTALL-ROLLBACK、E4-UPGRADE-ROLLBACK；同 schema 下 schema 拒绝不适用；崩溃窗口 E4-UPGRADE-FAULTS 仍 NOT_TESTED。 |

安装物身份（显式 baseline/target tuple）：baseline `wave06-alpha2-7e8f6ce6` / buildId `7e8f6ce6fa2e2633` / schema 13 / tar `0fe0ed53…c7631` / source `e10bfdb7`（clean）；target `wave08-target-cd0ecc29` / buildId `cd0ecc29d97d5c41` / schema 13 / tar `64bbe285…3d42` / source `9b75c2a1`（clean）。均为 darwin/arm64、Node 24.21.0、SQLite ABI 137。verdict 只对所测 tuple 成立；旧 dirty12→13 组合保留为历史。

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
- **上下文、提案与明确决定治理**：自动上下文与结构化提案确认未发布（owner C）。；源消息删除/授权过期/事务失败注入缺少公开入口（E3-DECISION-SOURCE-STATES）。
- **恢复后首次启动只读、零业务发送**：解除隔离后的新授权/环境重绑定未实现，不在本轮声明。
- **明确决定、授权上下文、结构化提案与事务消费**：自动提案确认与撤销后上下文失效未发布。
- **可迁移发行、安装、备份恢复、升级回滚**：target 已修复 PA_CONFIG_ROOT 初始化；baseline 的失败只作历史，不映射到 target。；跨机器/跨 ABI 未测；只测 darwin/arm64 + Node 24.21.x + ABI 137。
- **D 托管 upgrade/rollback-install 与显式 baseline/target 字节**：E4-UPGRADE-FAULTS：PA_UPGRADE_FAULT 崩溃窗口与 launcher 死/API 活守卫本轮未稳定执行，保持 NOT_TESTED。；升级前的 writer 资源屏障与旧队列隔离由 main/B 证明；E 只验证数据与二进制行为。
- **结构化提案 prepare/confirm/reject（真实 HTTP/SQLite）**：source/grant 漂移与 outer receipt 失败注入未在 HTTP 层单独执行；网页层由 E3-PROPOSAL-UI 覆盖。
- **上下文来源/窗口/授权预览**：main 仍无 context preview/read 入口；E3-CONTEXT-GRANT-BOUNDARY 记录了 expired/purpose/budget 反例与所需输入。
- **恢复授权 commit、目标准备与激活切换**：commit/activation 未发布；E5-RECOVERY-INTERRUPTION 记录四个中断窗口，prepare 不能替代授权。
- **真实原生停止/问题/恢复控制**：B 的当前真实控制证据未作为输入提供；E 无该预算，不能把 fixture 当原生。
- **独立会话复核价值试点（8例三组）**：Preflight BLOCKED：adapter_missing（没有经准入的单一实际 adapter 及其整 turn 硬上界/隔离/session/材料/main 准入）；0/24 turn；runner 45 项 selftest 证明损坏账/伪造身份/裁小预留/缺接口 fallback 均拒绝且 fake 发送为 0，但没有准入就不发送；无价值结论。
- **真实原生执行、停止、审批与恢复**：B 的原生证据未作为已提交输入提供；E 未获单独预算，不触发模型任务。

## 限制

- 受控 fixture lane 的 `native_applied` 表示受控协议 ACK，不是真实厂商 agent 行为。
- RSS/FD/磁盘是单实例观察；端口不变不能证明无进程泄漏。
- 截图与几何断言只证明可达/不溢出/不重叠，不评价美观。
- 推荐/复核仍只在实验入口；advisory/controlled-review/heterogeneous tier 因生产者缺失而非零。
- 真实 native 投递/控制证据缺失，因此 `full-product` 仍被 gate 拒绝；`installed-alpha` 与 `local-alpha` 仅对所测 baseline→target 组合成立。
- 试点被预检阻断，不能把 harness 或干跑当作价值已验证。

## 下一消费者

1. 主线：审阅 `RFC-E-001-consumer-interfaces.zh-CN.md`，决定公共 DTO/命令归属；E 不复制生产类型。
2. B：提供绑定 commit/attempt 的原生证据（`executed: true` + model task 计数）；E 只消费，不重跑计费任务。
3. D：补第二个冻结 buildId 供升级演练；修复 PA_CONFIG_ROOT 覆盖时 release.json 不随 first-run 写入的问题。其余安装路径已由 E 在同一字节上独立通过。
4. C：接线上下文/提案/决定后，E 增加“确认前不执行、重复确认幂等、撤销后失效、注入不扩权”用例。

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
