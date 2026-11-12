# 单条上下文消息与恢复目标准备检查点

2026-11-11。主实现 `a6a33db84c33d872537dd1e931ba4cbff74552b4`，前端原请求核对修复及最终产品源码 `4140cac15f4ab9c4f5027d96fbee99edb22347be`。A reader按fd206e1接为86c692f，schema16绑定/备份相关源码按A 8a91958中的8e49d67接为869716b。新用户入口：[5188](http://127.0.0.1:5188/)，API8804，独立私有state `.local-state/wave10-context-use-preview`；原八组服务/历史保留，无模型/native回归请求。

## 已经可用的用户流程

项目对话草稿 → 顶栏“上下文预览”选来源 → “预览消息” → 明确“确认发送” → 原流式回复 → 消息旁“上下文来源”。只读“生成预览”保留，默认不自动附加。工作仅作为参考，不变成锚定补充、执行委托或派单。

当前来源是当前工作/合同/验证/接受记录、有效项目决定、项目信息、原会话与已发布交付元数据，不扫描repo正文。项目决定按项目共享，其他会话普通消息/权限展示/其他工作补充不会混入。新实例已复用本机私有模型配置，启动仅读配置/版本，没有发送真实模型请求；原生编码仍是此前独立验收范围。

## 实际HTTP与事务

| 入口 | 语义 |
| --- | --- |
| `POST /v1/assistant/context/prepare` | 仅commandId、单条文本、既有ContextPreviewInput；签名绑定principal、原文本、scope、来源指纹、预算、合同、原会话cutoff和冻结bundle摘要。只读，不建消息或调用模型。 |
| `POST /v1/assistant/context/send` | 仅原commandId/token；发送前重授权、重组并比较原指纹，原聊天消息/command receipt/artifact引用/A绑定同一UoW。 |
| `GET /v1/messages/:id/context` | 从A实际持久化绑定读取该条消息审计，认证/项目/身份检查；历史可读不构成新请求授权。 |
| `POST /v1/recovery/targets/prepare` | 仅activationId/configuration；仅恢复readonly且显式配置可信ports。重读本库source fact与原receipt，拒绝body提供source/actor/启动权。 |
| `GET /v1/recovery/targets/:id` | 只读材料/库存阶段；始终authorization=not_granted、startupAvailable=false。 |

新HTTP DTO独立生成schema/manifest，冻结Runner/data hash仍为`74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。A唯一新增v16 `assistant_context_bindings`；原command/message双identity不可变，同body重放、异body冲突。bundle通过既有ArtifactStore内容寻址保存，快照family和引用覆盖已接入；没有第二个确认状态机或LLM循环。

确认时两次async预检之外都有同进程同步guard，入原聊天事务前最后验当前源。原会话cutoff排除随后追加的本条用户消息和回复，否则会使自己的提交错误失效；新的合法授权或原始来源变化仍拒绝。guard检查事件、scope、当前合同与原始消息/artifact摘要，保守并发冲突可能要求重新预览。

有效期同时收紧到项目、所选工作合同和实际纳入决定的最早期限。独立后端审查发现并修复“决定自然到期无事件时仍能发送”的P2；测试在provider.status阶段推进时钟越界，断言0 provider调用、0 inference reservation和明确notice。

同一原token的成功/确定拒绝结果优先重放，即使期限已过或provider暂不可用也能核对。确定的提交前业务拒绝在原command表保存rejected receipt，没有消息/绑定/执行队列；网络、503、损坏回执等仍保持unknown。未知模型结果依旧由发送前持久request记录阻止自动第二次请求。

UI在fetch前保存准确原命令/token，刷新后只核对原请求；原pending不受新发送能力开关或期限阻断，新发送仍需已配置provider。只有发送全文与原主输入框草稿完全一致才清空草稿。来源正文投影是user角色的untrusted data，不能变成system/tool指令；现有AssistantModelPort及SSE继续负责一次调用与流式展示。

## 恢复准备的实际范围

main `ProductRecoveryTargets`检查真实source fact/原receipt/principal/实际Store路径/期限/配置，文件操作在源事务之外，每个await之后重验。材料与readback必须匹配activation/generation/准确root/intent digest/config digest。仅明确missing_database时用公开ProductStore独占创建新库；已有、未知、部分或残留业务库不迁移、不覆盖、不清理。

初始化器使用O_EXCL创建DB，检查canonical private root及inode，schema16完成后A reader核对完整空库存。中断或结果丢失先报告unknown/blocked；GET可以读回已完成状态，同操作重复不创建第二库。source DB/queue/marker不变，没有启动target进程。

D新材料实现与资源归属probe已7/7通过，实际source为6260a2/fe01c3c，材料源码hash固定`4ea451c9489fc6debc21621857203090ab1ec75b61b532bcab49cb393be38479`。本轮额外用D真实TS模块、main initializer和A reader组合7/7通过，完整目标为schema16/52表；材料初始化后可读，discardStaging拒删已初始化目标。

这仍是跨source生产port组合：D模块从其候选checkout加载，尚未整体复制/准入portability/launcher发行代码；运行时默认不启用target操作。source-current回调在测试里验证真实临时marker/root/config，但没有建立真实机器/profile/物理资源证明。生产回调必须实现真实重验，禁止用noop开放；`inspect()`的eventCursor还包含确认自身事件，实际恢复确认需定义准确baseline，不能简单跳过比较。

因此没有开放恢复commit/activate或改变旧source readonly模式。材料/空表/新generation均不是旧writer停止或启动许可；完整恢复激活、当前安装包和新原生控制仍分别待验。

## 实测与证据

| 范围 | 实际结果 |
| --- | --- |
| contracts / console | 222/222、28/28；生成一致性、构建及coordinator product/http/console类型PASS |
| A已集成owned包 | storage85/85，workflows58/58；按路径准入，不把A候选未接的projection/helper报告算入main |
| 新context与target五组集成 | 95/95，真实SQLite/HTTP/Effects/SSE，provider为mock |
| 既有context/assistant/proposal/evidence回归 | 36/36 |
| 当前网页 | 干净4140cac、真实A production port、9/9、页面错误0、mock3/真实模型0 |
| D/main/A跨source目标消费者 | 干净main a6a33db、D fe01c3c、7/7；真实材料/库/reader，非安装或激活 |
| A旧三反例与空库正对照 | 干净a6a33db，4/4，schema16/52表 |
| 界面独立审查 | 六截图和源码增量ship；provider不可用时核对原pending的限定verdict为resolved |

PNG来自实现阶段的fixture捕获，后续真实A端口与clean source以`--no-capture`复跑，未冒称重拍。唯一一次提交后复跑曾与新预览startup rebuild重叠，Vite文件热更新导致浏览器响应体被导航丢弃；等待构建结束后同source复跑9/9通过，无生产修改或额外视觉回合。构建保留现有单chunk大于500KB警告。

证据与复跑命令见[本轮记录](../../../reports/releases/wave10-integration/README.zh-CN.md)，使用步骤见[指南](../../ASSISTANT-GUIDE.zh-CN.md)。

## 下一消费者

A可消费真实context prepare/send/audit及原provider队列，而非继续登记main缺入口；C替换adapter时需保持conversationThrough、源有效期限和同步guard语义，不引入全registry或第二SQL writer。D可运行跨source消费者，接完整当前source后构建schema16新包，不能用旧schema15 tar当当前产品。E独立验当前消息/SSE/原请求核对，再消费D准确字节；main脚本不是E独立准入的替代。

main继续真实恢复确认/激活和当前source安装集成，B/C新候选按分范围审视；本次不新增派工轮次、预算、Driver/CAC/桌面壳或自动接受。九组服务5180/8796至5188/8804及其所有state均保留。
