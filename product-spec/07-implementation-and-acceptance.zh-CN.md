# 07 分阶段实施与验收

目的：从可提取核心到可日常使用的产品，每阶段都有运行出口；不以文档齐全、mock 演示或子任务全绿代替整体完成。机器索引见 [work-packages.json](work-packages.json) 和 [acceptance-catalog.json](acceptance-catalog.json)。

## 1. 实施节奏

| Gate | 目标 | 主要任务包 | 必需出口 |
| --- | --- | --- | --- |
| G0 复用/契约可行 | 证明独立内核与公共 interface 可用 | WP-00 | 隔离提取、原测试基线、依赖图、契约与版本锁；失败先解具体阻塞 |
| G1 确定性骨架 | 不用真实模型也能验证核心可靠性 | WP-01/02/03/16 | core guard、事务队列、假进程、恢复与 writer 屏障 |
| G2 单执行器闭环 | 一项真实委托到验证交付 | WP-04/05/06/07 或 08/09，WP-10/11/16 | 真实权限、提问、取消、产物验证，主入口工作 |
| G3 日常可用 Alpha | 两项目、重开/重启、错误恢复 | WP-10/11/12/13/16 | 接入引导、明确决定、可靠恢复、备份与本机包 |
| G4 可扩展 Beta | 第二真实协议，再完成首批三目标能力矩阵 | WP-07/08/09/16 | 新 Driver 不改 core/Question/UI；每目标支持/降级状态诚实 |
| G5 创新实验 | 在稳定基线之上验证收益 | WP-14 | 基线、隔离、预声明评估、shadow 零真实影响 |
| G6 CAC/高级协作 | 后续适配，非首版依赖 | WP-15 + 新 ADR | CAC 不替换主权威，跨子委派有可验证授权 |

首个真实执行器优先选当前安装版最早通过 identity/权限/问题/取消门槛的目标；建议先做 Codex native 的纵向试验，同时允许 DSH/ZCode 只读 spike 并行。列表顺序不是硬性质量排序。

以 2–3 个有效开发通道估算，G0–G1 约 1–2 周、G2–G3 约 2–4 周、G4 约 1–3 周；只作排期假设，原生版本限制可能延长。每天以 gate 证据更新计划，不承诺 agent 数增加就线性加速。G5/G6 单独预算，不拖住可用产品。

## 2. G0：先验证复用，不先造空平台

1. 在独立工作目录建立最小 TS package，从固定 commit 提取 `src/core/**` 和两个原测试文件，保留 MIT 及来源；不 import 原插件根入口。
2. 安装/解析仅最小测试依赖并输出运行时和 type import graph；确认没有 DSH peers/宿主依赖。此动作由实施任务完成，本次文档未安装依赖。
3. 在提取目录运行 144-test baseline，保存命令、lock、版本和结果；测试数量变化解释原因。
4. 对 completion/report/stop 三个必要改造写 ADR 和失败测试设计，不在多个任务内各实现一套。
5. 将公共草案变成单一运行时 schema 源，生成 TS/JSON，添加合法/非法及旧消费者 fixtures；冻结 contracts v1/hash。
6. 精确锁 Node、pnpm、binding 和前端/HTTP/测试版本；运行 native-load/SQLite 版本入场试验。
7. 集成负责人确认路径 ownership 与任务依赖，准备 G1 fixture 和 CI 命令。

G0 验收：CORE-01、DATA-01、OPS-01。原仓 144 个测试已通过不替代第 3 步；拟议依赖还没加载也不允许标通过。

## 3. G1：先把失败处理做实

1. WP-01 复用 core，增量 completion gate、candidate invalidation、fenced report 和旧 revision guard；legacy 模式保留。
2. WP-02 实现一连接事务、Repositories、effects、receipt 和投影事件；持久化 fault harness 在每个 commit 窗口退出子进程。
3. WP-03 以假原生子进程实现 Runner、控制泵、journal、Supervisor、writer ownership、reconcile。
4. WP-16 接线，验证受理→派工→问题事实→取消→恢复；不需要真实模型或账号。
5. 用实际 SQLite binding 注入：commit 前后退出、effect claim/发送窗口、旧 epoch 迟到、空间/背压、同 state 第二 writer。

G1 验收：CORE-02..10、DATA-02..08、RT-01..08、REL-01..08。必须有真实 subprocess 和持久化集成；纯 MemoryRepositories 不足。

## 4. G2：一条完整真实链路

用临时 git 项目，目标是“增加一个带测试的小功能并交付 patch”，检查命令和外部动作预先限制。不是把用户主仓直接当协议实验场。

1. Catalog 探测产品身份、配置与认证，Driver spike 验证实际版本。
2. 准备 native policy，明确允许写 scratch、拒绝某个无害禁用动作。准备未通过不 begin。
3. 用户从主对话明确委托，目标/验收/范围形成合同。
4. 真实触发一个业务问题和一个权限请求；主入口正确显示、回答、拒绝、取消，答案逐 target 可追踪。
5. 一次正常完成经过候选冻结、项目检查和必要接受；一次故意测试失败不能显示交付完成。
6. 在模型/工具运行时停止，记录本地受理、native 取消与物理静止；无法证明的资源保持 unknown。
7. 重启 coordinator，核对未完成原生任务，不重复发起。

G2 验收：RT 全部适用用例、NATIVE-01 对所选 profile 的 required cases、AC-UX-01..10、REL-09/10。一个字段不支持就降级相应产品功能，不把 SKIPPED 记成通过。

