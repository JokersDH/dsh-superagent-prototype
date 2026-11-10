# 第四轮：完整助理闭环与可迁移个人版

新任务改按 [第五轮](../product-wave-05/README.zh-CN.md)；本轮尚未关闭的实际接线/准入缺口纳入下一包首阶段，历史报告及预算继续有效，不表示整轮已产品准入。

日期 2026-11-10；输入基线 `a42924a` 加本轮主线检查点，开工合并最新 `origin/main`。本轮取代 product-wave-03 的新工作安排；历史测试和预算仍保留。目标是把模块接成可日常使用的产品，并修复已复现的发布阻断。

## 五路整包

| 角色 | 完整任务书 | 主要结果 |
| --- | --- | --- |
| A | [持久化与索引](agent-a-state.zh-CN.md) | 决定来源元数据、持久提案、同步事务 port、会话成员索引、可信快照/状态读取 |
| B | [原生控制与验收真实性](agent-b-runtime.zh-CN.md) | 修复假通过判断和预算记账；通过生产 Runner 的停止/问题/恢复路径取得准确证据 |
| C | [助理领域与生产消费](agent-c-assistant.zh-CN.md) | 修复三个领域准入失败；对接 A；交可原子提交的上下文/提案/决定服务 |
| D | [发行与恢复准入](agent-d-distribution.zh-CN.md) | 修复活跃回滚、错误实例复用和摘要验证；恢复默认只读；真正可搬迁发行目录 |
| E | [独立产品与发行验收](agent-e-acceptance.zh-CN.md) | 修复发布门槛假通过；验新会话/恢复/助理/安装流程，交可信支持矩阵 |
| 主线 | [产品集成](main.zh-CN.md) | 项目设置、助手 HTTP/模型/工作台接线、恢复模式与试用准入 |

## 沿用的工作区

| Agent | 目录 | 分支 |
| --- | --- | --- |
| A | `/Users/hh/Desktop/joker/superagent-agent-a` | `codex/g2-workspaces-verification` |
| B | `/Users/hh/Desktop/joker/superagent-agent-b` | `codex/g1-runtime` |
| C | `/Users/hh/Desktop/joker/superagent-agent-c` | `codex/g3-assistant-context` |
| D | `/Users/hh/Desktop/joker/superagent-agent-d` | `codex/g3-local-distribution` |
| E | `/Users/hh/Desktop/joker/superagent-agent-e` | `codex/g3-product-acceptance` |

保留各自已有修改、原分支和提交。先检查状态，显式保存自己的修改，再 fetch/merge 最新 main。主线已 cherry-pick A/C 原提交，合并时消费已验收产品路径，不用旧版本覆盖。禁止 reset/clean/force-push；不改他人 checkout。

拥有路径沿用 wave-03：A storage/workflows 与唯一生产迁移；B runner/codex-native/driver-kit/testing/native-acceptance；C context/proposals/knowledge；D launcher/distribution/portability；E 仅 product-acceptance。主线独占 contracts/application/questions/coordinator/console/root lock。每人可维护自己包内 docs/tests/reports；共享 docs 与根文件只由主线改。

## 本轮已确认的输入

- 会话目录与验证恢复已在 main 接通，个人新预览是 5182/8798；旧 5180/8796、5181/8797 保留。测试只能使用自有临时 state/端口，不能重启这些用户实例。
- A `c74f2c6`、C `2441281` 已集成源码；A 的会话行为已产品接线，C 助理生产功能仍未启用。B `549c57b`、D `73cafed`、E `6dee03f` 是待修复/复验候选，不视为全包准入。
- C 三项独立 probe 失败：来源 missing 仍有效、已确认提案向另一 actor 重放仍返回 intent、调用者可修改记录引用的 grant scope。
- B 问题/恢复矩阵有两分支均 PASS、非法字段 400 冒充业务拒绝、同 assignment 冒充不重复 begin；真实 native 入口未接入新增预算 ledger。
- D 活跃 state 可被 rollback 移走；恢复后普通 start 会消费旧队列；实例复用未核对请求条件；大小相同的产物漂移可通过启动；没有完整可搬迁运行闭包。
- E full-product gate 可接受 controlled 层的“原生用例”、executed=false、dirty 源码与空证据。既有 scoped controlled 正常流程证据不因此丢弃，但 full-product 不可用于发布。

具体接口与复现见 [0016 主线约定](../../docs/rfcs/WP-16/0016-wave-04-interfaces-and-admission.md)。

## 连续实施约定

每包五阶段：先交稳定接口/首个可消费检查点，提交并 push 后直接继续剩余阶段；不逐修复等用户回复。每阶段结束消费新 main。跨模块依赖未到时提交最小复现、公开 port 请求和同接口 fixture，继续负例/消费者/工具；最终仅剩明确外部依赖时统一交接，不空转。

所有状态记录放在自己的 `reports/wave04-status.json`，不要覆盖旧预算/证据。每个检查点写 branch、source/base commit、拥有路径、实际命令、PASS/FAIL/NOT_TESTED、模型与未知发送账、阻断 owner 和下一消费者步骤。只显式暂存拥有路径、push 自己分支。根锁请求交主线。

模型预算：main/A/C/D/E 为 0，使用 controlled/local SDK mock。B 沿用**原 wave03 grant 最多 4 次、历史已用和 unknown 均保留**，新日期/任务包不刷新额度；先修真实入口的持久预留与核对，才可使用核实后的剩余额度。没有余额就继续零模型控制验证并报告原生未测，不能借 E 或另建 commandId 规避。主线本次审计启动真实模型任务 0。

## 集成顺序

1. A 提交 AssistantStatePort 持久检查点；C 可同时修纯领域错误并提供 prepare/commit 消费者。
2. 主线消费 A/C，接明确决定、结构化提案确认、有界上下文与项目设置；E 先验已在 main 的会话/验证恢复，再增量验新接口。
3. B 先修验收真实性、预算和生产控制回归，原生证据单列；不能把执行器品牌当兼容。
4. D 先修阻断和恢复门禁，再交可搬迁发行物；E 并行准备对应负例，等已提交产物后独立验。
5. 主线按证据决定个人 Alpha/内部本机试用范围。第二协议、CAC、桌面壳与自动学习仍排在关键闭环和发行之后。
