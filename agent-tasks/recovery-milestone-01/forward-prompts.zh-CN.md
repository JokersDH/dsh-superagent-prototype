# 当前投入方式更正

旧十份整包不再同时启动。主动开发只有 main/B/H 的原恢复主线和 D/E 的已有固定 W36 验收；A/C/F/G/I/J 按实际阻断参与，没有触发项就待命。原root/branch/owned路径不变，详见 [README](README.zh-CN.md) 和 [目录](workspaces.json)。

下面一段可以转给所有Agent，无需重新生成十套长任务。此文件仅为转发材料，未代发：

```text
本轮调整：增加Agent的目标是加快已有结果，停止新增功能线和独立维护队列。旧任务尚未提交的改动请保留，不需要为了用满资源继续找事做。
main端到端负责同一个未完成Work故障后接管原问题/回答，继续检查、当前候选、人工接受和原2/4槽归还；B提供该实际consumer需要的Runner/控制修复，H独立验证同一个故障消费者。
D/E完成现有固定W36的准确安装结论，不追移动main，不因报告更正重包。
A/C/F/G/I/J按需待命：只有上述原消费者复现具体阻断且涉及你owned模块时才处理；没有阻断不自动执行包里的备用职责。未采用的host/identity/helper缺陷继续禁用并登记，不自动插入主线前置。
已激活事项负责到同一个结果集成/复验完成，不逐fix等重派；没有剩余阻断可以交回待命，不扩新接口/框架/维护任务，也不生成大套新报告。
请fetch/merge最新origin/main后，读 agent-tasks/recovery-milestone-01/README.zh-CN.md 及自己原任务文件顶部的新投入模式。
预算、状态保护与所有权保持：真实模型/native/信号0；研究本阶段不推进；只推原origin分支，不操作十二用户实例或清状态。
```

当前主动分工：

| Agent | 本次负责的结果 | 入口 |
| --- | --- | --- |
| B | main原恢复consumer所需的Runner控制修复，未用工具不抢先扩修 | [B](agent-b.zh-CN.md) |
| H | 同一未完成Work故障前后原ID/问答/交付的独立消费者 | [H](agent-h.zh-CN.md) |
| D | 固定W36来源更正、同包交接并解决E实际阻断 | [D](agent-d.zh-CN.md) |
| E | 固定W36的独立安装结论 | [E](agent-e.zh-CN.md) |

按需职责保留，未触发不执行：[A](agent-a.zh-CN.md)、[C](agent-c.zh-CN.md)、[F](agent-f.zh-CN.md)、[G](agent-g.zh-CN.md)、[I](agent-i.zh-CN.md)、[J](agent-j.zh-CN.md)。main先提供实际故障复现和需要的最小依赖，不把整个恢复目标分摊成十份并行新工程。
