# main：原 Work 恢复的端到端负责人

目录 `/Users/hh/Desktop/joker/superagent`，分支 `codex/g2-execution-integration`。读[共同出口](README.zh-CN.md)、[0095 postcommit约定](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)和[11-19验收](../../reports/releases/recovery-milestone-01/admission-2026-11-19.json)。source **bde57d42** 已接B postcommit finalize并通过受控回归；继续负责同ID响应调和、H UNKNOWN清理和真实层限制，不重做旧成果。

1. 持续负责同一个真实Runner生命周期到实际采用/独立验收：B最小postcommit-finalize源码就绪后，main在原confirmOwnedQuiescence提交后核原receipt/event/ended绑定，才通过原认证连接确认清退；读proof/普通cancel不触发清退，禁止50ms替commit。缺确认/UNKNOWN/错subject保持原端点和材料。
2. 保留原current/index/allowAnswer/Broker授权，写前授权fresh；ACK已记录但响应丢失要调和原命令，UNKNOWN绝不重新begin、换ID或自动重发。ended不可恢复成active，权限撤销、旧target、旧lease和错body要在同实际入口拒绝。
3. 在原Work/Store消费者组合确认前丢响应或再次owner退出、提交后finalize前退出、合法finalize丢响应调和，以及原检查/人工接受/同槽归还；复用已过的2/4同run，不加scheduler/ledger/公共用户命令。42测试保持；真实OS受控Runner和vendor/native物理分别验，证据不足不虚报。
4. 自己负责跨模块修复和最小source集成；仅B/H主动支持，其余按具体阻断激活。D/E固定W36本项已完成待命，不新freeze。未用候选问题保持登记/禁用，不因P1标签插入整链前置。
5. 生产wire保持冻结Bridge v1/hash；若需私有transport的可选兼容扩展，按0095最小约定而非新平台。H独立消费，E只在有选定稳定恢复consumer后按需断言。预算/十二实例保持，不逐fix重派、不等待十枝齐交。

每个可运行source检查点显式owned提交并推origin HEAD:main，在现有status记录最小实际结果。source先交后持续同一个出口；只对实际跨owner缺口交最小repro，不新生成大套派工/报告，也不为用满资源造任务。D/E同时完成已有固定W36，不将新源码塞入旧包证明。必要的新运行冻结在选定稳定source后明确交接。

本阶段停止复核价值、第二协议复核与路由收益研究；不改原材料/ledger或历史计分。完整B/CAC后置，预算与十二用户实例保持，所有权沿原表。最终完成按真实原ID/同run故障/原授权/交付/原槽/物理层分别判断，不能以文档数、source ready或正常链PASS代替。
