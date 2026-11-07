# Agent A：WP-02 验收反馈与下一轮修复

被审提交：`8a02f02`。主 Agent 在仓库外干净 checkout 复跑：storage 34/34、effects 8/8、storage typecheck/build 均通过。**这些结果不代表 REL-03 或整个 WP-02 已接受。**

## P1：锁文件尚未写完时可被第二实例抢走

位置：`packages/storage/src/writer-lock.ts` 的 `probe/acquire/createExclusive`。

复现：第一个实例 `openSync(lockPath, 'wx')` 已成功但尚未写 PID/nonce；第二实例看到空文件，将它判成 stale，unlink 后成功 acquire。两个实例都可能认为自己拥有写锁。另有两个 stale 接管者同时 probe→unlink→create 的竞争，可能删除刚被对方取得的新锁。

要求：未知/空/损坏内容不等于死亡证据；先 fail closed。接管本身必须有原子所有权保证，不能仅在 unlink 前多检查一次。优先使用经过验证的 OS 锁或数据库原子 claim/CAS 设计；不能靠 mtime/租约过期推断死亡。

新增测试：初始化空文件窗口、两个并发 stale 接管者、旧持有者 release 不得删除新 nonce 的锁、注册失败的清理。每个竞争窗口必须验证至多一个 owner。

## 同步事务契约

`UnitOfWork.atomic<T>` 的类型可接受 Promise，而当前实现会在 Promise 完成前 RELEASE。请增加明确的同步返回约束及运行时 thenable 拒绝，覆盖 async callback 在 await 后抛错的场景。禁止把已提交的前半段当作回滚成功。

## 接口与归属

正式 core 已在 main 发布；接入公共 `Repositories/Ticket/...`，保留完整 JSON（尤其 completion），不得做 unknown 字段剥离。主 Agent 正在提供结构绑定及原始 core 套件的 SQLite 复验，RFC-01 无需另建 domain-model 包。

runtime_bindings / writer_leases / Work 等新增产品表仍由你统一迁移；主 Agent/Runtime 不会私自补一套生产 schema。

保持 WP-02 拥有路径，修复后在自己的分支提交/push，并给出新增竞争用例和实际结果。其他现有测试保持。不要修改主 Agent 的核心、契约和根 lock。
