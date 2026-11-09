# Agent B：执行真实原生验收与故障矩阵

工作目录 `/Users/hh/Desktop/joker/superagent-agent-b`，继续 `codex/g1-runtime`。保留所有修改，fetch 并合并最新 origin/main，读取 AGENTS.md、本轮 README、原验收任务和本文件。真实 MVP 已在 `1f3229f` 发布；旧分支/README 的“native 接口尚未公布”不再适用。合并时保留 main 已验收的 Runner/Driver/workspaces，不重新提交旧实现。

**持续执行：** 同时读取 [扩展队列](extended-run.zh-CN.md)。下文契约修正对应 B1，原生四组对应 B2；交可执行检查点后继续 B3–B6，不在原报告阶段停止。仍只拥有本测试目录，本轮原生模型任务总上限保持四个。

**最新准入：** `e392fc5` 尚未通过。先读 [扩展复核](../../docs/rfcs/WP-16/0011-extended-checkpoint-review.md)，关闭 NATIVE-LINK 过早 PASS/非法 continue，使用真实 patch 产物和已安装的 `apps/console` Playwright，补实际执行的 B3/B5/Driver conformance。14 项自测和 profile 配置不能代替整包完成；已用两个原生任务，剩余额度不自动增加。

## 出口与归属

仅拥有 `tests/native-acceptance/`。把 `0e62a3d` 的只读框架交付为可以执行的独立原生验收工具，给主线可靠的故障复现；不能通过改产品或降预期解决失败。

产品代码、contracts、root manifests/lock、schema、迁移均由主线处理。Native 实例和项目全部私有临时创建，不停止/重启用户正在使用的 5180/8796 服务。需要服务时，用主线公开 `createProductRuntime`/HTTP 组合启动独立子进程，保持真实 Driver/Runner/SQLite；不得 mock 原生路径或私建执行引擎。

## 第一阶段：修正契约与门槛

当前主线复核记录：`reports/releases/native-followup/acceptance-review.json`。

1. `buildCreateWork` 在补齐 commandId/conversationId 后仍被 `UserCommandSchema` 拒绝：使用了不支持的 workId/text，缺 goal。配置、命令、回执、snapshot、问题与验证都使用主线共享 parser，测试 fixture 本身也必须合法。
2. 选择项目要同时满足 project.dispatchAllowed 和包含选中 profile.id，不能拿 projects[0]。保留完整 defaultCriteria，尤其 required human；不能只保留机器标准。
3. 当前 `runNativeCases` 即使 native 可用也无任何 client 调用，直接固定返回七项 NOT_TESTED。实现实际分支和真实先决条件探测，不能把 TODO 当不存在的产品能力。
4. auth case 必须验证受保护接口，不用公开 health 200 代替认证成功。凭据读取前校验 loopback origin；不向非本机 URL 发送私有 token。优先用标准 URL/参数解析和明确限额。
5. 增加 `--require-native` 等严格出口。要求 native 的 CI/交付若必需用例未执行，退出非零并标明 blocked/FAIL；不能所有 native NOT_TESTED 仍返回绿色。日常无模型的默认只读模式保留。

先提交合法契约/可执行分支检查点，再连续完成整个包。原 selftest 8/8 只证明框架，不是原生产品验收。

## 第二阶段：四个有界真实任务

本轮建议最多 4 个小型模型任务，分别覆盖下面四组；模型只在显式 `--run-native` 时启动，不自动重试/扩张预算。使用本机既有 Codex 0.164.0 认证，不换模型、账号、全局配置或安装工具；实际验证的 profile/settings 必须写入证据。

