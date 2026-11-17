# main：原 Work 恢复的端到端负责人

目录 `/Users/hh/Desktop/joker/superagent`，分支 `codex/g2-execution-integration`。读[共同出口](README.zh-CN.md)、[0095](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)和本轮验收。正常链source `42f6daab`已发布，下一步不是再交一个helper。

1. 固定原Application创建的Work/原question/answer/attempt/contract/session/command ID，沿原Runner登记和callback租约实现故障后接续。先用可控无信号故障窗口定位实际缺口；选择的故障必须发生在同一个原业务run，不能关闭完成的Store后只读重开冒充恢复。
2. 保留原current/index/allowAnswer/Broker授权，写前授权fresh；ACK已记录但响应丢失要调和原命令，UNKNOWN绝不重新begin、换ID或自动重发。ended不可恢复成active，权限撤销、旧target、旧lease和错body要在同实际入口拒绝。
3. 同run继续真实registered check、原freeze/currentCandidate/available人工接受到delivered，读取原产物；原2/4容量、第五项等待、unknown占位和完整资源归还从原core/queue/binding证明，不加scheduler或ledger。虚拟资源只能证明逻辑，物理层不足保持未达。
4. 自己负责跨模块修复和最小source集成；B/I/H交可运行依赖后即接入，不等十枝齐交。A/C补实际持久或来源缺口，F/G/J只维护必需界面/诊断/项目输入；默认create选择的新功能接线推迟到本出口后，避免扩大关键路径。
5. 维护现有正常17+13测试；新增测试围绕原故障窗口而非镜像实现。H独立消费，E独立断言。真实模型/native/信号仍0；无安全物理证据不实施危险故障或虚报原生恢复。

每个可运行source检查点显式owned提交并推origin HEAD:main，状态写 `reports/releases/recovery-milestone-01/status.json`。source先交后持续整个出口；只在实际跨owner缺口发最小RFC，不能再派扩线wave。D/E同时完成已有固定W36，不将新源码塞入旧包证明。必要的新运行冻结在选定稳定source后明确交接。

本阶段停止复核价值、第二协议复核与路由收益研究；不改原材料/ledger或历史计分。完整B/CAC后置，预算与十二用户实例保持，所有权沿原表。最终完成按真实原ID/同run故障/原授权/交付/原槽/物理层分别判断，不能以文档数、source ready或正常链PASS代替。
