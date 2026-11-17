# main：原 Work 恢复的端到端负责人

目录 `/Users/hh/Desktop/joker/superagent`，分支 `codex/g2-execution-integration`。读[共同出口](README.zh-CN.md)、[0095](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)和本轮验收。正常链source `42f6daab`已发布，下一步不是再交一个helper。

1. 先闭合已定位的原启动缺口：ProductExecution.start当前把活动native绑定改stopping，reconcileRegisteredRunner只核对/取消且businessResumed:false；新进程的attempts映射没有原业务连接。用同一个原Application创建的Work在未完成时重开，复现原问题无法继续，再实现经原授权核验的业务接管；不能简单恢复active或改原物理核对函数来假装接管成功。保留原question/answer/attempt/contract/session/command ID，不重发begin。
2. 保留原current/index/allowAnswer/Broker授权，写前授权fresh；ACK已记录但响应丢失要调和原命令，UNKNOWN绝不重新begin、换ID或自动重发。ended不可恢复成active，权限撤销、旧target、旧lease和错body要在同实际入口拒绝。
3. 同run继续真实registered check、原freeze/currentCandidate/available人工接受到delivered，读取原产物；原2/4容量、第五项等待、unknown占位和完整资源归还从原core/queue/binding证明，不加scheduler或ledger。虚拟资源只能证明逻辑，物理层不足保持未达。
4. 自己负责跨模块修复和最小source集成；B/H主动支持，I/A/C/F/G/J只有原consumer实际出现阻断时才按需激活，不给独立维护队列。默认未采用的候选问题保持禁用并登记，不因其P1标签就插入当前路径。D/E独立完成固定包，不等十枝齐交。
5. 维护现有正常17+13测试；新增测试围绕原故障窗口而非镜像实现。H独立消费，E独立断言。真实模型/native/信号仍0；无安全物理证据不实施危险故障或虚报原生恢复。

每个可运行source检查点显式owned提交并推origin HEAD:main，在现有status记录最小实际结果。source先交后持续同一个出口；只对实际跨owner缺口交最小repro，不新生成大套派工/报告，也不为用满资源造任务。D/E同时完成已有固定W36，不将新源码塞入旧包证明。必要的新运行冻结在选定稳定source后明确交接。

本阶段停止复核价值、第二协议复核与路由收益研究；不改原材料/ledger或历史计分。完整B/CAC后置，预算与十二用户实例保持，所有权沿原表。最终完成按真实原ID/同run故障/原授权/交付/原槽/物理层分别判断，不能以文档数、source ready或正常链PASS代替。