1. **完整交付及候选有效性**：API 或网页导入自己的已提交临时 Git 项目，明确委托，实际生成文件，注册检查 PASS。预览并下载完整 patch，roundtrip 到干净 clone 验证，审阅/接受，刷新/关闭重开保留。复用候选测试“当前文件变更不得接受”和幂等回执；目标修订的旧 candidate 拒绝可在派工 hold 下验证，避免暗中启动新模型任务。
2. **真实机器失败**：预先注册模型不能改掉的失败检查，在实际生成候选后验证 FAIL 不可人工绕过、不能显示 delivered。和 mutation/hash guard 的失败分开，不能以改文件后的拒绝冒充机器 FAIL。
3. **运行中停止**：先证明实际受控进程在工作区持续写入/有可核对的 PID 身份，再通过产品 stop。观察正确进程与正常后代停止、写入停止、租约/屏障结果；只收到 native ACK 或界面 phase 变化不够。
4. **协调器故障与重开**：独立实例真正开始工作后 SIGKILL 自己启动的 coordinator，再以同 state 重开。证明无第二 begin、无第二 writer，旧身份/答案不能进入新 attempt。安全阻断与可操作恢复分开报告：永久卡住不能用“没有重复 begin”掩盖。记录产品允许的继续/停止/重试行为及物理结果。

每组优先复用实体；真正需要新模型任务时计数。HTTP 受理不确定时保留同一 commandId 核对回执，禁止用新 ID 偷重跑。超过上限先交已有证据及缺口，不继续计费。

## 原生问题分支

尽量把真实权限/澄清验证纳入上述任务，可在自己的隔离实例采用公开支持的逐次确认 policy。只对事先授权、工作区内的无害动作作本次回答，保留原 options/request ID/attempt/epoch/contract，验证 local_recorded、response_written、native_applied 的真实差别。

默认 on-request 没有触发问题，不等于问题链路 PASS。只有协议 fixture 的分支单列 fixture；仅在测试 policy variant 触发时也须注明 variant，不能外推默认产品。确因本机版本不可触发的用例保持 NOT_TESTED 并给出实测证据和能力限制，不编造问题或自动修改全局 policy。

## 第三阶段：交付可复现证据

- 除真实用例，补完整无模型 selftest：配置错/原生未准入、非法命令、fixture-first 选错项目、丢人工标准、坏回执、超时、同 key replay、严格模式遇未执行必需用例。不能只断言几个字段。
- 浏览器用真实同源代理或主线启动方式；避免 route 重定向跨源导致 download 取消。可以参考主线 `tests/integration/native-workbench.mjs`，但不要 import 一个会顶层启动付费任务的 CLI 脚本。
- 记录源码 commit、contracts hash、实际 CLI/Driver/profile/policy/Node/OS、各请求/实体、模型任务计数、原项目/index/HEAD/检查保持、进程观察和可重复命令；不提交数据库、账号、完整 native session 或凭据。
- 产品缺陷给出最小独立复现与预期/实际，必要时附私有 scratch 的摘要；不改 runtime/UI 来使测试通过，不依赖主线私有 SQL。
- 主线环境接线尚未完成时，先跑无依赖 Node 的原生矩阵；环境完成后，在本轮剩余四任务额度内补带依赖验收，额度已耗尽则交由主线的独立预算验证，自己继续无模型跨模块回归，不以等待环境为由停止整个包。

交 branch/commit/base、已执行/未执行范围、harness 入口、严格退出结果、证据位置、故障归属与主线下一步。只 push 自己分支，整包交付。

## B3 / P1：确定性故障与多项目矩阵

在自己的产品实例、真实 SQLite/Runner 和现有 controlled fixture 入口运行，不改产品、不写私有 SQL，不把 fixture 结论称为 native 兼容。复用现有 harness 和公共 schema，不另建 Work 状态机。

1. 同 commandId 的串行/并发重放，以及 HTTP 回执中断后的核对；相同 key 不同载荷拒绝。重连和超时不能偷偷生成新委托或第二 begin。
2. SSE 断开重连、重复 cursor、过期/gap 后重新 snapshot，真实最终投影一致。只使用可观测公共边界，无法触发的窗口准确标未执行。
3. 问题从创建、主界面展示、逐请求回答到回执；旧 questionVersion、旧 attempt/epoch、已停止、已修订合同、重复答案和多个 target 的部分失败，不得误标全 applied。真实问题未触发则保留 B2 的 NOT_TESTED。
4. 两项目和两会话的工作/问题/产物/命令身份隔离；同资源的执行遵守当前串行/屏障策略，项目切换不把动作送给另一个工作。不强行要求产品具备尚未声明的并发度。
5. coordinator 在命令已记录、运行中、检查后和接受后故障的可触发窗口；按真实可观测边界同步再 SIGKILL，避免 sleep 猜时序。分别检查不重复写入和可操作恢复。Runner 故障仅针对本次明确拥有的进程，不杀用户 native 服务。

