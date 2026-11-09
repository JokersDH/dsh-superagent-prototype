# 真实单执行器 MVP 集成窗口

日期：2026-11-09。主线基线 `98dfbc9`；待修候选 A `8e302b4`、B `ecca4cd`。

用户要求继续既有架构，交付真实端到端 MVP。本轮主线在 primary checkout 暂接候选准入修复及原生接线；不写 A/B checkout，不更换它们的分支。修复基于可追溯的已提交候选，导入不等于准入，通过后才启用。

## 本轮归属

主线负责候选的两项 workspace、六项 Runner 入场修复及其回归，Codex Driver 实际协议接线，产品项目配置、委托、问题、验证与交付的组合。共享 contracts、root lock 和集成证据仍只有主线一个 owner。A/B 原分支及报告保留原测量范围，后续消费新的 main，避免覆盖本次修复。

## 出口

一个本机真实 Codex 执行器通过官方 app-server 协议工作，用户从工作台明确委托，在独立 Git worktree 修改真实文件并运行已注册检查，权限/提问归主入口，产物以完整 patch 与证据交付；机器失败不能接受。准确停止、重开不重复 begin、旧身份不接收答案。先以临时 Git 项目完成真实任务，之后允许用户明确选择本地项目；不自动合并或推送用户项目。

仍保留 Ticket/Assignment 为唯一执行生命周期、unknown send 先核对、物理 writer 屏障、当前候选验证和人工接受。不得为打通 UI 绕过上述准入。不将协议 fixture、普通聊天、测试数或固定输出视为真实 MVP。

官方参考：<https://learn.chatgpt.com/docs/app-server>（由官方 Codex App Server 入口跳转）。实际协议以本机 `codex-cli 0.164.0` schema/行为为准，复用 native runtime 的工具循环，不在 coordinator 自建编码循环。

当前复验：A 两项、B 六项准入仍 FAIL；本机已安装 Codex 0.164.0，已有 API-key 认证配置，实际模型执行尚待本轮验证。后续状态按实际运行证据更新。

## 本轮结果

原八项阻断已在主线修复，并保持原探针预期不变。实际 Codex 后端已通过五个场景：真实委托、实际代码与既有检查、原项目保持、当前候选接受、重开保留。真实浏览器又验证导入项目、明确确认、原生执行与验证、代码位置/完整 patch 下载、接受和重开不重复 begin 共六个场景。浏览器验收的下载阶段先修正了隔离测试代理，继续使用同一已验证候选完成后半流程，没有重复模型请求。

主线 `check:g2-workbench` 367 项通过，内部运行时整包 262 项通过；本机 Codex command/exec 零模型安全探针三项通过（允许范围内写、拒绝越界写、实际受控命令子进程停止）。内部 console 的七个 HTTP 接口 fixture 场景和十二个模块测试也通过。各证据有自己的源码指纹和范围，不能合并成一次全 native 认证。

新的项目导入和代码位置 DTO 独立生成，原 Runner/data wire hash 不变。恢复 transport 统一到 execution，coordinator facade 仅重导出，保留一个 proof WeakMap。Runner payload 与 coordinator 同一内容寻址并先 fsync 后 journal/fact/receipt。原生初始化先准备 policy、资源清单和事实，再接受一次 begin；普通对话没有执行授权。

当前按本机单执行器 MVP 提供，不升级完整 G2：真实模型审批/澄清/运行中 steer、对抗性脱离进程树、全 SIGKILL 窗口、依赖准备、跨平台、断电与长期 soak 保持单列 NOT_TESTED/后续范围。原生安全探针仅证明所测正常 managed command 的停止与 sandbox。用户项目通过独立 worktree 和 patch 交付，接受后不自动合并或覆盖。

原来两个外部窗口的新分工见 `agent-tasks/native-mvp/`，不重复改本轮内部 console/Codex 源码。A 负责项目环境准备，B 负责独立真实产品和故障验收。主线负责公共 schema、锁、应用/HTTP 和跨模块验收。

最终源码提交 `252bf70` 上又以一个全新的真实 Codex 任务完整运行六项浏览器验收，全部 PASS，非恢复/拼接结果；见 `reports/releases/native-mvp/browser/report.json`。同一提交的八项候选准入探针全部通过。旧内核 178 项回归也通过。完整 G2 的未测范围仍按上文保留。
