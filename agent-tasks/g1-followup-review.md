# G1 修复后的补充验收任务

审查输入：A `0ad49af/fc7eb8f`（主线已包含），B `d213d94`。B 的 85 项测试在独立 checkout / Node 24.22.2 全部通过。主 Agent 新增的事实入口通过 17 项确定性与 7 项真实 SQLite 测试。**这些通过不消除下面新复现的边界问题。**

复现命令（先构建 storage）及结构化结果：

```sh
node tools/bootstrap/review-g1-followup.mjs --storage /absolute/storage-checkout --runtime /absolute/runtime-checkout --record
```

`reports/releases/g1-review-followup.json` 中 5 条目前均 FAIL；修复时保留原有通过测试。

## Agent A：异步 callback 在 await 之后仍会写库

`atomic(async () => { await Promise.resolve(); INSERT... })` 当前同步抛错，但 async 函数已经启动，await 后的 INSERT 在回滚后自动提交。复现得到 `rowsWrittenAfterRollback=1`。请在调用 native AsyncFunction **之前**拒绝（包括 bound async），再保留 thenable 返回的回滚防御。普通函数把异步工作藏在闭包中仍是禁止用法，要明确文档；不能宣称回滚能取消已运行的异步 continuation。

同时核对 `SAVEPOINT` 本身抛错时 depth/callback 栈是否被清理；该路径在 try 之外时可能留下错误 nesting。请以实际故障用例确认。

## Agent B：命令身份仍有确定性碰撞

- `answer(binding='a:b', answer='c')` 与 `answer(binding='a', answer='b:c')` 都得到 `cmd-attempt-1-1-answer:a:b:c`。
- 相同 inputRef、不同 expectedTurnRef 的 deliver 也共用 commandId，但 payload 不同。

请对结构化完整逻辑命令（含 binding tuple、kind、实际 payload）使用已有 Node SHA-256/稳定编码；不要拼接未转义分隔符，也不要用短 FNV32 声称唯一。相同逻辑重试应保持同 ID，任意会改变实际发送语义的字段改变须新 ID。

## Agent B：已结束 epoch 重用与 launch 中取消

- binding 已 ended 时，`start` 跳过 epoch 检查，可以再次使用同 attemptId/epoch 启动。请保持历史 epoch 单调并拒绝 attemptId 重用，而不是仅检查 active binding。
- `launch()` Promise 未完成时 stop 返回 stopping/unknown；之后 launch resolve 仍会 feed begin，复现 `beginSentAfterStop=true`。请在 await 后重核授权/当前绑定，并将返回句柄用于清理，不得发送 begin。用可控 Deferred Runner 的测试覆盖 start/stop/new epoch 交错。

## Agent B：停止等待与观察失败

独立复验还出现：父进程退出后，stop 的轮询 timer 被 unref，调用方只有顶层 await 时 Node 提前退出（exit 13）；同组后代遗留。主 Agent 已清理本次测试拥有的进程，并给复现脚本增加自身寿命保护。实际 stop Promise 的完成不应依赖一个恰好存在的其他事件句柄。

`#liveMembers` 不得将所有 ps 异常都当空组；工具缺失、权限/解析错误必须 unknown/indeterminate。请区分经验证的“无成员”与“无法观察”，并测试。生产接线前还要遵守已发布 RuntimeIngressStore：Supervisor 本地预检不能丢掉旧绑定的物理观察/已持久的重复回执。

## 本轮可以接入的主线能力

`apps/coordinator/runtime-ingress.ts`、ADR 0004 和 WP-01 的 runtime-ingress-store RFC 已推主线。无需修改冻结 contracts；A 提供生产 binding/history/resource/immutable payload 存储，B 消费可信 bound sink，主 Agent 负责组合与跨模块测试。新生产表仍只有 A 分配迁移号。
