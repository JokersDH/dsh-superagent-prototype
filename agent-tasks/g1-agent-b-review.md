# Agent B：WP-03 首批验收反馈与下一轮修复

被审提交：`b4111ed`。主 Agent 在干净 checkout / Node 24.22.2 复跑 63/63。**整体 WP-03 与执行器启用暂不接受**，以下边界未被原测试覆盖。

## 必须修复的实际复现

1. `supervisor.ts command()` 没有 contract，却强转 RunnerCommand；真实生成的 begin 无法通过冻结 RunnerCommandSchema。请移除掩盖字段缺失的 cast，所有命令用同一冻结 schema 校验完整 tuple。
2. `fence()` 接受错误 assignmentId；也未核对 contract。主 Agent 已复现 same attempt/epoch + wrong assignment 返回 accepted。完整 ticket/assignment/attempt/epoch/contract 必须一致。
3. `stop()` 无 attempt handle 时写 ended 并返回 indeterminate；第二次 stop 又返回 confirmed，start 随后可跳过旧 writer 屏障。未知必须持续 stopping/indeterminate，直到实际证据出现；不得从缺句柄或缺 binding 推断历史资源已停。
4. `start` 的 begin.inputRef 使用 policySnapshotRef，无法表达真正初始 ExecutionInput。增加正确初始输入引用，并核对 StartInput 外层 tuple 与 spec 相同。
5. deliver/answer 的 command.id 只由 attemptId+kind 构成，不同业务输入会共用 ID。ID 应绑定稳定业务输入/答案/原生 binding；同 ID 必须同 payload，重试保持同一逻辑 key。

## 物理停止

`ProcessHost.stopOwned` 当前以主进程 exit 作为整个 process group 的 quiescence，且 handle.exited 时直接 confirmed。请增加父进程退出但同组子工具忽略 SIGTERM 的测试，未证实组/登记 writer 全部静止时保持 indeterminate，必要时对已证明归属的剩余资源升级停止。只看 parent exit 不够。

注释称缺 start marker 会拒绝信号，但代码只处理“两者都存在且不同”，缺 marker 会继续 kill。请使实现/证据一致，身份不能确认时 fail closed，测试 missing/null marker 而非仅 mismatch。

## RFC 结论

RFC-0001 无需修改冻结 ports：critical payload 必须存现有 `{kind,value}` RuntimeFactPayload，authoritative ingress 无条件严格解析并核对 fact.kind；没有信封不能放行。相同 factId 是不可变事实，payloadRef/内容变化应冲突；payload 使用不可变/内容寻址引用，不引入替换 generation。

RFC-0002 的单事务要求接受；权威入口属于组合根的 runtime/core/storage bridge，不是让纯领域内核持有 runtime 表。core 裁决 Assignment，bridge 在同一连接/事务裁决完整 binding/epoch、收据、载荷与 core mutation。Supervisor 本地预检仅诊断，不得覆盖它；停止后的物理观察仍需保存。待存储 owner 提供生产 binding/lease 表后接线。

保持 WP-03 归属路径，新增上述负例并保留原 63 项，push 后报告证据。暂不接真实厂商 Driver，不把内存 receipt 当真实 durable ACK。细节见主 Agent 的 `docs/adr/core/g1-rfc-resolutions.md`。
