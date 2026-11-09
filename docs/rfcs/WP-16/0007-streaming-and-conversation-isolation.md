# 流式对话与工作记录隔离

日期：2026-11-09。分支：`codex/g2-execution-integration`。基线：`4c933b4b388c413603d8673c98999195f4a616c9`。已验收源码：`4e984fa71a0dc62e63fdc4a670a50daf1d152312`。本交接接续 0006，不升级真实编码执行器或 G1/G2 准入。

## 问题与复现

用户截图中，模型把 `Controlled browser work ... failing` 当作需求文本；回复也等待完成后整体出现。根因有两层：工作委托/补充与普通 chat 均使用 `trusted_user` provenance，模型历史只筛 provenance，遗漏 anchor；主线浏览器验收又直接写默认 `conv-main`。此前模型 SDK 明确使用 `stream: false`。

先添加回归并实测失败：`node --test --test-name-pattern='work delegation' tests/integration/assistant-replies.case.mjs` 显示模型收到 `[测试工作目标, 工作内部补充, 当前问题]`，预期仅当前问题。`pnpm --filter @personal-agent/coordinator test:assistant` 的增量用例在修复前确认请求未启用 streaming，首段未提前到达。

## 实现与归属

主线拥有 coordinator 组合、contracts、根配置、集成测试；本次用户要求的 console 对话改进在主 checkout 实现。没有改 A/B checkout、生产迁移或 native 候选准入。

- `assistant-replies.ts` 拒收工作锚定输入，历史排除锚定工作消息及其回复。主对话 UI 同样排除这些记录；选择“当前工作”才显示相应工作消息。保留既有数据库和历史，不重写旧回复。
- `workbench-browser.mjs` 为每次验收创建独立随机 conversation ID，查询和委托均使用它，不再污染默认个人对话。
- `model-provider.ts` 使用 SDK streaming completion，按网络增量调用回调。跨分片保留可能的 key 前缀并脱敏，之后才发出显示文本；限制 32768 字符、整次请求 45 秒，不自动重试。缺少 finish marker 视为中断。
- 新 `AssistantStreams` 只保存最多 64 份临时显示快照。每份包含原消息/回复/项目/会话身份、revision、累计文本和 phase；75ms 检查有变化才发送，不写逐 token SQL。服务关闭中止当前模型请求，网页关闭不重发或取消后台请求。
- 新增独立 `assistant-stream/1` DTO 和认证的 `GET /v1/assistant/stream?conversationId=...`。参数严格校验，保留 Host/Origin/session 边界；浏览器只接收当前会话。主 Runner/data wire 哈希仍为 `74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。
- 前端使用 EventSource 接收累计快照。刷新时重取正在生成的快照，完整回复提交后切换到持久历史。原有请求意图与不确定结果不重发规则保留，临时流式文本不构成可信完成事实。
- 新增可编辑的需求拆解、代码/报错、Agent 任务单模板，以及回复复制/Markdown 导出。帮助入口在窄屏可见。没有自动派单、文件读取或终端调用；指南明确给出手动交接到现有编码 Agent 的用法。

## 验收

目标 Node 24.22.2、pnpm 11.7.0、darwin/arm64；以下均在源码提交上完成，product 报告的 `sourceWorktreeClean` 为 true。

| 命令 | 结果与范围 |
| --- | --- |
| `pnpm check:g2-workbench` | PASS，358 项；188 contracts + 96 application/recovery + 30 workspace/verification + 14 controlled product + 5 configuration + 17 assistant + 8 console；含类型检查与构建 |
| `pnpm check:g2-browser` | PASS，11 场景；原有受控闭环保留，工作目标不伪装成聊天消息，测试使用独立会话 |
| `pnpm check:assistant-browser` | PASS，6 场景；实际 SDK、effect、SQLite、HTTP/SSE 和 console，模型内容由临时本地 SSE 服务提供；首段先于完成、刷新不重复请求、完成后保存、Markdown 导出及新对话隔离 |
| 实际网关短提示词 | PASS；只发 1 条普通测试问题。DeepSeek-V4.1-Flash-1017 首段 5934ms、完成 6799ms、8 次部分更新、198 字符；首段显示时还没有持久 assistant 回复 |

17 个 assistant 用例包含：原消息/receipt/effect 原子性、对话/时间/工作上下文隔离、失败不重发、提交失败不重复计费、部分快照刷新、服务关闭中止、SDK 实际流解析、key 跨分片脱敏、缺少 finish marker 拒绝、外部取消和首段提前到达。

证据：`reports/releases/g2-product.json`、`g2-workbench.json`、`workbench-browser/`、`assistant-streaming/report.json`、`assistant-streaming/live-provider.json` 及该目录截图。浏览器自动检查使用本地模型 fixture，不产生供应商费用；真实网关实测单列，没有发送仓库文件。源码与 dist 的实际 key 扫描另记录在 `assistant-streaming/key-scan.json`，只输出数量及命中路径。

## 消费与限制

用户：打开工作台后刷新，建议点“新对话”，选择“拆解开发需求”，确认计划后从输入框旁的任务模板选择“生成 Agent 任务单”，审阅后复制/导出给已有编码 Agent。旧回复不自动重生成；历史工作与普通对话分别查看。

A：继续 console 时保留工作/聊天隔离、模型增量监听、草稿状态和复制/导出；不要把临时 stream phase 用作 Work 或 Assignment 生命周期。更改交互后运行两条浏览器检查。

B：流式对话不涉及 Driver/Runner 的资源停止、物理屏障或可信完成。继续原准入任务。

限制：完整会话历史列表、主动停止单条生成、自动跨 Agent 派单和任意仓库开发未接通。服务重启会中止未完成回复，重启后显示通知，既有请求不会自动重新计费；只有本机服务继续运行时，网页刷新能恢复同一条生成。旧回复里的历史污染说明不会被自动改写，新的会话与未来上下文已隔离。实际网关仍使用原 HTTP 地址，本次没有改变密钥或传输策略。
