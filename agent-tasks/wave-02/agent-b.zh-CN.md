# Agent B：可恢复运行时、接入平台与首个 Driver

最新准入补充（2026-11-09）：`96cbe4e` 的 222 项模块测试通过，但实际主线 client/AttemptRunner 联测新增六项失败，涉及 key 长度、真实 inventory/state、停止失败时的假空清单屏障、关闭 admission 后仍投递、错身份取消及打开后损坏 Journal 重放。证据、独立复现和整包收尾见 [准入交接](../../docs/rfcs/WP-16/0005-candidate-admission-and-workbench.md)。纳入当前运行时大包持续修复；不弱化主线协议/证明，不以独立存活或私有替代 client 代替实际主线兼容。

工作目录 `/Users/hh/Desktop/joker/superagent-agent-b`，继续 `codex/g1-runtime`。读 [整包排程](README.zh-CN.md)、[集成约定](../../docs/rfcs/WP-16/0001-wave-02-integration-boundaries.md)、原 WP-03/06/07。候选基线 `74a3068`、主线基线 `57fd8ed`；先保留已有工作并合并最新 main。完成旧三项之后直接推进整个包。

## 范围与所有权

拥有 `packages/execution/`、`packages/driver-kit/`、`packages/testing/`、`apps/runner/`、`packages/catalog/`、`packages/policy-preparation/`、`packages/drivers/codex-native/` 及原 runtime/WP-03/06/07 文档目录。包内 manifest、测试、fixtures、报告属于你。

仅为消除 Runner 对 coordinator app 的反向依赖，允许一次受限提取：把原 `apps/coordinator/runner-link.ts` 的共享恢复 transport 原样移入 execution，原文件只作兼容 re-export；如 RuntimeProducer 类型归属需要调整，只可在 `runtime-ingress.ts` 做兼容类型 import/re-export。新实现/类型必须只有一个来源和一个 proof WeakMap，协议 v1 与全部旧调用行为不变。此提取属于本轮明确的 ownership 例外，主 Agent 不同时改这两处；其它 coordinator 文件仍只读。若不需要提取，保留现状并用注入的 transport factory 组合。

root lock、公共 wire/schema、core、产品 SQLite/迁移、UI/Broker/生产 HTTP 不属于你。独立 Runner 不得打开产品 DB writer。

## B1. 一次收拢 Journal 与运行时边界

完成 [三项完整性修复](../g1-agent-b-journal-followup.md)，并从写入到恢复到 ACK 全链路验证：

- 完整写循环/fsync 后才返回；任意不确定 I/O 毒化 handle，不能在损坏前缀后继续成功追加。
- whole-file framing、terminator、长度/总量、timestamp、完整 CriticalFact 和 strict kind/value/身份、连续序列、同 ID 冲突都先校验，损坏不退化成普通成功前缀。
- verified snapshot 与显式 audit salvage 分开；打开后被修改/损坏、poisoned handle、partial tail 与 corruption 都覆盖。普通 entries/replay 路径在首个 sink call 前拒绝未验证批次。
- live/replay 均验证同 fact 的 persisted=true ACK；未知业务发送先 reconcile，不能重发原副作用。
- 进程所属组、PID/start marker、`ps` 失败/overflow/解析失败、leader exit/descendant、无资源和停止 deadline 如实处理；控制 pump 在等待答案/写 ACK 时仍可取消。

保留已有 148 项并运行全部三份主线探针；最终以 committed source 为证据。不要只让特定探针变绿而留下旁路。

```sh
node tools/bootstrap/review-journal.mjs --runtime "$PWD"
node tools/bootstrap/review-journal-followup.mjs --runtime "$PWD"
node tools/bootstrap/review-journal-integrity.mjs --runtime "$PWD"
```

## B2. 把实际 AttemptRunner 接进独立进程

交付可以由组合根启动的实际 per-attempt Runner 服务和 RunnerHost，不再只用 main 的 ticker/backend fixture 证明生存性：

