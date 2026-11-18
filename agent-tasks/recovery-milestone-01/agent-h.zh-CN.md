# H：故障接管、交付与原2/4容量的同run独立验收

原目录 `/Users/hh/Desktop/joker/superagent-agent-h`，原分支 `codex/g4-trial-operations`。保留成果后fetch/merge origin/main，读AGENTS、共同README与[本轮续验](../../reports/releases/recovery-milestone-01/admission-2026-11-18.json)。main **e2261ef5**，本轮H59133df7已验收。

**主动，一个完整结果：同一个原Work在有并行占位时故障接管→检查/人工接受→其原槽归还，后续原Work前进。** 现有单Work正例/正常close反例已过，不重复铺正常矩阵。

1. 独立消费main新增8模式（原问题/写后resolution延迟/已ACKterminal三正向与五拒绝），核原HTTP command receipt、native_applied和实际receiver begin/answer次数；恢复时同ID只读回，不重发。已ACKterminal必须原observation/payload/fact receipt与当前完整资源proof一起成立，不能只用terminated字符串。
2. 在原ProductRuntime的Node组合参数maxActiveAttempts=2/4下，用原Store/Application/core/Effects创建并行Work；参照新original-capacity消费者，但把owner退出、同原Work交付和第3/5项前进组合在同run。UNKNOWN/stopping原binding保留占位，另一Work的证明不释放它；取得自身新完整证明后允许合法释放，不能把UNKNOWN当永久锁。
3. 每份检查/接受/产物必须绑定那个Work的当前candidate/原assignment，按view.artifactIds读取；不读全库最后N或仅ticket最新行。原begin接收次数用receiver原command/body，不能以turn/start计数代替。old/foreign/缺proof/迟到不能影响其他槽；缺产品行为给main最小repro，不改原表或创建scheduler。
4. B真实terminal endpoint consumer就绪后，同实际source复验其原端点/退出事实。现阶段虚拟native资源、真实Runner fake-driver与完整真实原生物理分层，不把两个独立PASS拼成同run结论。

仅H原tools/trial-kit/tests/operational-soak范围交独立consumer/原事实，E断言及main/B/I生产仍原owner。source早交后持续同一组合结果复验；更新原报告中准确subject即可，不再复制全轮次状态。真实模型/native/信号0；UNKNOWN保留材料、不绕产品拒绝清理，十二用户实例不操作。其他八位继续按需待命，不扩新功能、长soak或打包。
