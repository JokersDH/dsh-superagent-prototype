# Agent E 第五轮交付交接

- 分支 `codex/g3-product-acceptance`，基线 `a70db20`，检查点 `ead7066`，本次证据源 `fea14dfdf9ee26b5c9439b7886bea2f3e8a16b3f`（干净工作树）。证据文件随源提交之后的提交一起交付；`git log` 的分支头即最终交付提交。
- 拥有路径：`tests/product-acceptance/`。未修改生产实现、root manifest/lock、公共 schema 或迁移。
- 模型预算：0 个真实模型任务；唯一模型对端是本机 loopback mock。原生执行：0。

## 实际命令与结果

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| E1 | `node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only` | PASS 65 |
| E2 | `node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow` | PASS 18 + NOT_TESTED 4 |
| E3 | `node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui` | PASS 14 + NOT_TESTED 2 |
| E4 | `node tests/product-acceptance/run.mjs --suites=e4 --tier=e4-bounded-stability --cycles=12` | PASS 3 + NOT_TESTED 4 |
| E5 | `node tests/product-acceptance/build-handoff.mjs --run <run-directory>` | 本文件与矩阵 |

本次聚合：**PASS**（tier `controlled-product-workflow`）。证据目录 `/Users/hh/Desktop/joker/superagent-agent-e/tests/product-acceptance/reports/runs/2026-11-10T12-47-18-252Z`。

## 矩阵摘要

| 能力 | 受控 fixture | SDK mock | 只读 | 实际原生 |
| --- | --- | --- | --- | --- |
| 主对话：普通消息持久化与重开 | PASS | PASS | NOT_TESTED | NOT_TESTED |
| 明确委托到受控执行、验证与完成 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 问题中心：打开、回答、投递与决策收件箱 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 机器检查、完整 patch、artifact 字节与人工接受 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 验证阻断→明确重新检查→同一候选验证→接受→重开 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 必需机器检查失败不可被人工接受 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 同 commandId 幂等重放与冲突拒绝 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 旧合同/旧候选/旧回答按业务规则拒绝 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 会话隔离与工作隔离 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 停止后继续使用新 ticket，不重用旧执行 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 重启后交付、消息与 artifact 保留 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 越权 scope、未知项目、未准入 profile、认证与 Origin | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 桌面 1440×900 主对话中心布局 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 笔记本 1280×800 布局 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 窄屏 390×844 抽屉、键盘与关闭 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 加载/错误/离线与重连状态 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 完整 patch 预览与 artifact 下载字节校验 | PASS | NOT_TESTED | PASS | NOT_TESTED |
| 有界混合周期稳定性（受控） | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 迁移清单验收规则（缺产物/坏 digest/无回滚拒绝） | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 新目录/新账户安装与 first-run | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 完整备份、恢复与路径映射 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 升级与回滚 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 会话目录、搜索、CAS 重命名、归档与恢复 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 待办注意信号：未结束工作、归档可见、交付后清除 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 跨项目注意力工作台：期限/等待排序与分组 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 验收等待与 UI 活动代理（unknown 不填 0） | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 推荐建议只在显式实验入口；默认路径关闭 | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 冻结候选 + 独立复核 + sealed copy + 人工审阅 | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 真实不同协议复核（版本/身份/预算/隔离/主题） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 独立会话复核价值试点（24 turn / 20万 token / 5 USD） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 项目设置版本化与归档 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 上下文、提案与明确决定治理 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 恢复后首次启动只读、零业务发送 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 明确决定、授权上下文、结构化提案与事务消费 | NOT_TESTED | NOT_TESTED | PASS | NOT_TESTED |
| 可迁移发行、安装、备份恢复、升级回滚 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 真实原生执行、停止、审批与恢复 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |

完整数据见 `release-matrix.json`。

## 独立复核价值试点

- 预注册协议：`tools/experiments/review-pilot-01/protocol.json`（24 turn / 20万 token / 5 USD）。
- 冻结输入：8 个合成候选（4 个预埋缺陷、4 个干净）、隐藏 oracle 测试、评分规则均已 hash；`node tests/product-acceptance/pilot/harness.mjs --freeze --check` 可复验。
- 预检：**BLOCKED (pricing_unavailable)**。Codex 0.164.0 可用且为 API key 计量，但配置模型没有可核对的 USD 价格表；协议禁止把订阅/密钥访问当作零成本。**0/24 turn、0 token、USD unknown**。
- 干跑：`--dry-run` 用合成报告验证评分/预算/拒绝机制（检出、误报、缺 usage、预算不一致、挑例、改 oracle、报告越权均被正确处理）；干跑不是收益结果。
- 要解除阻断：由操作者提供 `pilot/pricing.json`（model、inputPerMillion、outputPerMillion、USD、source、observedAt），预检通过后才允许 `--execute --confirm-grant`。

