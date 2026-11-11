# Agent E 第六轮交付交接

- 分支 `codex/g3-product-acceptance`，基线 `6f6edde`，检查点 `dc351a4`，本次证据源 `ec98421e528955b5cbbca864f9c878099749f32f`（干净工作树）。证据文件随源提交之后的提交一起交付；`git log` 的分支头即最终交付提交。
- 拥有路径：`tests/product-acceptance/`。未修改生产实现、root manifest/lock、公共 schema 或迁移。
- 模型预算：0 个真实模型任务；唯一模型对端是本机 loopback mock。原生执行：0。

## 实际命令与结果

| 真实命令 | 覆盖病例 | 结果 |
| --- | --- | --- |
| `node tests/product-acceptance/pilot/harness.mjs --preflight` | 冻结输入/价格/ledger | BLOCKED（pricing_unavailable）；runner selftest 17/17 |
| `node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only` | E1-* | PASS 72 |
| `node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow` | E2-* | PASS 19 + NOT_TESTED 3 |
| `node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui` | E3-* | PASS 17 + NOT_TESTED 4 |
| `node tests/product-acceptance/run.mjs --suites=e4 --tier=installed-alpha` | E4-* / E5-NATIVE-CONTROL / E6-REVIEW-PILOT | PASS 9 + NOT_TESTED 5 |
| `node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record` | 全部 129 | PASS 117 + FAIL 0 + SKIPPED 0 + NOT_TESTED 12 + BLOCKED 0 + UNKNOWN 0 |

本次聚合：**PASS**（tier `controlled-product-workflow`）。证据目录 `/Users/hh/Desktop/joker/superagent-agent-e/tests/product-acceptance/reports/runs/2026-11-11T03-51-54-941Z`。

## 矩阵摘要

| 能力 | 受控 fixture | SDK mock | 只读 | 安装（同一字节） | 实际原生 |
| --- | --- | --- | --- | --- | --- |
| 主对话：普通消息持久化与重开 | PASS | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 明确委托到受控执行、验证与完成 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 问题中心：打开、回答、投递与决策收件箱 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 机器检查、完整 patch、artifact 字节与人工接受 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 验证阻断→明确重新检查→同一候选验证→接受→重开 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
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
| 迁移清单验收规则（缺产物/坏 digest/无回滚拒绝） | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED | NOT_TESTED |
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
| 真实原生停止/问题/恢复控制 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 独立会话复核价值试点（8例三组） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 真实原生执行、停止、审批与恢复 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |

完整数据见 `release-matrix.json`。

## 分开的三类结论

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 研究价值（独立会话复核是否值得继续） | **BLOCKED — 无价值结论** | 8 例三组一例未发；pricing_unavailable；0/24 turn。BLOCKED 不是 no-go，也不是正收益。 |
| 产品准入（普通受控工作流） | 见 `controlled-product-workflow` tier | 真实 HTTP/SQLite/受控执行，不依赖试点。 |
| 安装准入（个人 Alpha） | 见 `installed-alpha` tier；同一冻结字节在全新目录可启动/备份/恢复/回滚，升级项缺第二个冻结产物 | E4-INSTALL-*、E4-BACKUP-RESTORE、E4-INSTALL-ROLLBACK；E4-UPGRADE-ROLLBACK NOT_TESTED。 |

安装物身份：`wave06-alpha-d4eb3a13` / buildId `d4eb3a13f4904d2d` / tar sha256 `8b7675bafa7cded2c9c0656655abca3ff21721d52c3dc4f573a667d93f81f122` / 19,762,194 bytes / darwin-arm64 / Node 24.21.0 / SQLite ABI 137。生产者 source commit `9046d4c5` 记录为 dirty，因此这些字节不能由某个干净提交重建——这是候选安装物，不是可重现发行。

## 独立复核价值试点

