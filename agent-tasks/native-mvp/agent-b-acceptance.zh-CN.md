# 外部 Agent B：真实 MVP 独立验收与故障恢复

工作目录 `/Users/hh/Desktop/joker/superagent-agent-b`；继续 `codex/g1-runtime`。保留原改动、fetch origin，合并最新 main。读取 AGENTS.md、本文件、product-spec/README.md 与 07-implementation-and-acceptance。主线当前未发布的任务文件可只读 `/Users/hh/Desktop/joker/superagent/agent-tasks/native-mvp/`；不要改 primary checkout。

## 目标与归属

用实际产品边界独立验证 native MVP。只拥有 `tests/native-acceptance/` 下的测试工具、fixtures、证据和报告，不改 runner/driver/core/HTTP/console/公共 schema/root lock，不通过降低预期来修产品。主线及其内部子任务正在集成这些代码；发现问题给出最小复现和归属即可。

## 稳定边界

工作台默认 `http://127.0.0.1:5180`，API `8796`。测试参数化 URL/私有 state，优先启动独立临时实例和独立会话；不污染 conv-main 或用户项目。

- `GET /v1/configuration`：以实际发布的 projects、profiles、默认 checks/scope 构造委托，不能硬编码成 fixture 作为 native 通过。
- `POST /v1/projects`：`{path,displayName?,check:'node_test'|'pnpm_test'|'npm_test'}`，返回配置；只选显式创建且已有提交的临时 Git 根目录。
- `POST /v1/commands`：沿用共享 UserCommand；create_work、answer_question、stop_work、revise_work、accept_candidate。后端构造 actor，浏览器不传 TrustedActor。
- snapshot/SSE、verification、artifact 已有接口；`GET /v1/works/:id/location` 返回 `{projectPath,workspacePath,baseCommit}`。
- 原生 profile 为 `profile-codex-native`，当前本机 Codex 0.164.0；主对话 DeepSeek 与执行器认证分开。native 不可用时保持 NOT_TESTED，禁止静默退回 fixture。

## 整包步骤

1. 提交一个不用模型也能运行的 harness/案例目录检查点，再继续真实及故障矩阵。用官方 Playwright/现有 HTTP 与 schema，不自建状态机。
2. 正常链路：导入私有真实项目，输入需求，显式确认委托，实际 Codex 修改隔离 worktree，注册检查 PASS，预览完整 patch，接受当前候选，刷新/重开保留。确认原项目内容/index/HEAD 未变。
3. 恢复与停止：浏览器关闭不重发；协调器重启不重复 begin；未知 writer 不允许开始第二个写入；停止以实际进程/后代停止为准，native ACK 不是物理屏障。无法真实触发的窗口记 NOT_TESTED。
4. 候选有效性：真实当前候选被修改或目标修订后不能接受旧候选；必需机器 FAIL 不能用人工接受绕过。优先复用一次正常任务后的实体做这些检查，减少模型请求。
5. 提问链路：实际触发才记 native PASS，逐 request/attempt/epoch/contract 验证，回答先持久、写入和 native_applied 分开。fixture 可用于辅助定位，但单列范围。
6. 错误：认证/权限失败、项目未提交、不可用执行器和检查缺依赖明确暴露，不得显示假 delivered。窄屏与长输出只检查任务操作、字段/按钮不重叠及可达性。

## 执行约束与报告

默认只运行只读/fixture 检查；真实 lane 必须显式 `--run-native`。本任务允许在自己新建的私有 scratch 项目上最多两个小型原生模型任务，使用本机既有账号，不更换模型/全局配置，不读取或打印 key，不运行用户真实仓库需求。超出数量先报告已有证据和剩余 NOT_TESTED，不自动扩张预算。

报告每项 PASS/FAIL/SKIPPED/NOT_TESTED、源码 commit、实际产品/Driver/version/OS 身份、命令、实体 ID 和证据；完整 native 会话 dump、凭据、数据库和依赖不提交。若 main 原生接口尚未发布，先完成 harness/fixture/用例编写，等待明确的 native 配置入口，不绕到 legacy fixture 完成任务。

只提交拥有路径并 push 自己分支。交付包括 branch/commit/base、已跑结果、最小失败复现、限制及主线下一步。不要以 source/schema/文档检查冒充真实产品通过。
