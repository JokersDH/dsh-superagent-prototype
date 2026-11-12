# 第十一轮：十阶段长任务整包

2026-11-12。用户希望A–E连续开发更久；本轮每人十个产出阶段、三次稳定source检查点及独立备选队列。先读[0035验收/共享输入](../../docs/rfcs/WP-16/0035-wave-11-admission-and-long-run-packages.md)、[复现记录](../../reports/releases/wave11-admission/README.zh-CN.md)，再读自己的packet。合并最新origin/main，保留原工作树/分支和已有改动。

## 五个大包

| Agent | 原工作区/分支 | 长任务成果 |
| --- | --- | --- |
| A | /Users/hh/Desktop/joker/superagent-agent-a · codex/g2-workspaces-verification | [源快照、回复结果与历史存储](agent-a-data.zh-CN.md) |
| B | /Users/hh/Desktop/joker/superagent-agent-b · codex/g1-runtime | [真实持久控制与可消费运行时](agent-b-runtime.zh-CN.md) |
| C | /Users/hh/Desktop/joker/superagent-agent-c · codex/g3-assistant-context | [可靠来源检索、审阅与提案数据](agent-c-context.zh-CN.md) |
| D | /Users/hh/Desktop/joker/superagent-agent-d · codex/g3-local-distribution | [多实例隔离、便携个人安装与升级](agent-d-delivery.zh-CN.md) |
| E | /Users/hh/Desktop/joker/superagent-agent-e · codex/g3-product-acceptance | [当前用户流程和真实安装独立验收](agent-e-acceptance.zh-CN.md) |
| main | /Users/hh/Desktop/joker/superagent · codex/g2-execution-integration | [恢复授权与日常产品接线](main.zh-CN.md) |

本轮不重新派发已完成的A三反例/v16或main上下文消息；这些成果作为新包基础。D通用stop的P1先关，B/C新候选准入问题各自先关；main已用4140cac提供实际context-use/SSE，不再接受旧基线“入口未发布”作为整包阻断。

## 已发布稳定输入

main98a50ca已交真实schema/类型/生成manifest，SQL实现仍待A：

- `RecoverySourceReader`位于`packages/contracts/src/recovery-source.ts`，A暴露`store.workflows.recoverySource`。逻辑摘要只排除精确本笔确认与固定heartbeat字段，数据complete不是物理writer证明。
- `AssistantReplyResults`位于`assistant-records.ts`，A暴露`store.workflows.assistant.replyResults`。既有before-send request不等于完成结果；仅真实已返回的受限正文/候选artifact可持久化，未知不重发。
- `AssistantContextHistory`同文件，A暴露`store.workflows.assistant.contextHistory`。按授权projectIds/会话/work keyset分页；公共cursor由main签名，历史不是新的模型或执行授权。

现有接口继续使用：AssistantContextBindings、RecoveryTargetMaterializer/InventoryReader、原Authenticated VerifiedRunnerInspection/单一proof WeakMap、PreparedUserCommand和原提案事务。C使用既有ReasonerProposalSchema表达候选；不创造新writer、grant、确认状态机、LLM loop或执行生命周期。

## 连续执行规则

1. 阶段1–2交早期可运行checkpoint并push，然后继续阶段3以后。阶段4–6交第二个稳定source，阶段10交完整包；不用等每次人类回复。
2. 外部依赖缺失时，只将对应组合验收记NOT_TESTED；给出最小复现/owner/接口，继续packet独立队列。不要让恢复、旧tar或研究阻断普通产品工作。
3. 检查点必须包含代码/fixture/命令与exit/source/限制。文档/schema/内存重建不算真实持久恢复，main自测不替E独立断言，版本/健康不算native任务。
4. 全部可独立内容完成后收尾并列剩余输入；不做无限轮询、空跑计时、无目标测试重复或额外付费任务。长时间来自完整子系统和故障/兼容工作量。

## 拥有边界

main管contracts/application/questions/coordinator/console/root config/lock、共享文档与跨模块准入；A唯一storage/workflows/生产迁移；B管execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C管context/proposals/knowledge/routing；D管launcher/distribution/portability；E只改product-acceptance。每人提交explicit owned paths，只push原origin分支。

新公共语义/迁移归属需求先交RFC/最小复现，不能复制私有wire或另开数据库。main要先交真实consumer再让别人补组合验收，不能将自己的HTTP/provider/激活欠项转给A/C/D。

## 预算和环境

本轮所有自动开发/验收真实模型/native turn0。B旧cap4 UNKNOWN余额不可花；E旧24turn（8作者+16复核）/200000计费token/USD5/单在途账不刷新、不退unknown、不补样本，研究仍BLOCKED。B/E拒绝协议做有限fixture收口，不重复费用调查/B9，不新增Driver/CAC/桌面壳/自动接受或动态Ticket DAG。

保留九组用户5180/8796至5188/8804及所有state、原五个工作树、旧ledger和tar。只在隔离temp资源测试；只能结束本次可证明自有PID/start/root/operation，不按共同install或模糊argv认领进程。全局runtime/native账号不改。

普通个人安装不依赖恢复激活/研究；冻结字节先给E，E最终verdict不构成构建前置。当前main数据schema16，D旧schema15包缺context-use必须如实标记；后续A迁移以实际schema为准，测试不能写死15/16。

静态检查：`node agent-tasks/product-wave-11/verify.mjs`，只检查计划链接、归属、依赖和预算，不颁发产品准入。[分别转发话术](forward-prompts.zh-CN.md)可直接下发给原Agent。