- 预注册协议：`tools/experiments/review-pilot-01/protocol.json`（24 turn / 20万 token / 5 USD）。
- 冻结输入：8 个合成候选（4 个预埋缺陷、4 个干净）、隐藏 oracle 测试、评分规则均已 hash；`node tests/product-acceptance/pilot/harness.mjs --freeze --check` 可复验。
- 预检：**BLOCKED (pricing_unavailable)**。Codex 0.164.0 可用且为 API key 计量（模型 gpt-6.1-sol），但没有操作者可核对的 USD 价格表。协议禁止把密钥/订阅当零成本。**0/24 turn、0 token、USD unknown、0 unknown send**；ledger 保留原值，预检只标注。
- 执行链已不是占位：作者 turn（workspace-write）→ 冻结真实 candidate 摘要 → 同一 session 续会话复核（read-only）→ 全新 session 在密封副本复核（read-only）→ 严格报告校验与评分。每次发送前持久预留，预检/失败不覆盖账；unknown 用量按预留上界计费并转 BLOCKED_UNKNOWN_USAGE，之后不再发送。
- `--selftest` 17 项通过（单 turn 在途、预留先于发送、unknown 不归还、token/USD 上限、作者/复核分项上限、usage/session 解析）；它证明会计与进程适配，不是收益结果。
- 干跑：`--dry-run` 用合成报告验证评分/预算/拒绝机制（检出、误报、缺 usage、预算不一致、挑例、改 oracle、报告越权均被正确处理）；干跑不是收益结果。
- 要解除阻断：操作者提供 `pilot/pricing.json`（model、inputPerMillion、outputPerMillion、USD、source、observedAt）；预检 PASS 后才允许 `--execute --confirm-grant`，且仍受原 24/200000/USD5 上限。

## Tier 判定（同一份证据）

| tier | 结果 |
| --- | --- |
| `module` | PASS |
| `controlled-product` | PASS |
| `actual-native-control` | FAIL（case_not_pass, layer_not_allowed） |
| `installed-alpha` | FAIL（case_not_pass, required_evidence_missing） |
| `advisory-routing` | FAIL（case_not_pass, layer_not_allowed） |
| `controlled-review` | FAIL（case_not_pass, layer_not_allowed, missing_required_case） |
| `actual-heterogeneous-review` | FAIL（case_not_pass, layer_not_allowed, missing_required_case） |
| `review-value` | FAIL（case_not_pass, layer_not_allowed） |
| `local-alpha` | FAIL（case_not_pass, required_evidence_missing） |
| `full-product` | FAIL（case_not_pass, required_evidence_missing, missing_required_case, layer_not_allowed） |

## 明确未测

- **主对话：普通消息持久化与重开**：真实模型回复与流式界面未在本轮执行；budget 0。
- **明确委托到受控执行、验证与完成**：真实 Codex 执行属于 B 的原生验收，E 未触发计费任务。
- **问题中心：打开、回答、投递与决策收件箱**：真实原生权限/审批问题未执行；B 的原生证据未作为输入提供。
- **机器检查、完整 patch、artifact 字节与人工接受**：原生注册检查与真实 deliverable 未在本轮复验。
- **验证阻断→明确重新检查→同一候选验证→接受→重开**：生产故障注入接口不存在；阻断由受控 completion port 注入，其余步骤走真实 HTTP。
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
- **可迁移发行、安装、备份恢复、升级回滚**：E4-UPGRADE-ROLLBACK 需要第二个冻结 buildId（同 schema）；同一字节上的 state 回滚已通过。；PA_CONFIG_ROOT 覆盖后 release.json 缺失（owner D，最小复现已记录）。
- **真实原生停止/问题/恢复控制**：B 的当前真实控制证据未作为输入提供；E 无该预算，不能把 fixture 当原生。
- **独立会话复核价值试点（8例三组）**：Preflight BLOCKED：pricing_unavailable（配置模型没有操作者可核对的 USD 价格表）；0/24 turn；真实作者/续会话/新 session 执行链已实现并有 17 项 runner selftest（预留先于发送、单 turn 在途、unknown 不归还、token/USD 上限），但没有价格就不发送；无价值结论。
- **真实原生执行、停止、审批与恢复**：B 的原生证据未作为已提交输入提供；E 未获单独预算，不触发模型任务。

## 限制

- 受控 fixture lane 的 `native_applied` 表示受控协议 ACK，不是真实厂商 agent 行为。
- RSS/FD/磁盘是单实例观察；端口不变不能证明无进程泄漏。
- 截图与几何断言只证明可达/不溢出/不重叠，不评价美观。
- 推荐/复核仍只在实验入口；advisory/controlled-review/heterogeneous tier 因生产者缺失而非零。
- 第二协议与真实 native 证据缺失；安装缺第二个 buildId 的升级演练，因此 `local-alpha`、`full-product` 被 gate 拒绝。
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
node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record
```

最后一条命令以 `controlled-product-internal-trial` 聚合；任何 FAIL、缺失或未执行都会非零退出。
