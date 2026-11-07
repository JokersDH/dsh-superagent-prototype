# 整体设计复核与修正记录

日期：2026-11-07。这是规格复核，不是产品测试或兼容认证。

由 core 复用、运行时、产品/学习三个视角分别复核专题、共享契约和任务依赖，整合时修正了下列具体问题：

| 问题 | 最终处理 | 验收引用 |
| --- | --- | --- |
| core 的 ready 可直接结束未绑定 Ticket | opt-in 个人完成模式；可信验证/接受后仍由 core 结束 | CORE-02/04 |
| 迟到 report 缺 Assignment 绑定 | additive scoped report + 同事务全绑定 fence | CORE-05、RT-01 |
| 原生答案恢复写入但未使候选失效 | Broker 同事务失效 generation，答案不重复成为 core Input | CORE-03、DATA-07 |
| 空/全 optional criteria 可形成空集合成功 | 非空、有意义 required 条件；机器 checkDefinition 和人工接受路径 | CORE-04、DATA-01 |
| 原生 RPC ID 被统一当 string | tagged wire ID，保留整数精度与字符串区别 | RT-05 |
| UI 缺规范化原生表单 | QuestionPresentation/Answer；UI 不解析厂商品牌 payload | AC-UX-05 |
| 主对话只有写入、无历史读取 | 分页 ConversationPage、发送时项目上下文、snapshot 恢复 | API-03/06 |
| 暂停/继续/重试只存在概念 | typed 确定性命令；stopped 继续取得新授权/合同/Ticket | AC-UX-02/06、CORE-09 |
| 操作按钮缺当前候选/Assignment/hold | WorkView.actions 派生投影和 retry action token；无候选也可重试 | API-06 |
| 决定/经验只有写无完整读控 | 分开的 KnowledgePage/LearningView 与版本化控制命令 | AC-LRN-01/07、AC-UX-11 |
| 通用 ingest fence 可能丢停止后的物理证据 | 拒绝旧业务变更，但继续更新取消/静止的 Supervisor 事实 | RT-06 |
| Catalog 与 Driver 的实际验收依赖环 | WP-06 用公共契约/fixture 验收，真实 native 证据归 Driver/WP-16 | NATIVE-01/02/03 |
| agent 竞争修改共享文件 | contracts/core/migration/root 四个单 owner，RFC 子目录独立 | CORE-10、规格 checker |

最终检查区分：模块 interface 被接受、某 profile native 通过、产品 gate 通过。共享 case ID 的局部 fixture 报告不能自动升格为端到端成功。

## 当前验证范围

- 原仓 reference baseline：两个测试文件、144 个测试通过；不证明独立提取。
- 当前公共 TypeScript 草案与类型化 fixtures：使用本仓 TypeScript 编译器进行 strict noEmit 检查。
- 当前规格 checker：ID、两个及混合依赖 DAG、路径 ownership、83 条验收责任映射、生成内容一致性、任务指令、代码 fence 和本地链接。
- `verification-report.json` 记录静态检查结果和文件 hash；不是 native/产品报告。

没有执行 production core 提取、拟议依赖加载、原生业务 smoke、产品 E2E、soak 或学习实验。G0–G6 仍是后续实施任务。
