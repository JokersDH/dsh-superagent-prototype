# H：同原Work恢复到终态退出的独立完整验收责任包

原目录 `/Users/hh/Desktop/joker/superagent-agent-h`，原分支 `codex/g4-trial-operations`。保留成果后fetch/merge最新origin/main，读AGENTS、共同README及[11-19验收](../../reports/releases/recovery-milestone-01/admission-2026-11-19.json)。当前main **6d309128**，本轮H **83deec02**。

**主动，一个同run结果持续做到最后复验，不扩功能或矩阵平台。** 受控同run恢复/2&4/queued Work已经通过；当前只复验主线postcommit finalize、确认ID调和与UNKNOWN现场保留，真实Runner/vendor物理单独分层。

先修原consumer自阻：successor禁止再次spawn原target正确，但必须允许original.nextWorkId首次spawn；累计Runner应capacity+1。主线自有组合consumer已用这个限制完成2/4同run，生产容量源码无须修改。同步修原报告gap和assert：nextWorkProgressed必须真的为true，不能旧失败当成功、也不要求ended复活。参照main新combined-original-recovery及fixture实现，别再自建调度。

每份检查/接受按原ticket+assignment+candidateGeneration匹配，产物按那个Work的view.artifactIds；原receiver核command ID/body/attempt/contract和begin1/answer1。UNKNOWN填充Work保留占位/原状态/注册材料，其他Work的证明不能释放它；取得它自己的完整新证明后允许合法释放。不要继续读全ticket第一行或删UNKNOWN root完成测试。

B postcommit生命周期已进入主线；独立围绕[0095约定](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)复验确认前/后故障窗口：proof/cancel响应丢失或main提交前再次退出仍可恢复；原屏障持久提交后finalize前退出从原receipt继任；有效finalize响应丢失不重做业务；UNKNOWN/foreign/wrong subject不关endpoint。修正combined consumer的UNKNOWN凭据/根清理和精确receiver/candidate断言，持续到这个同run结果闭合，不需要每个修复再派工。

只在H原tools/trial-kit/tests/operational-soak交独立consumer/精确source和原始事实，不改main/B/I生产或E断言、不新增持久指标。真实模型/native/信号0，无global discovery/unsafe kill/绕拒绝清理；纯/受控Node进程自行退出可用，未知现场保留。其他八位待命，不自行扩UX/安装/研究；完成本结果无剩余阻断即可交回。
