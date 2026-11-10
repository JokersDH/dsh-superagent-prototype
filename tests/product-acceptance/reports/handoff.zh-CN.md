# Agent E 交付交接

- 分支 `codex/g3-product-acceptance`，基线 `3957e30cbbaa3cd86a672fb4583922eba8364fc8`，检查点 `835d663`，本次证据源 `3a0abe28c5ef31fd72bba2ef9ff70c35e5545f36`（干净工作树）。证据文件随源提交之后的提交一起交付；`git log` 的分支头即最终交付提交。
- 拥有路径：`tests/product-acceptance/`。未修改生产实现、root manifest/lock、公共 schema 或迁移。
- 模型预算：0 个真实模型任务；唯一模型对端是本机 loopback mock。原生执行：0。

## 实际命令与结果

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| E1 | `node tests/product-acceptance/run.mjs --suites=selftest --tier=harness-only` | 21/21 self-test PASS；缺用例时 exit 1 |
| E2 | `node tests/product-acceptance/run.mjs --suites=e2 --tier=e2-controlled-workflow` | 12/12 PASS |
| E3 | `node tests/product-acceptance/run.mjs --suites=e3 --tier=e3-browser-ui` | 7/7 PASS |
| E4 | `node tests/product-acceptance/run.mjs --suites=e4 --tier=e4-bounded-stability --cycles=12` | 2 PASS + 3 NOT_TESTED |
| E5 | `node tests/product-acceptance/build-handoff.mjs --run <run-directory>` | 本文件与矩阵 |

本次聚合：**PASS**（tier `controlled-product-internal-trial`）。证据目录 `/Users/hh/Desktop/joker/superagent-agent-e/tests/product-acceptance/reports/runs/2026-11-10T05-16-03-627Z`。

## 矩阵摘要

| 能力 | 受控 fixture | SDK mock | 只读 | 实际原生 |
| --- | --- | --- | --- | --- |
| 主对话：普通消息持久化与重开 | PASS | PASS | NOT_TESTED | NOT_TESTED |
| 明确委托到受控执行、验证与完成 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 问题中心：打开、回答、投递与决策收件箱 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 机器检查、完整 patch、artifact 字节与人工接受 | PASS | NOT_TESTED | NOT_TESTED | NOT_TESTED |
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
| 会话目录、搜索与归档 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 项目设置版本化与归档 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 上下文、提案与明确决定治理 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |
| 真实原生执行、停止、审批与恢复 | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |

完整数据见 `release-matrix.json`。

## 明确未测

- **主对话：普通消息持久化与重开**：真实模型回复与流式界面未在本轮执行；budget 0。
- **明确委托到受控执行、验证与完成**：真实 Codex 执行属于 B 的原生验收，E 未触发计费任务。
- **问题中心：打开、回答、投递与决策收件箱**：真实原生权限/审批问题未执行；B 的原生证据未作为输入提供。
- **机器检查、完整 patch、artifact 字节与人工接受**：原生注册检查与真实 deliverable 未在本轮复验。
- **旧合同/旧候选/旧回答按业务规则拒绝**：旧提案与决定的撤销治理（C 未交付）
- **会话隔离与工作隔离**：两个独立项目的隔离：受控 lane 只有一个项目。
- **停止后继续使用新 ticket，不重用旧执行**：真实原生写进程停止与物理资源屏障由 B 证明。
- **重启后交付、消息与 artifact 保留**：协调器 SIGKILL 后的原生恢复与重连（B 范围）。
- **有界混合周期稳定性（受控）**：长时间 soak、负载与多实例并发。
- **新目录/新账户安装与 first-run**：D 的 apps/launcher、tools/distribution、packages/portability 尚未交付。
- **完整备份、恢复与路径映射**：无发行 bundle 与迁移 CLI。
- **升级与回滚**：无版本化发行产物。
- **会话目录、搜索与归档**：公共 HTTP 尚无会话目录/搜索/归档接口（见 RFC-E-001 缺口 1）。
- **项目设置版本化与归档**：仅合同 revision 已验证；项目设置版本 API 未交付（RFC-E-001 缺口 2）。
- **上下文、提案与明确决定治理**：C 的 packages/context、proposals、knowledge 未交付；确认前不执行、重复确认幂等、撤销后失效无法端到端验证。；本次仅记录 record_decision 的显式拒绝（见 E2-CONTEXT-PROPOSALS-NOT-TESTED）。
- **真实原生执行、停止、审批与恢复**：B 的原生证据未作为已提交输入提供；E 未获单独预算，不触发模型任务。

## 限制

- 受控 fixture lane 的 `native_applied` 表示受控协议 ACK，不是真实厂商 agent 行为。
- RSS/FD/磁盘是单实例观察；端口不变不能证明无进程泄漏。
- 截图与几何断言只证明可达/不溢出/不重叠，不评价美观。
- 安装与原生证据缺失，因此 `full-product` tier 会被 gate 以 `case_not_pass` 拒绝。

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
