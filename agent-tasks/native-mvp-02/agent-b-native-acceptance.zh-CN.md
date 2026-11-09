# Agent B：执行真实原生验收与故障矩阵

工作目录 `/Users/hh/Desktop/joker/superagent-agent-b`，继续 `codex/g1-runtime`。保留所有修改，fetch 并合并最新 origin/main，读取 AGENTS.md、本轮 README、原验收任务和本文件。真实 MVP 已在 `1f3229f` 发布；旧分支/README 的“native 接口尚未公布”不再适用。合并时保留 main 已验收的 Runner/Driver/workspaces，不重新提交旧实现。

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
- 主线环境接线尚未完成时，先跑无依赖 Node 的原生矩阵；环境完成后追加一个真实带依赖项目的跨模块验收，不以等待环境为由停止整个包。

交 branch/commit/base、已执行/未执行范围、harness 入口、严格退出结果、证据位置、故障归属与主线下一步。只 push 自己分支，整包交付。
