# Agent A：环境准备准入与完整交付

**当前优先级（2026-11-10）：按 [收尾批次 A-R1–A-R4](release-closure.zh-CN.md) 连续执行。** 先关闭三项新失败、交可消费检查点，再完成单包恢复/消费/集成回归；已有 workspace 增量保留，暂缓扩大支持形态。以下仍为细节参考。

工作目录 `/Users/hh/Desktop/joker/superagent-agent-a`，继续 `codex/g2-workspaces-verification`。保留所有改动，fetch 并合并最新 origin/main，读取 AGENTS.md、本轮 README、原环境任务及本文件。当前主线已包含旧 workspace/console 功能及其准入修复；合并冲突保留已验收的 main 实现与旧提交历史，不重复改产品路径。

**持续执行：** 同时读取 [扩展队列](extended-run.zh-CN.md)。下文原三个阶段对应 A1–A3；通过后提交检查点，继续 A4–A6，不在原“最终验收”后停止。依然只拥有本包。

**最新准入：** `b6dd261` 尚未通过。先读 [扩展复核](../../docs/rfcs/WP-16/0011-extended-checkpoint-review.md)，修复新增三项 blocked cleanup 伪造归属、进程观察未知和合并输出预算；保留已做的 A4–A6。复验脚本已扩展为八项，可用 `--candidate <commit>` 检查不可变快照。

## 出口与归属

将 `packages/environment-preparation/` 从包内可运行实现交付为主线可以安全接入的深模块：授权输入 → 受控准备 → 可信 ready 凭证 → 复验 → 仅清理本模块拥有的资源。

只改本包的源码、manifest、测试、fixtures、README、RFC 和证据。workspaces、verification、application、coordinator、console、Runner、contracts、产品迁移及 root lock 由主线处理。新增轻量依赖可写包内 manifest，锁请求汇总给主线；不得手写 YAML/semver/lock resolver。

## 第一阶段：关闭主线复现

主线命令（可用 primary checkout 的脚本只读检查你的源码）：

```sh
node /Users/hh/Desktop/joker/superagent/tools/bootstrap/review-environment-preparation.mjs --environment "$PWD"
```

基于 `f1d4b1f` 的实际发现，逐项变为回归并修复，不改变不变量：

1. `ENV-CLEANUP-PRESERVES-UNOWNED-PATH`：dependency-free existing_only 返回 ready 后 cleanup 删除了预先存在且无本模块归属的 `.product-environment/user-note.txt`。陌生/跟踪文件冲突应阻断或保留，绝不能删除。
2. `ENV-REJECTS-NESTED-DEPENDENCY-ESCAPE`：依赖根在 workspace 内，但依赖入口文件符号链接指向外部，仍 ready。需要检查实际依赖树里的嵌套逃逸、循环和失效链接，不能只检查包根。
3. `ENV-INSTALLED-VERSION-DRIFT-NOT-REUSED`：声明/lock 为 1.0.0，已安装包改为 9.0.0，仍 ready 且 fingerprint 相同。绑定实际解析环境，发生漂移必须阻断或重新准备。
4. `ENV-OFFLINE-INSTALL-DOES-NOT-EXECUTE-PNPMFILE`：真实 pnpm 的 `--offline --ignore-scripts` 仍运行项目 `.pnpmfile.cjs`，在 workspace 外的本次私有目录写入了 marker；最后 blocked/lock_mismatch 也没有撤销这次执行。安装前隔离/禁用项目钩子及会改变输出路径/执行代码的配置。只在安装后检测不够。
5. `ENV-VALID-NODE-ENGINE-OR-RANGE`：常见 `^22.19.0 || >=24.0.0` 在 Node 24 被误判不满足。采用经过验证的 semver 语义；同样覆盖 packageManager 校验和后缀、坏 JSON/字段类型、单包配置与真正 monorepo 的区分。

复现全部只用私有临时文件和本地离线 tarball，不涉及用户项目/账号/模型。保留原 12 项通过范围，并补足真实 Git worktree/index 情形。

