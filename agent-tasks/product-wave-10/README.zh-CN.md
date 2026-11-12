# 第十轮大颗粒整包：上下文可用、恢复可信、普通安装可试用

2026-11-11。先读[0033验收及稳定输入](../../docs/rfcs/WP-16/0033-wave-10-admission-and-product-closure.md)、[独立反例](../../reports/releases/wave10-admission/README.zh-CN.md)，再读自己的packet。基线main `2caee2e`，产品 `32fc7ae`；开工合并实际最新origin/main，保留原目录、分支、候选、历史报告与账本。已有context/evidence网页已交，不能继续用531c6b6说main缺入口。

主线已继续发布[0034实际上下文发送/目标消费者](../../docs/rfcs/WP-16/0034-context-use-and-target-preparation.md)，产品4140cac、A数据schema16。A/C/E可以直接消费真实prepare/send/audit/SSE；D可跑实际跨source目标准备。早期“main缺入口”只保留历史；恢复activate尚未交，不用准备成功替代授权。新增用户预览5188/8804，与原八组一起保留。继续本轮原六阶段整包，无需新派工或刷新预算。

## 本轮成果

1. 用户可把有界、经复验的所选上下文用于一条对话，并查看来源；默认关闭，没有新推理循环或隐式派单。
2. 真正完成source→私有材料→全新空schema→只读库存→当前资源与host再验→明确激活，source历史不变。
3. 独立提供当前source的普通个人安装与升级。恢复激活未通过时明确只读/blocked，不能阻塞正常冷安装的全部验收；不把研究试点当产品前置。

| 角色 | 既有工作区 / 分支 | 本轮整包 |
| --- | --- | --- |
| A | /Users/hh/Desktop/joker/superagent-agent-a · codex/g2-workspaces-verification | [完整验库与上下文审计持久化](agent-a-storage.zh-CN.md) |
| B | /Users/hh/Desktop/joker/superagent-agent-b · codex/g1-runtime | [可集成运行时诊断与持久控制](agent-b-runtime.zh-CN.md) |
| C | /Users/hh/Desktop/joker/superagent-agent-c · codex/g3-assistant-context | [来源闭环与对话上下文投影](agent-c-context.zh-CN.md) |
| D | /Users/hh/Desktop/joker/superagent-agent-d · codex/g3-local-distribution | [操作级资源归属与私有目标、个人安装](agent-d-distribution.zh-CN.md) |
| E | /Users/hh/Desktop/joker/superagent-agent-e · codex/g3-product-acceptance | [当前用户流程与参数化发行独立验收](agent-e-acceptance.zh-CN.md) |
| main | /Users/hh/Desktop/joker/superagent · codex/g2-execution-integration | [实际上下文发送与恢复产品接线](main.zh-CN.md) |

## 提交与连续工作

每人六阶段是一个完整包。先交可运行源码checkpoint，push自己的origin分支，随后连续完成可独立阶段，不在每个修复后等人工下发。需要其他owner时只标记相应消费者NOT_TESTED，发布最小复现/具体接口后继续其他阶段；不得自建替代类型、SQL writer、确认状态机或LLM loop。

main拥有contracts/application/questions/coordinator/console/root lock与共享文档；A唯一storage/workflows/migrations；B execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C context/proposals/knowledge/routing；D launcher/distribution/portability；E仅product-acceptance。root依赖需求交main，别提交临时root lock。

每阶段保留实际命令/exit/source/证据/限制，一份wave10-status即可，不覆盖旧测量。交接必须列branch/base/完整source、拥有路径、接口/导出、下一消费者命令。package PASS、fake integration、current-main HTTP、installed personal、native/value分层；不把schema导出或纯parser当用户闭环。

## 稳定输入和先后

- `packages/contracts/src/assistant-context.ts`：main新发布 `AssistantContextBinding`/`AssistantContextBindings`；A在 `store.workflows.assistant.contextBindings` 暴露同步不可变记录，main负责用户确认和模型消费，C无SQL/HTTP。
- `packages/contracts/src/recovery-target.ts` 与 `apps/coordinator/product/recovery-targets.ts`：D必须直接实现共享port，使用裸hex摘要、准确intent目标及配置摘要。材料只准备文件，main通过A公开Store初始化全新空库后再验库，不要求manifest-only目录假装已有数据库。
- 已有 `VerifiedRunnerInspection`/单一WeakMap、current-binding与完整resource manifest仍是唯一执行屏障。B的新summary不替代它。
- main上下文与证据实际入口见0032；A/C/E可立即复验，不等新模型或目标激活。C针对下一步提供受限adapter与manifest比较，main先消费早期稳定源码。
- D先修资源归属再跑含stop的完整安装矩阵。普通安装构建不依赖M4恢复或E最终verdict；D先给准确tar tuple，E独立验收后才有对应准入。

## 预算与保留对象

本轮自动开发/验收真实模型、native turn0；模型请求只用mock provider/受控fixture。B旧wave03-b-native cap4的UNKNOWN余量不可花，E旧pilot24turn（8作者+16复核）/200000计费token/USD5/单在途账不刷新、不清unknown、不补样本。研究BLOCKED，不重复价格/协议调研，不新增Driver/CAC/桌面壳/自动接受。

保留八组用户5180/8796至5187/8803及其所有state。探针用临时自有端口/目录/进程；不因共用安装路径或PID就认领资源，不pkill、不删旧queue/marker、不改全局runtime或native账号。用户未来手动对话使用不是本轮开发Agent获准做计费回归。

计划静态检查：`node agent-tasks/product-wave-10/verify.mjs`。它不运行产品或模型，不颁发准入。
