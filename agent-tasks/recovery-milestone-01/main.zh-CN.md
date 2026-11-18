# main：原 Work 恢复的端到端负责人

目录 `/Users/hh/Desktop/joker/superagent`，分支 `codex/g2-execution-integration`。读[共同出口](README.zh-CN.md)、[0095](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)和[本轮续验](../../reports/releases/recovery-milestone-01/admission-2026-11-18.json)continuation。source **e2261ef5** 三受控恢复窗口/原2&4逻辑容量已过，仍负责同run真实恢复出口，不重做旧成果。

1. 保留已交40测试和原同ID不重发边界，B的真实终态endpoint寿命consumer就绪后立即集成。将原Work故障恢复/检查接受与原容量占位/UNKNOWN/后续项前进放进同run，不能把已分别过的虚拟host恢复、fake-driver真实EOF、容量逻辑拼成完整真实物理通过。
2. 保留原current/index/allowAnswer/Broker授权，写前授权fresh；ACK已记录但响应丢失要调和原命令，UNKNOWN绝不重新begin、换ID或自动重发。ended不可恢复成active，权限撤销、旧target、旧lease和错body要在同实际入口拒绝。
3. 同run继续真实registered check、原freeze/currentCandidate/available人工接受到delivered，读取原产物；原2/4容量、第五项等待、unknown占位和完整资源归还从原core/queue/binding证明，不加scheduler或ledger。虚拟资源只能证明逻辑，物理层不足保持未达。
4. 自己负责跨模块修复和最小source集成；仅B/H主动支持，其余按具体阻断激活。D/E固定W36本项已完成待命，不新freeze。未用候选问题保持登记/禁用，不因P1标签插入整链前置。
5. 维护现有40测试；新增仅围绕同run组合/真实endpoint的实际缺口。H独立消费，E在有选定稳定恢复consumer后再按需独立断言。真实模型/native/信号仍0，物理证据不足不跑危险故障或虚报恢复。

每个可运行source检查点显式owned提交并推origin HEAD:main，在现有status记录最小实际结果。source先交后持续同一个出口；只对实际跨owner缺口交最小repro，不新生成大套派工/报告，也不为用满资源造任务。D/E同时完成已有固定W36，不将新源码塞入旧包证明。必要的新运行冻结在选定稳定source后明确交接。

本阶段停止复核价值、第二协议复核与路由收益研究；不改原材料/ledger或历史计分。完整B/CAC后置，预算与十二用户实例保持，所有权沿原表。最终完成按真实原ID/同run故障/原授权/交付/原槽/物理层分别判断，不能以文档数、source ready或正常链PASS代替。