## 第二阶段：稳定接口检查点

修复后先提交本包 API 检查点，再继续下面的完整验证，不停工等待。保留 `prepareEnvironment` 的主要调用形态；如需版本化改进，在 README 明确兼容。

- ready 应含可序列化的 `environmentRef`/receipt、fingerprint、受控环境变量、真正拥有的路径与证据，支持协调器重开后验证。
- 提供 `verifyPreparedEnvironment(ref, ...)` 与可信清理入口，或等价 API。主线在 Native 前、验证前后和接受前复验；环境被 worker 改写后不能继续引用旧 ready。
- 归属凭证保存在调用方授权、位于 project/workspace 之外的私有 authorityRoot，或采用同等强度的调用方持有凭证。worker 可写的 marker 不是删除/复用权限来源。旧 v1 marker 不应直接升级成可信权限。
- 提供可注入的进程运行 port：argv、cwd、白名单 env、AbortSignal、time/output/disk bounds → 输出与明确 quiescence。默认 standalone 实现也需安全。主线可用同一 independent Runner/OwnedProcessHost 执行安装，不在产品中再藏一个无法登记的写进程。
- 不新增 Work/Ticket 生命周期，不持有产品 SQLite writer，不复制公共 wire schema。提前在包内 RFC 汇总接口缺口，主线实现 workspace exclusion/Runner adapter。

## 第三阶段：资源与复验整包

1. `.npmrc`、`.pnpmfile.cjs`、包内 pnpm 配置、外部 hooks 或输入元数据若不支持，必须在执行前明确 blocked；不读取/复制账号、.env 或用户全局配置。不能通过扩大联网或运行安装脚本解决。
2. 清理只针对凭证绑定、身份仍匹配的路径。替换/伪造 marker、预置目录、跟踪源码、同名 symlink 不获得清理权限。证明不完整返回 cleanup_unproven。
3. 并发同 workspace/request、旧 preparing 凭证、上次安装进程仍可能存活时不得清理重开第二个写入者。进程观察错误不等于进程不存在；仅 ESRCH 等明确证据可确认。
4. 取消覆盖 manager probe、安装和扫描阶段；时间/合并输出预算明确，磁盘预算在准备过程中受监控而非仅结束后检查。限额无法强保证的地方准确说明监控边界。
5. 实际依赖、lock、Node/manager 版本、策略和必要设置绑定指纹；同 key 同输入幂等，内容改变不复用旧环境。Native 改 package/lock 后要明确要求重新准备。
6. 环境排除只提供本模块真正拥有的路径。tracked 源码/陌生目录冲突不能静默从业务 patch 消失；不改用户 ignore/Git 配置。主线负责真实 WorkspaceManager 接线，本包用相同 port 的真实 Git fixture 验证并标注尚未产品集成。

## 最终验收与交付

原测试、主线五项复现、nested links/ownership forgery、并发/旧进程/取消、坏元数据、真实 pnpm 离线准备与测试均有明确 PASS/FAIL；原项目/index/lock/依赖摘要保持。准备产物可复验，未证实清理不准 ready，环境路径不进业务 patch。

不运行模型、不联网准备、不升级全局运行时。交 branch/commit/base、owned paths、命令/证据、接口消费样例、依赖请求和剩余限制，push 自己分支。主线未接入的部分保持 NOT_TESTED。完成整个包再统一报告。

## A4 / P1：只读预检与易用性

交付可供主线 UI/doctor 消费的 `inspectEnvironment` 或同等只读 API。复用已有解析/检查逻辑；检查不能创建 `.product-environment`、安装依赖、修改 Git/index、触发项目钩子或隐式读取用户配置。

