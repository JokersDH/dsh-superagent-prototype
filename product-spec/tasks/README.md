# 可独立派发的实现任务包

17 个包，按 [多 Agent 开发规则](../08-multi-agent-development.zh-CN.md) 派发。先 WP-00，通过 G0 后再并行；各包的最后一节包含可复制指令。无需把整个对话历史给实现 agent。

| 包 | 任务 | Gate | startAfter | acceptAfter |
| --- | --- | --- | --- | --- |
| [WP-00](WP-00.md) | 复用提取、契约冻结与 Bootstrap 试验 | G0 | 无 | 无 |
| [WP-01](WP-01.md) | 正式 Core 提取与可信完成/Fence 扩展 | G1 | WP-00 | WP-00 |
| [WP-02](WP-02.md) | 事务存储、Effects、Outbox 与数据迁移 | G1 | WP-00 | WP-01 |
| [WP-03](WP-03.md) | Supervisor、Runner、DriverKit 与故障子进程 | G1 | WP-00 | WP-01, WP-02 |
| [WP-04](WP-04.md) | 工作区、候选冻结与可信验证 | G2 | WP-00 | WP-01, WP-02, WP-03 |
| [WP-05](WP-05.md) | QuestionBroker 与逐 Target 答案投递 | G2 | WP-00 | WP-02, WP-03 |
| [WP-06](WP-06.md) | Agent Catalog、Profile 与原生策略准备 | G2 | WP-00 | WP-02, WP-03 |
| [WP-07](WP-07.md) | Codex Native Driver | G2/G4 | WP-00 | WP-03, WP-05, WP-06 |
| [WP-08](WP-08.md) | ACP v1 Driver 与 DeepSeek Harness Profile | G2/G4 | WP-00 | WP-03, WP-05, WP-06 |
| [WP-09](WP-09.md) | ZCode 安装版协议 Spike 与 Native Driver | G2/G4 | WP-00 | WP-03, WP-05, WP-06 |
| [WP-10](WP-10.md) | ApplicationService、主对话 Reasoner 与 HTTP/SSE | G2/G3 | WP-00 | WP-01, WP-02, WP-03, WP-04, WP-05, WP-06 |
| [WP-11](WP-11.md) | 主对话工作台与产品交互 | G2/G3 | WP-00 | WP-04, WP-05, WP-06, WP-10 |
| [WP-12](WP-12.md) | CLI、诊断、打包、备份与运行维护 | G3 | WP-00 | WP-02, WP-03, WP-06, WP-10 |
| [WP-13](WP-13.md) | 知识连接、明确决定与上下文构建 | G3 | WP-00 | WP-02, WP-10 |
| [WP-14](WP-14.md) | 选择性学习、联合提问与迁移实验 | G5 | WP-00, WP-13 | WP-03, WP-05, WP-07, WP-08, WP-13, WP-16 |
| [WP-15](WP-15.md) | 未来 CAC Adapter 与原生 Sub-team 接入 | G6 | WP-00 | WP-03, WP-05, WP-06, WP-16 |
| [WP-16](WP-16.md) | 集成、根配置、端到端与发布门禁 | G0–G4 | WP-00 | WP-01, WP-02, WP-03, WP-04, WP-05, WP-06, WP-07, WP-08, WP-09, WP-10, WP-11, WP-12, WP-13 |

公共契约只有 WP-00 可改，core 规则只有 WP-01 可改，迁移只有 WP-02 可改，根 lock/组合根只有 WP-16 可改。模块 owner 可提出 RFC。WP-16 的最终 acceptAfter 是 G4 汇总依赖，G1/G2/G3 按阶段增量接受。

任务源为 [task-source.mjs](../tools/task-source.mjs)，验收源为 [acceptance-source.mjs](../tools/acceptance-source.mjs)。修改源后执行 `node product-spec/tools/generate-spec.mjs` 和规格校验；不要单改生成结果造成漂移。
