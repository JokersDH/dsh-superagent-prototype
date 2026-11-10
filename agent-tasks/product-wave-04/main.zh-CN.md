# 主线：解除接口阻断并集成完整个人版

primary checkout；contracts/application/questions/coordinator/console/root lock与共享文档归main。保留用户ARCHITECTURE-NOTES和三组现有服务。下一轮不修改A–E拥有源码来绕开它们的修复任务。

## M1 已交稳定输入

- `packages/contracts/src/assistant-state.ts`：单一来源PersistedDecision/PersistedProposal与同步AssistantStatePort，供A存储/C领域消费；内部端口，不宣称新HTTP功能已实现。
- product入口自动检测restore-report.json或显式--startup-mode recovery_readonly，不启动Effects/native/provider；认证HTTP只读、配置拒绝派工、work动作清空。独立进程回归证明旧execute/assistant/answer队列未消费。没有解除隔离的生产命令。
- 主线独立C/E准入probe与本轮各包，优先发布让外部继续整包。

## M2 项目设置版本产品化

消费A的版本设置/CAS/归档，发布public DTO/命令，接项目界面与preflight。私有路径只用于明确本地设置，key不回显。新设置生成新check/profile/config identity并只作用于新授权；在途Work/合同/环境/check仍冻结，不能用数组更新改写运行中行为。给缺依赖/环境漂移可操作诊断，按已授权步骤重新准备，不重发未知native。

## M3 助手领域和有界上下文

A/C检查点到达后先复跑主线负例，再接record/revoke决定、来源投影、typed proposal确认。异步prepare只读，同步commit与UserCommand/回执/事件/队列一事务；先写后补回执禁止。

复用现有provider的受控结构化输出；模型只产生提案。普通文本不猜执行命令。工作台预览来源/文件/预算与决定范围，明确授权后使用上下文；不把编码授权扩成网关上传许可。不启用自动规则推广。

## M4 生产恢复与发行组合

消费D修复候选，把readonly状态在UI明确呈现；restore marker不能由D自动删除。定义本地重绑定/身份与环境重验后的新授权，而非续用旧native session/receipt/writer证明。恢复和回滚以新目录保留历史为前提。

D的静态server+透明API proxy可继续复用，暂不为合并server重造HTTP；关键是同源认证、实际执行产物闭包和可搬迁性。只在可重复证明后准入D，不因候选已完成就启用pa为默认启动。root lock由main生成。

## M5 整体验收与下一出口

消费B准确的生产控制/预算证据和E修好的独立验收，运行受影响回归，写个人Alpha/内部本机试用各自支持矩阵。发布只覆盖已测范围。第二协议/CAC/App壳后置；可以保留接口调研，不挤占本轮关键闭环。main默认0模型任务，不暗中重置历史预算。
