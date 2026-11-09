# Agent A：环境准备准入与完整交付

工作目录 `/Users/hh/Desktop/joker/superagent-agent-a`，继续 `codex/g2-workspaces-verification`。保留所有改动，fetch 并合并最新 origin/main，读取 AGENTS.md、本轮 README、原环境任务及本文件。当前主线已包含旧 workspace/console 功能及其准入修复；合并冲突保留已验收的 main 实现与旧提交历史，不重复改产品路径。

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
