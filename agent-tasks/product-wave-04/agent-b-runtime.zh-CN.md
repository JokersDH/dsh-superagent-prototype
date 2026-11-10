# Agent B：准确原生控制、可信测试与预算闭环

沿用 B 目录/分支，拥有 Runner、codex-native、driver-kit/testing、native-acceptance。最终输入 `549c57b`；wave03-status 的原生调用为 0，旧 execution-status 仍混有过去 used3。两份事实分别保留，先消除当前入口的记账和判断漏洞，再扩展实测。主线不修改 B 源码。

## B1 先证明矩阵确实能失败

修复并保留反例回归：

- B3 unknown-target 使用合法 `answer_question`+expectedVersion+answer，目标不存在应在业务层拒绝；非法旧字段产生 400 只能证明 parser。
- 重复答案真正重放同一 commandId/载荷，核对同回执且逐 target 只投一次；换 ID 是另一场景，不能两分支都 PASS。
- legal answer 必须产生原 target delivery，记录与 native-applied 分开。零 delivery 不通过。
- stopped-work 要同时看到合法旧答案拒绝、没有额外发送、资源状态准确；不能 `rejected OR phase != working`。
- B4 version1 不能用 max(1,v-1)造“旧版本”；构造真实 v2 或合法不同上下文。接受/拒绝分支不能全绿。
- 缺 closeAdmission、不具备生产 stop port、没等到活动 writer 都是 NOT_TESTED/BLOCKED，不是 PASS。

用故意错误的本地 transport/receipt 变体证明每个断言可失败。单测通过不代替生产 API 用例。先提交该检查点继续 B2–B5。

## B2 原生入口预算和未知发送

把 ledger 接到实际 `--run-native`/create_work 路径，可能发送前原子持久预留 grantId/taskId/commandId/目标实例与剩余次数；重复运行/并发 CLI/崩溃不能多花。未知受理先用同身份查询回执和 work/attempt，再决定继续；禁止换 ID 猜重试。

沿用原 wave03 limit4，保留历史批次 used3 和该 grant 实测 used0 的分账；不是新额度。对账不清先不开模型。反例：两进程同时抢最后一次、发送前后 SIGKILL、未知HTTP、重复参数、日期/phase变更、手工错误候选。ledger 不能记录 key/native session 原文。

## B3 通过生产 Runner 停止与问题链

让测试调用实际 ProcessHost/Runner/产品 stop，不以手工 process.kill 替代被测功能（仅隔离用例 cleanup 可自行清理）。覆盖活动 leader/descendant、忽略 SIGTERM、未知 owner、已关闭 admission、shared session 不杀共享服务。

证据包含真实 attempt/epoch、begin receipt/dispatch、资源清单、进程开始身份和可信屏障；core stopped、取消 ACK、进程退出三者分别展示。新 writer 必须等待原屏障。

问题走完整 question→Broker→answer→原 native binding，覆盖同 RPC ID 不同 attempt、stale/duplicate/stop/reconnect、权限拒绝/过期；字段和 answer 用 shared schema 构建。controlled mock peer 与 actual vendor 分栏。

## B4 崩溃窗口与可恢复诊断

在实际 begin 后、问题已持久后、答案待投/写出后、候选待验证、stop已请求且屏障未齐等窗口 SIGKILL coordinator，用真实 durable receipts/原 child identity 判断“没有第二 begin”；同 assignment ID 只是必要条件。

区分安全停住与可恢复推进：能保持不确定状态不等于可继续工作。需要 main projection 的状态/允许动作提交最小 RFC，先用公开 Runner port 验；不改 coordinator 自己绕开权威。旧事实、旧 writer proof、native session 断联都不能自动当已停止。

## B5 剩余额度内的真实证据与交接

只有 B1/B2 通过后才考虑原 grant 剩余额度，最多安排有明确退出条件的小任务验证真实活动停止、原生问题/审批、恢复和完整交付。先通过配置/协议/受控 peer 证明会触发目标，避免花模型额度反复碰运气；实际没出现目标事件就 NOT_TESTED。一次调用同时取得多个目标不重复计费；unknown 不另开任务。

交兼容矩阵：真实 vendor/controlled process/protocol mock/schema 各列，现有193运行时回归与预算守卫命令、精确版本、已花/未知/剩余账。统一 wave04-status，旧报告引用而不覆盖；修复 B5 commit pending 等状态混淆。全部完成或仅剩明确外部阻断统一交付。
