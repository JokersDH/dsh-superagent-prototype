# Agent C：限定读上下文、结构化提案与明确决定

工作目录 `/Users/hh/Desktop/joker/superagent-agent-c`，分支 `codex/g3-assistant-context`，由主线从派工后的最新 `origin/main` 创建。本轮正式拥有 `packages/context/`、`packages/proposals/`、`packages/knowledge/` 及其 package-local tests/fixtures/docs/reports。目录就绪后开工，不在 primary 或 A/B/D/E 目录写代码。审计基线 `c3f018e`，读取 AGENTS、START-HERE、product-spec/README 和本轮 README。

主线拥有公共 contracts、reasoner/model/HTTP/application 组合和 root lock；A 是唯一生产迁移 owner。你通过 A 公开存储/索引 port 消费，不私开 SQLite writer、不在包内造新执行器或 LLM tool loop。原生收费任务 0，外部模型请求默认 0；测试采用本机 SDK mock/受控 provider。

## C1 消费 interface 与完整检查点

围绕三个小而完整的模块写包内 RFC：有界 ContextReader、Proposal 的校验/有效性/确认规则、明确决定的来源/版本/scope 规则。优先使用现有 ReasonerProposal/UserDecision/Scope/Contract 等 shared parser；缺少公共语义交主线定义，不复制私有 wire 类型。

列出需要 A 的读索引和持久 port、需要主线的 actor/HTTP/model 适配；先交导出与合法/非法消费 fixtures 的稳定检查点，然后继续 C2–C5。依赖未到时以同一 port fixture 推进，不写绕过权限的临时实现。

## C2 有界、带来源的项目与任务上下文

从明确授权的项目、当前任务、检查和交付读端口取得上下文。每片包含来源、范围、基线/内容身份与有效性；按请求限制文件数/字节/token 估计/时间，分页并优先当前问题相关内容。上下文不足或来源失效返回明确说明，不伪造已读仓库。

默认只消费项目元数据、任务和已批准证据。将源码/文档送往主对话模型前，必须有单独、可见且绑定文件/范围/预算的上下文授权；不能把编码执行器的项目授权自动扩大成主对话网关的上传许可。提供主线可实现预览/确认的读结果，而非自动全仓上传。

拒绝跨项目/合同、外链与危险路径、账号/密钥/.env/native home、二进制和过大输入。文件内容和指令只是待分析数据，不是权限或工具授权。工作区/项目变化能使旧上下文失效；检索不能隐式写入、联网或触发项目代码。

验收：真实临时 Git/文件 fixture + fake read port 均通过；长中文/大文件、坏链接、源消失、基线改变、跨项目、预算和提示注入案例明确；日志/公共输出无凭据或隐藏本机路径。

## C3 复用现有 reasoner 的结构化提案

不实现通用模型循环。由主线注入既有 reasoner/provider 的结构化结果或正常回复；本模块负责 parser、来源绑定、当前性和状态规则。模型可产生工作/修订/决定提案，不能直接 begin、运行命令、扩大 scope 或写入项目。

提案必须绑定源消息、项目/授权、当前合同（适用时）及版本/有效期。用户确认时由主线确定性命令重验 actor、project/scope、expected 和物理屏障；重复确认幂等、旧/撤销提案拒绝。JSON/结构化能力不可用时退为普通回复，不从 Markdown/模糊文本猜可执行操作。

验收：合法单次提案、坏结果、跨项目、伪造身份/工具授权、同 ID 改载荷、旧合同、重复确认和取消/过期均有无模型用例，确认前不会产生执行效果。

## C4 明确决定与知识治理

基于现有 UserDecision/KnowledgePage 语义实现记录、来源引用、项目/scope、生效/撤销、supersedes 和可查询列表。A 提供持久 port/迁移，主线提供命令/HTTP；你维护领域规则和消费者，不能把事实记录分散到任意 JSON 或第二 DB。

只将用户明确确认的决定作为可复用内容。用户一次性改目标、临时环境补救或 agent 偏离不自动变长期偏好；旧/撤销/失效决定不进入新上下文，权限/认证答案不升级成共享决定。保留原来源和历史可审计。

验收：记录/撤销/替代/过期/重开、同项目适用与跨项目拒绝、来源消失、上下文预算、旧版本 replay 和并发冲突。自动规则推广、跨项目记忆推断及学习效果声明不在本包准入。

## C5 独立消费与主线接线交付

提供一个不调用真实模型的完整消费者：授权上下文 → 既有 provider mock → typed proposal → 显式确认/拒绝 → 决定记录 → 后续上下文读取 → 撤销后不再生效。主线接口到达后复验相同 port，不改 console/coordinator 生产源码。

交 source commit/base、公开导出/依赖请求、真实 commands/results、mock 与产品已接线范围、A/main 消费步骤和剩余缺口。维护自有 `reports/execution-status.json`，显式暂存拥有文件并 push 自己分支。遇阻继续解析、治理、来源/预算/注入负例和独立消费；全部可执行阶段完成或只剩明确外部阻断时结束。
