# Agent D：每人本机发行、完整备份与迁移

工作目录 `/Users/hh/Desktop/joker/superagent-agent-d`，分支 `codex/g3-local-distribution`，由主线从派工后的最新 `origin/main` 创建。本轮正式拥有 `apps/launcher/`、`tools/distribution/`、`packages/portability/` 及其自有 tests/fixtures/docs/reports。目录就绪后开工，不自行在他人工作区或另一个嵌套 Git 仓库实现。审计基线 `c3f018e`，读取 AGENTS、START-HERE、product-spec/README 和本轮 README。

优先支持内部人员 **各自在本机运行网页+daemon，并使用各自项目/模型配置/native 认证**。发行/迁移可以并行准备，内部试用准入在新 UI 和关键功能之后；不是把当前单用户 loopback 服务改成共享 LAN 多人平台。主线拥有 root 配置/锁与 API 主入口，A 唯一拥有生产迁移；你复用公开 storage/backup port，不另建 writer。原生模型和外部模型请求预算 0。

## D1 发行/状态布局与消费检查点

审计当前 Node/pnpm/原生 SQLite ABI、Vite、TS 源码启动、临时 socket、私有 config、worktrees、产物和凭证。交一份最小 RFC：构建产物布局、平台支持矩阵、state/config/workspace 根、first-run 和备份范围，以及 main/A 必需 port。

不要承诺所有平台现成可用。先以当前已测 macOS arm64 交候选，Linux/其它架构只能在真实环境验证后升级状态；未测时准确 blocked/NOT_TESTED。先交检查点与零模型安装 smoke fixture，再继续 D2–D5。

## D2 静态网页+daemon 与 first-run

复用已有前端 build 和 coordinator 组合入口，产出普通同事可启动的本机包：运行时不依赖 Vite dev server 或每次构建全仓。不要自建产品 HTTP 主入口；必要启动/config interface 交 main RFC，由主线接入。

首次运行收集明确的本地路径/模型设置和执行器状态，不读取/复制他人账号，不强制升级全局 Node/agent。缺 Node/ABI/版本/认证/端口时给稳定可操作诊断。配置和状态在 checkout 之外、可重定位且私有；密钥不进入只读浏览器响应、URL、日志或发行 archive。显式的模型设置输入只能经已认证本机入口提交，保存后不回显，也不写前端持久存储。

启动、复用、停止、doctor、干净退出支持实际选定的 state；按真实进程身份操作，不结束同名/陌生 PID。桌面壳只留薄 launcher 接口，业务不依赖 Electron/Tauri API。

## D3 完整备份格式和一致性

通过 A 的一致快照与 artifact/reference 清单 port，定义版本化 bundle：数据库快照、引用产物/证据、必要配置的清单/摘要、路径映射与兼容元数据。仅 SQLite 文件可打开不算完整备份。是否带项目/worktree 内容必须明确选择，默认不隐式打包用户全部仓库。

账号 home、模型 key/native 认证、native session 原文、运行 socket/PID、缓存/node_modules 默认不携带；本机 credential/authority 的保留或重建规则须 RFC 明确，不能复制旧权限后冒称新机器可继续执行。备份与恢复过程不发送模型或业务命令。

验收：引用产物完整、缺失/损坏/版本不匹配/IO 中断可发现，快照期间有写入的一致性经 A port 证明；日志和 bundle manifest 不泄漏凭据。

## D4 新目录/新账户迁移与回滚

恢复到新私有目录，先验证格式、摘要、路径和版本，再用 main/A 提供的恢复模式接线；不覆盖活跃 state，不自动 replay begin/deliver/answer。活动/未知 writer 需要明确受阻或经可信核对，不因旧 PID、inode、socket 或签名仍在 archive 里就标 ready。

路径重映射保留历史 artifact/source identity；新机器原生版本/认证/policy 重新探测。旧 workspace 环境 ref 失效或需重新准备，不伪造原生 session 续跑。升级保留可验证旧快照，迁移失败回到可启动状态；生产 SQL 仅由 A 追加，不自己改库补行。

使用结构化 archive/manifest API，防路径穿越、绝对路径注入、危险链接、超额文件/解压炸弹和覆盖。真实跨账户/平台条件不足时用新目录 fixture 标明范围，不能声称已测跨机器。

## D5 内部试用包和独立消费

交构建命令、发行清单、first-run、启停/诊断、backup/export/import/restore/rollback 的真实入口和可重复零模型 smoke。E 在新目录/新账户独立验证，main 在 UI/P0 稳定后决定试用准入；你不修改 E 的断言或产品应用来使结果变绿。

维护自有 `reports/execution-status.json`，记录 branch/commit/base、平台/ABI/依赖、实际命令与未测条件、main/A 消费步骤。包内依赖请求交主线生成 root lock，只 push 自己分支。

遇阻备用工作：主线生产入口未到先做 build/bundle/first-run 解析和诊断 fixture；A snapshot 未到先做同一 port 的 bundle 负例与路径恢复规则；UI 未完成先交发行工具但不标内部试用通过。全部可执行阶段完成或只剩明确外部阻断时收尾，不为持续运行做无限安装/探测。