- 输出项目形态、声明/实际 Node 与 manager、lock 摘要、依赖是否已有/可复验、离线缓存授权是否足够，以及支持能力。预检可准备不等于实际 ready；缓存判断无法证明时输出 unknown，不能运行安装来“探测”。
- 稳定 code 配合面向用户的中文说明和结构化建议：缓存未授权/缺包、lock 不一致、版本不支持、钩子配置、依赖逃逸、环境漂移、清理不确定。建议是数据，不是模块自动执行 shell 或联网的授权。
- 把原始 stderr、绝对本机路径与可公开诊断分开；受限 evidence 可保存摘要，公共输出不含环境变量值、.npmrc 凭据或账号路径。没有证据不报“安全”。
- 提供包内命令入口或消费样例，默认只 inspect。prepare/cleanup 必须显式动作和可信输入；不要新增全局 CLI、根 scripts 或私有产品 HTTP。

验收：带依赖/无依赖/坏 JSON/错误 lock/缺缓存/不支持形态均有真实 fixture，inspect 前后原项目与 workspace 内容/index 摘要相同，未启动 installer，输出经包内 runtime parser 验证。

## A5 / P1：集成样例、恢复与规模测量

1. 交付两个可重建的离线项目 recipe：普通 JS/pnpm 单包、包含开发依赖和实际测试构建的单包。复用 pnpm 自身 lock/install，依赖来自私有本地 tarball；不提交 node_modules/store。B 可通过说明重建，不要求从测试 helper 偷用内部权限。
2. 包内 consumer 示例从调用方生成 authorityRoot，经注入 process port 准备，序列化 ref；第二个真实 Node 进程重新加载并 verify/inspect，最后按可信归属清理。返回值、失败和取消都能被普通调用方消费，不依赖进程内闭包或私有全局 Map。
3. 覆盖 prepare 进程中断、准备完成但调用方未记录、持久凭证损坏、旧凭证重放、同 workspace 不同 request、清理后重建和工作区被替换。unknown 留证据，不偷删后重装。只在自己 fixture 上发信号，确认 PID/进程组归属。
4. 测量首次准备、同输入复验、依赖树扫描和清理的 wall time/文件数/字节；给出一个小型与一个千级文件树的合成负载，不凭空规定性能 PASS 数字。只针对实测瓶颈优化，fingerprint 不能用 mtime/marker 存在替代内容证明；给取消和扫描设置有界工作量。
5. 提供公开接口的消费测试和兼容说明，把新依赖/类型导出/错误 code 一次汇总给主线。缓存仍是显式授权的离线 store，不新增共享缓存写服务或自动垃圾回收用户目录。

验收证据分开写 package-local、independent consumer 和尚未 product-integrated；主线真实接线到达后，使用公开接口复验一遍受影响路径，不重做无关矩阵。

## A6 / P2：受限 pnpm workspace 增量

仅在 A1–A5 稳定、检查点已提交后开始，不让新功能阻塞单包交付。新增显式 opt-in 能力：一个 Git 根、一个 pnpm lock、两个工作包，`packages/app` 通过 `workspace:*` 引用 `packages/lib`，无外部 file/link、项目钩子或生命周期安装脚本。用标准 YAML parser 和 pnpm 命令完成解析/解析依赖，不自建 resolver。

工作包必须真实位于同一 workspace 边界内；忽略/危险路径、逃逸 symlink、坏 glob、锁与包不一致均在执行前拒绝。准备和复验覆盖根及所有实际工作包的 manifests/依赖，所有环境目录排除仍绑定可信归属；workspace package 的业务源码绝不能被当成依赖目录排除。

用本地 tarball/store 实际离线安装，从 app 执行测试并调用 lib；两包业务改动都应进入完整 patch，依赖不进入，原 Git/index/源码保持。未支持的 monorepo/peer/catalog 形态给稳定 blocked，不扩大到任意 monorepo。

若本阶段需要未就绪主线接口，交包内实现/真实 Git fixture 与 RFC，主线产品 lane 保持 NOT_TESTED；不要转改 workspaces/console/公共 schema。最终汇总 A1–A6 的执行状态与下一消费者步骤。