1. 复用现有 AttemptRunner、DriverKit、ProcessHost、已通过的 Journal。明确 spawn/bootstrap/ready/resource registration 的顺序；业务 begin 只允许一次，准备策略失败时不执行。
2. 实现 [桥接边界](../../docs/rfcs/WP-16/0001-wave-02-integration-boundaries.md)：结构化 bootstrap/spec、payload 访问、FactSink/ACK、独立存活、查询/取消和有界退出。协议 envelope 派生现有类型并锁版本，不能借桥接创建第二套业务命令或自行写产品 DB。
3. 注册仍由主 Agent 的可信 launcher 入口使用真实认证 proof 完成；一个 attempt 一个 endpoint/凭据，不在重连时换端点或重新 launch。RecoveryRunnerPort 必须有不可逆关闭的 admission、完整 owned inventory 和真实静止证据。
4. coordinator 掉线时未获平台 ACK 的关键事实保留在有界 Journal；恢复先暴露 verified snapshot，再由主线恢复入口应用。不得伪造平台持久回执或恢复后自动 begin/deliver/answer。
5. 用真正的 fake-native 协议子进程验证：运行、集中提问/等待、回答、取消、配置漂移、stderr/progress 压力、ACK 断点、coordinator SIGKILL、Runner 丢失与 PID/endpoint 变化。服务和进程组必须可归属、可清理。

发布 **一个 runtime-host 检查点 commit**：稳定导出/桥接接口、独立进程运行样例、测试、身份/清理限制、依赖请求。随后直接继续 B3/B4；主线适配器未接受前用严格的 fixture coordinator port 测模块，不宣称生产链路通过。

## B3. 接入平台与策略准备

实现 WP-06 的 Catalog/Profile/PolicyPreparation，不依赖三个真实 Driver 才接受通用模块：

- 可信 executable/argv/version/config 身份，Profile 版本与 capability evidence；分开表示 missing、needs_setup、needs_auth、incompatible、inspection_passed、native_test_passed。
- required features、真实策略 enforcement/verification、attempt/epoch/fingerprint gate；未准备/仅 advisory/未测不能静默获得执行资格。
- 二进制/配置/权限策略漂移令旧准备记录失效并 hold/reconcile，诊断和取消继续可用。
- 给 Codex、DSH、ZCode 配 draft Profile/fixtures 与接入指南，未实测能力明确 NOT_TESTED。Catalog 数据经公共 port 输出，不为 UI 定义私有品牌解析。

探针优先只读 version/help/schema，不读私有 token、不重置原生 home、不升级用户全局安装。必要持久化通过 A 的 repository 请求，不能自开 DB。

## B4. 首个 Driver 连通协议

首个目标继续按原计划使用 Codex；DSH/ZCode 留在后续真实协议验证。按 WP-07 固定安装版 schema/hash、官方协议依据与版本，不把别的 SDK JSON-RPC 当 ACP。

实现 initialize/线程/turn/item/request 身份链，begin/deliver/answer/cancel、关键事实、usage 与 reconcile；原生 string/integer request ID 无损保留。按工具 provenance 分类问题和权限，回答必须带当前 target/connection epoch，权限逐请求且不跨连接自动重放。

先完成 parser/goldens、真实协议 fake server、AgentDriverV1 conformance、实际 Runner 服务上的协议流程。真实模型 smoke 只在已有明确授权的 scratch/预算内执行；没有条件就把 native lane 标 NOT_TESTED，继续完成其它交付，不阻塞整个包也不声称原生支持。

## 整包验收与报告

- B1 全部旧/新探针和对旁路的回归通过；B2 是实际 AttemptRunner 的独立服务证据，区别于 main 的受控 host fixture。
- B3 的配置/能力/策略门槛在缺失、认证、版本、漂移、失败场景准确；B4 的协议测试与 native compatibility 分开记录。
- 提交源码、接口/启动样例、source lock、semantic map、兼容表、依赖与持久化请求、真实命令/结果、清理方法和限制。测试数不替代行为验收。
- 不新写 LLM/tool loop，不实现 UI、QuestionBroker 或第二个协调器；不自动合并/部署，不使用生产项目和未知预算。
- 各阶段可独立 commit/push，外部只需一次 runtime-host 检查点和一次整包交付；真正跨契约/权限边界的阻塞一次汇总。只 push 本分支，不 push main。
- 在 `apps/runner/reports/wave-02-progress.json` 持续更新 B1/B2/B3/B4 状态、tested source commit、接口检查点、测试证据和 native NOT_TESTED 项，供主线直接读取；区分代码提交与后续报告提交。