## 5. G3：可日常使用

完成两个项目的任务、不同 reply anchors、关闭浏览器重开、daemon restart、登录失效、预算不足、候选被编辑、需求修订和过期问题等流程。知识库不连接也能交付；明确项目决定即时可用且可撤回。

按固定场景进行至少 48h soak，含多个可重复的委托/停止/重启周期，记录资源、重复业务、未决问题和内存/磁盘增长。时间长度不等于可靠性证明，必须同时列出场景覆盖和失败。

发布前验证 backup→新目录 restore→reconcile；验证破坏性迁移的恢复步骤。Playwright 覆盖桌面 1440×900、笔记本 1280×800、窄屏 390×844，检查问题表单/长文本/错误内容不溢出、焦点和键盘流程。产品不是营销首页。

G3 验收：UX 全部、OPS 全部、REL 全部、AC-LRN-01/02/03/04/07/12 的明确决定/局部记录适用部分。自动经验推广仍关闭。

## 6. G4：证明扩展能力

第二目标必须真实使用不同协议/原生实现；只把相同 runtime 换模型不算异构扩展。实现者按公共 Driver 契约接入，不修改 core、Broker 或 UI 的厂商分支。若确有公共语义缺口，走 RFC 并回归已有 Driver。

分别提交三个目标的 identity、schema、配置和 capability 矩阵。首批“支持三目标”只在各自 required cases 全通过时宣称；ZCode 安装版与公开源若仍无法对齐，可发布实验入口并明确不进入稳定调度。

记录新增 agent 的修改文件分布、接入工时/人工时间、公共契约变更次数和回归数量。同协议产品应主要增加 Profile/fixture，不能把“只写一个 JSON”作为不经真实测试的承诺。

G4 验收：NATIVE-01/02/03、EXT-01/02/03、原 Driver 回归、RT-08/09。

## 7. G5/G6：研究与未来适配

G5 按 06 的 I1/I2/I3 分别预声明假设、基线、反馈/模型/预算、留出集、推广与停止条件。30–50 个片段只支持初步机制检查；不宣称普遍收益。先记录，再候选，再隔离实验/shadow，最后有范围 active。验收为 AC-LRN 全部和可重建报告，算法效果单独判断。

G6 收到 CAC 公开 interface 后先 spike。复用其已有 agent/session/team 能力，而 coordinator 保留唯一 Ticket 权威；原生子团队问题归主入口。最新版代码未拿到时 WP-15 只能交付设计/fixture，不能宣称兼容。跨 harness 子委派另立 ADR 并验证父授权下的 scope 继承。

## 8. 测试层次和命令约定

| 层 | 覆盖 | 可以证明 / 不能证明 |
| --- | --- | --- |
| spec static | 依赖 DAG、ID、文档链接、契约编译 | 规格一致；不能证明产品实现 |
| core unit | legacy、授权、派工、generation/fence | 领域规则；不能证明外部 I/O |
| DB integration | 真 binding、事务/队列/备份 | 持久化行为；不能证明 native 协议 |
| fixture subprocess | 分帧、异步取消、退出、故障窗口 | Runner/Driver 接线；不是厂商兼容 |
| native smoke | 固定产品/版本/配置/OS | 该组合测到的能力；不外推所有版本 |
| E2E/soak | UI→真实链路、恢复、长时间负载 | 具体场景产品行为；不证明无缺陷 |
| research evaluation | 固定基线、留出、质量/成本/人时 | 特定实验增量；不等于日常稳定性 |

实施仓由 G0 注册以下命令，任务包必须注明真实存在的脚本，不得把本节示例复制成“已执行”：

```sh
pnpm check:contracts
pnpm test:core
pnpm test:storage
pnpm test:runtime-fixture
pnpm test:conformance --profile <profile-id>
pnpm test:e2e
pnpm test:recovery
pnpm test:release
```

当前仅文档检查可立即执行：

```sh
node product-spec/tools/verify-spec.mjs
pnpm check:contracts
pnpm check:bootstrap
```

原仓 reference baseline 命令为 `./node_modules/.bin/vitest run tests/core-engine.spec.ts tests/stage.spec.ts`，已由本轮运行通过。它不属于已经完成的 G0 提取结果。

## 9. 验收报告格式

每条记录至少包括 caseId、status、runKind、commit、contractsHash、release/lock、OS/arch、native/Driver/SDK/schema/profile/config 身份、命令、输入 fixture、证据路径、费用、日期、限制及复现步骤。状态仅 PASS/FAIL/SKIPPED/NOT_TESTED；SKIPPED 必须给理由，不满足 required gate。

所有证据引用进入固定报告目录，日志脱敏，源码和 artifact digest 可核对。失败不能通过修改期望/隐藏测试消失；发现规格错误先 RFC。至少一位未写该实现的集成人员核对关键门槛。

## 10. Definition Of Done

模块完成要求：只改拥有路径、公共契约一致、必须用例有证据、错误/取消/未知状态有实现、说明兼容范围和剩余限制、无未登记迁移/依赖漂移、可由下一包消费。

产品完成要求：目标 gate 的全部必要模块已接受；真实端到端流程通过；备份和恢复可执行；未确认 writer、过期答案和不合格产物不会被 UI 报成成功；已有能力不被新 Driver 破坏。必须功能缺失用明确范围发布，不能以“以后补测试”宣布全部完成。