## Tier 判定（同一份证据）

| tier | 结果 |
| --- | --- |
| `advisory-routing` | FAIL（case_not_pass, layer_not_allowed, self_declared_pass_rejected） |
| `controlled-review` | FAIL（case_not_pass, layer_not_allowed, missing_required_case, self_declared_pass_rejected） |
| `actual-heterogeneous-review` | FAIL（case_not_pass, layer_not_allowed, missing_required_case, self_declared_pass_rejected） |
| `local-alpha` | FAIL（case_not_pass, layer_not_allowed, self_declared_pass_rejected） |
| `full-product` | FAIL（case_not_pass, layer_not_allowed, missing_required_case, self_declared_pass_rejected） |

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
- **新目录/新账户安装与 first-run**：D 的 apps/launcher、tools/distribution、packages/portability 尚未交付。
- **完整备份、恢复与路径映射**：无发行 bundle 与迁移 CLI。
- **升级与回滚**：无版本化发行产物。
- **待办注意信号：未结束工作、归档可见、交付后清除**：跨项目/期限/等待排序的注意力工作台尚未交付。
- **跨项目注意力工作台：期限/等待排序与分组**：Owner main/C；本轮未见聚合读取、期限排序或分组 UI，仅有每会话 attention 布尔值。
- **验收等待与 UI 活动代理（unknown 不填 0）**：多 tab 重叠区间并集未直接测量；活动是可见/聚焦代理，不是人工思考时间。
- **推荐建议只在显式实验入口；默认路径关闭**：C 的 packages/routing 与 main 的 HTTP/UI 入口未交付；0/1/多候选、身份漂移、旧政策等产品负例无法执行。
- **冻结候选 + 独立复核 + sealed copy + 人工审阅**：无 review Work/HTTP/证据发布入口；E3-REVIEW-PIPELINE 未执行。
- **真实不同协议复核（版本/身份/预算/隔离/主题）**：第二协议未实现，独立试点 preflight 为 BLOCKED；不能把替换模型或 fixture 当异构。
- **独立会话复核价值试点（24 turn / 20万 token / 5 USD）**：Preflight BLOCKED（pricing_unavailable），0/24 turn；未产生价值结论。
- **项目设置版本化与归档**：仅合同 revision 已验证；项目设置版本 API 未交付（RFC-E-001 缺口 2）。
- **上下文、提案与明确决定治理**：C 三项领域 probe 仍未修复；main 尚无决定/提案 HTTP 入口。；确认前不执行、重复确认幂等、撤销后失效、事务失败回滚与注入防护均未执行。
- **恢复后首次启动只读、零业务发送**：解除隔离后的新授权/环境重绑定未实现，不在本轮声明。
- **明确决定、授权上下文、结构化提案与事务消费**：C 的三项领域 probe 仍未修复；main 尚无决定/提案 HTTP 入口。；确认前不执行、撤销后失效、事务失败回滚与注入防护全部未执行。
- **可迁移发行、安装、备份恢复、升级回滚**：D 的 launcher/distribution/portability 未进入 main；无 staged bundle。
- **真实原生执行、停止、审批与恢复**：B 的原生证据未作为已提交输入提供；E 未获单独预算，不触发模型任务。

## 限制

- 受控 fixture lane 的 `native_applied` 表示受控协议 ACK，不是真实厂商 agent 行为。
- RSS/FD/磁盘是单实例观察；端口不变不能证明无进程泄漏。
- 截图与几何断言只证明可达/不溢出/不重叠，不评价美观。
- 推荐/复核仍只在实验入口；advisory/controlled-review/heterogeneous tier 因生产者缺失而非零。
- 安装、第二协议与真实 native 证据缺失，因此 `local-alpha`、`full-product` 被 gate 拒绝。
- 试点被预检阻断，不能把 harness 或干跑当作价值已验证。

## 下一消费者

1. 主线：审阅 `RFC-E-001-consumer-interfaces.zh-CN.md`，决定公共 DTO/命令归属；E 不复制生产类型。
2. B：提供绑定 commit/attempt 的原生证据（`executed: true` + model task 计数）；E 只消费，不重跑计费任务。
3. D：发布 launcher/distribution/portability 后，E 在新目录/新账户执行安装、first-run、备份恢复、升级回滚。
4. C：接线上下文/提案/决定后，E 增加“确认前不执行、重复确认幂等、撤销后失效、注入不扩权”用例。

## 复验命令

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm -r --filter '@personal-agent/*' build
node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only
node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow
node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui
node tests/product-acceptance/run.mjs --suites=e4 --tier=e4-bounded-stability --cycles=12
node tests/product-acceptance/run.mjs --suites=selftest,e2,e3,e4 --record
```

最后一条命令以 `controlled-product-internal-trial` 聚合；任何 FAIL、缺失或未执行都会非零退出。