每个产品失败都提交最小回归并附 blocker，随后继续其他矩阵。主线修复后仅复跑受影响项；不能用 retry-until-pass 或额外 sleep 把不稳定结果洗成 PASS。

## B4 / P1：真实浏览器与体验验收

使用 Playwright 和真实同源服务。默认用 controlled fixture 完成全流程，B2 的 native 候选可复用做只读/交付复验，不新增模型任务。

- 桌面 1440×900、窄屏 390×844：导入、项目/执行器选择、明确委托、排队/运行/环境阻断、问题、检查失败、完整 patch 下载、接受和重开。尚未发布的主线环境 DTO 单列未测；先完成已有流程。
- 模拟 API 暂时离线、SSE 断开后恢复、慢响应、长需求/输出与中文路径；失败保留表单与当前身份，不把重连变成重复提交。
- 键盘可操作、焦点返回、对话/表单可滚动、关键按钮可达且不重叠；记录截图和明确复现，不改 UI 源码。截图检查实际内容非空，下载内容可 roundtrip 验证，而不是只断言浏览器发生了 download 事件。
- 报告把产品阻断、体验问题、测试环境不满足分开，附源码/视口/步骤与 owned screenshot 路径，不上传真实账号画面。

## B5 / P1：有界稳定性测试与发布门槛

新增显式 `--soak` 或等价入口，默认不在普通自测自动执行。使用受控执行器连续做至多 30 个创建→问题/完成/失败/停止→重开周期，或 45 分钟，任一先到即结束；可设更小参数。停止在首次未解释的不变量破坏，保存复现 seed/周期/输入，不无限重试。

记录前后及峰值：本实例 coordinator/Runner 的进程/owned 子进程、可观测 FD/内存、state/产物体积、命令与 begin 计数和延迟。先做基线/趋势分析，不用任意绝对阈值制造“生产稳定”声明。RSS 无法获得等情况明确未知。清理只针对有可信归属的 fixture/state；失败退出也不得留下写进程或误杀同名进程。

交付一条零模型回归命令、显式原生命令、严格报告聚合命令。聚合校验报告版本/source commit/参数/实际执行范围，拒绝缺失或旧基线证据冒充当前绿色；必需项未执行时退出非零。fixture 与 native、正确阻断与恢复能力分列，不用测试数计算完成率。

## B6 / P2：下一个执行器的接入验收工具

复用 `AgentDriverV1`、现有 DriverKit/testing 导出，实现包内可重复调用的 conformance 入口与 provider recipe。输入是已有 driver 工厂及其公开测试 port，断言相同的身份绑定、能力声明、单次 begin、发送未知后的核对、逐请求回答和取消/事实输出；禁止另造 driver 协议或复制 Runner 实现。

用现有 fake driver 与 Codex 协议受控服务运行同一套适用断言；缺能力应返回明确 unsupported/NOT_TESTED，必须能力缺失则严格失败。fixture 通过不升级实际 native。若公开工厂不足，用 RFC 给主线具体接口建议，先完成可用范围。

给出 ZCode、DeepSeek Harness、CAC 的接入清单模板：协议/版本、启动与认证边界、metadata/policy、问题/停止/重连、何种独立证据才可准入。可对已安装命令做有界只读 version/help/schema 探测，不读取账号 home、不启动模型、不安装/升级工具；未安装保持 NOT_TESTED。不在本阶段实现三个生产 Driver。

最终汇总 B1–B6：完成的工具、实际结果、阻断归属、剩余模型预算和下一执行器作者可直接使用的入口。报告后结束，不为持续运行扩张付费任务。
