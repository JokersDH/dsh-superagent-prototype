# 04 Agent 运行时与扩展规格

版本：方案 B 基线，2026-11-07。本文是实现约束，不代表三个厂商接入已经通过运行验收。首批目标为 ZCode、DeepSeek Harness、Codex；CAC 后续接入。

## 1. 范围与唯一所有权

复用 superagent 的核心工作生命周期。产品中的 Work 是根 Ticket 的元数据与派生视图；Assignment 是一次派工，Attempt 是与 Assignment 关联的受控运行绑定。不得新增另一套独立任务状态机或由 Driver 自建 Work 数据库。

术语固定：核心 `Decision` 仍表示接单/路由判断；用户的结构化问题为 `UserQuestion`，由 `QuestionBroker` 管理；明确长期偏好为 `UserDecision`。不能把原核心 Decision 表重用为问题表。

应用层保留 `dispatch / inspect / changes`；驱动层固定 `inspect / serve / reconcile`。Supervisor 承接核心 `Executor.start / deliver / stop` port，将其转换成事务后的外部执行，而不是重写核心的接单、续接和授权规则。

复用依据见 [core ports](../src/core/ports.ts)、[Engine](../src/core/engine.ts)、[事务 Store](../src/app/store.ts)。Driver 不直接调用 Engine，不直接修改 Ticket、Assignment、决定或问题状态。

```text
Kernel / Engine（唯一工作生命周期）
  -> Executor port -> durable effect -> AttemptSupervisor
  -> owned Runner -> bundled Driver -> native agent
  <- fenced CriticalFact <- Runner
  -> 事务核对后调用核心事实入口
```

第一版一个协调器拥有调度与持久写入。每个 attempt 默认独立 Runner；是否独立原生进程由 ownership 明确决定。共享服务不能靠关闭一个连接来证明整个服务已终止。

## 2. 代码归属与并行实现规则

下列为目标模块归属；共享契约的准确文件由总架构契约章统一冻结，Driver 作者不得直接扩展公共 schema。

| 模块/目标路径 | 所有者职责 | 禁止越界 |
| --- | --- | --- |
| 核心 Executor bridge | 把核心 port 转为 effect，将 fenced 事实回送核心 | 不出现 vendor 品牌分支 |
| `apps/runner/` | 进程、IPC、控制优先级、资源和受限 journal | 不判断 Work 验收或长期学习 |
| `packages/driver-kit/` | Driver host、规范化命令/事实辅助、稳定错误和 fixture harness | 不持有核心 DB writer，不决定用户批准 |
| `packages/drivers/codex-native/` | Codex schema、协议序列、原生映射和该产品 fixtures | 不改其他 Driver 与产品 UI |
| `packages/drivers/acp-v1/` | ACP v1 协议、SDK 适配、DSH profile 验证材料 | 不把 DSH SDK JSON-RPC 当 ACP |
| `packages/drivers/zcode-native/` | ZCode 安装版 wire 对齐、解析、映射和 fixtures | 不假定兼容 Codex/ACP |
| `packages/testing/` | 通用故障子进程与契约 runner | 不把 fixture 通过称为厂商兼容 |

三个 Driver agent 可在共享契约和 Runner fixture 冻结后并行工作，各自拥有本模块源码、goldens、单测和兼容报告。需新增语义时提交 RFC，说明旧契约无法表达的事实、兼容方式和失败场景，由契约所有者合并。

## 3. 驱动 interface

```ts
interface AgentDriverV1 {
  inspect(profile: AgentProfile, host: ProbeHost): Promise<ProbeReport>;
  serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit>;
  reconcile(ref: RuntimeReference, host: RecoveryHost): Promise<ReconcileReport>;
}
type AttemptIO = {
  commands: AsyncIterable<RunnerCommand>;
  record(fact: CriticalFact): Promise<DurableReceipt>;
  publishProgress(update: ProgressUpdate): void;
  runtime: OwnedProcessHost;
};
type RunnerCommand = {
  id: string;
  ticketId: string;
  assignmentId: string;
  attemptId: string;
  fenceEpoch: number;
} & (
  | { kind: 'begin'; inputRef: string; preparedPolicyRef: string }
  | { kind: 'deliver'; inputRef: string; expectedTurnRef?: string }
  | { kind: 'answer'; nativeBindingRef: string; answerRef: string }
  | { kind: 'cancel' }
  | { kind: 'pause_at_boundary' }
);
```

以上是产品规范化契约摘要，不是厂商原生类型。公共类型只在共享契约中定义一次。三个方法不能掩盖有限命令、顺序和错误的复杂性。

- `inspect`：默认仅检查路径、版本和配置引用。握手不发送模型任务；会初始化 home/profile 的行为必须作为明确接入步骤。收费 smoke 与发现检查分开。
- `serve`：服务已持久化的 attempt；只有收到合法 begin 才能执行业务。等待模型、工具或用户时仍处理 cancel/answer，不把长 Promise 变成控制通道锁。
- `reconcile`：核对原生运行、进程身份、journal 和产物，不发新业务。返回 running、terminal、missing、indeterminate 及证据引用；不能通过重新执行伪装恢复。
- Driver 返回值不表示 Work 完成。Native turn 结束、候选产物、验证通过与用户接受是不同事实。

## 4. Profile、能力与配置身份

AgentProfile 包含可信 executable/argv、Driver release/API version、原生配置引用、认证方式、权限策略 revision、预期引擎版本和 requiredFeatures。Profile 不携带 raw token、自动批准脚本或“支持全部能力”标志。

兼容记录必须同时绑定：

```text
profile revision + executable identity/digest + native agent version
Driver release/API version + SDK version/import entrypoint
wire major/schema hash + resolvedConfigFingerprint
permissionPolicyRevision + configStability + tested capability snapshot
OS/architecture/runtime + report timestamp + evidence refs
```

配置摘要只包含非敏感的有效配置和引用身份：bundle/profile/patch revision、相关 argv、环境引用元数据和权限设置。不得把密钥值或密钥散列放进兼容报告。

| 能力 | 至少区分 | 禁止推断 |
| --- | --- | --- |
| 恢复 | 无、历史加载、原生恢复 | 新建上下文包不等于恢复旧 Session |
| 运行中输入 | 无、下一 turn、原生 steer | stdin 可写不表示可安全 steer |
| 问题 | 未知、结构化工具、form、URL | 支持权限请求不等于支持业务澄清 |
| 暂停/取消 | 停派、检查点暂停、取消请求、原生确认 | cancel 已写不等于 writer 静止 |
| 文件限制 | advisory、approval-guarded、enforced | cwd/worktree 不等于 OS 沙箱 |
| 事件恢复 | 无、Runner journal、原生 cursor/replay | journal 只覆盖实际收到的事件 |

每项保留 advertised、observed、test（PASS/FAIL/SKIPPED/NOT_TESTED）、policy 和 evidenceRef。Profile 硬下限不能被 UI 静默豁免；完整交互任务额外需要实际通过的业务提问链路。

## 5. 开始执行前的原生权限准备

```ts
type PreparedExecutionPolicy = {
  ticketId: string;
  assignmentId: string;
  attemptId: string;
  fenceEpoch: number;
  requestedPolicyRevision: string;
  nativeAppliedSettingsRef: string;
  effectiveConfigFingerprint: string;
  enforcement: 'enforced' | 'approval_guarded' | 'advisory';
  verification: 'passed' | 'failed' | 'not_tested';
  evidenceRef: string;
};
```

顺序固定：受理派工、预留工作区、启动受控 Runner、握手/认证、映射原生权限、持久化 `policy.prepared`、Supervisor 核对同一绑定与任务要求、最后发送 begin。

映射失败、版本不符或无法表达限制时不开始。把范围写进 prompt 只是一条指令，不能冒充原生权限已经生效。认证与 bootstrap 不能偷偷运行用户业务任务。

真实 smoke 必须验证一个明确禁用且无害的动作被拒绝或要求授权，同时验证允许动作仍可执行。后续 HMR/配置漂移使对应准备事实失效；停止新业务输入并核对，不继续复用旧准备记录。

## 6. Runner 提供的 implementation

- 直接 argv 启动；路径解析与身份核对；stdout 协议和 stderr 诊断分开。
- 有界分帧、UTF-8 解码、最大帧/逻辑消息限制、退出与 EOF、启动/请求/取消期限。
- 独立接收 pump 和控制 pump；critical 通道保留容量，progress 合并不阻塞控制。
- OwnedProcessHost 登记 PID、启动身份、nonce、进程组、原生 run/session 和预览资源。
- 普通进度是尽力而为；问题、权限、受理、取消、结束和产物身份必须经过 durable critical-fact 通道。
- 协调器暂不可用时受限 journal 只保留必要事实，不无限积压；不得伪造 durable receipt。恢复后按稳定 factId 重送。
- 认证材料、MCP headers、完整 native config 不进入普通日志；raw wire 调试默认关闭，脱敏导出有范围。

Driver 作者只提供协议解析、方法序列、事件分类、原生控制与恢复证据。Driver 不持有数据库、不调用 UI、不批准权限、不判定最终验收、不启动自己的常驻调度器。

## 7. 核心复用与 fenced 事实入口

```ts
type CriticalFact = {
  factId: string;
  ticketId: string;
  assignmentId: string;
  attemptId: string;
  fenceEpoch: number;
  source: string;
  kind: RuntimeFactKind;
  nativeRef?: string;
  payloadRef: string;
};
```

核心、runtime binding、inbox receipt 和 effect 使用同一事务存储。Ingress 在同一个同步事务中去重、核对当前 Ticket/Assignment/Attempt/epoch、保存事实，再调用相应核心事实入口；事务内不 await 外部 I/O。

**强制修正点：** 现有 `Engine.report(ticketId, report)` 不带 assignmentId，会写当前 Assignment。未经上述原子 fence 的原生报告严禁进入该 legacy 方法。可以增量增加带绑定的安全入口，但不能只在事务外先检查、稍后调用。

迟到事实可留在 runtime 审计记录；不能改变新派工。重复 factId 不重复回送核心。用户已停止的 Ticket 不因旧 worker 重新报告而恢复。

**原生 completed/end_turn 不直接映射核心 ready。** 原核心对没有跟随 Thread 的 ready 可结束 Ticket。B 版个人 Ticket 必须启用增量的 external completion mode；旧模式对非 B 工作保持兼容。不能制造假的 GitHub Thread 来阻止结束。

候选结果先登记为 Kernel 分配的 candidateGeneration，再进入最终验证。最终确认在事务内核对当前 Assignment、合同与 candidateGeneration，仅当前候选可以触发核心完成。Driver 不分配或覆盖候选 generation，也不能自己确认验收成功。

核心可以立即撤回授权并结束 Ticket，再异步调用 `Executor.stop`。UI 的“停止中/资源待确认”来自 Supervisor 的物理事实，不能从 Ticket.ended 推断所有进程已停止。

## 8. 结果、不确定性与重试

```ts
type NativeDispatch = {
  commandId: string;
  delivery: 'not_sent' | 'written' | 'native_accepted' | 'indeterminate';
  retry: 'same_key_safe' | 'reconcile_first' | 'user_action' | 'none';
  nativeRef?: string;
  error?: { code: DriverErrorCode; message: string };
};
```

稳定错误至少有 executable_missing、version_mismatch、auth_required、unsupported_capability、protocol_error、rate_limited、transport_lost、process_exited、budget_exceeded、state_indeterminate。

错误类别与发送结果独立。超时、EOF、退出可能发生在业务已受理后；不能统一重试。same_key_safe 需要原生幂等证据或平台可证明尚未发送，仅稳定本地 commandId 不足以保证外部副作用去重。

退避有限、有 jitter、遵守可用的 Retry-After。认证故障停止付费重试，保留工作并提供原生登录入口。启动回执丢失先 reconcile；不能把重新 launch 当作无害恢复。

## 9. 问题、权限与认证 UX

所有请求都绑定 attempt、合同版本、connection epoch 和 native request ID。先持久化问题再通知主入口；先持久化用户答案再派发 response。

| 请求 | 规则 |
| --- | --- |
| 业务澄清 | 同义和作用域均一致时可共享答案，逐 target 保留送达结果 |
| 原生权限 | 保存工具、参数、原始选项和范围；不沿用另一请求的批准 |
| 认证/URL | 展示原生安全流程；打开 URL 的同意与认证完成分开 |
| 来源不明 review | 保留人工审查，不归类成可复用事实 |

响应等级为 local_recorded、response_written、native_applied（仅有实际可观察证据时）。ACP response 写出没有额外持久消费 ACK；Codex resolved 也可能是清理，不能据此虚构应用结果。

断线后旧 JSON-RPC ID 不可跨连接回复。普通语义答案可在新有效绑定下接续；权限和认证需新的合法原生请求，不能自动重放旧批准。一个 target 成功不覆盖其他 target 的不确定状态。

原生账号由各产品管理。专用 home 与用户已有账号的关联仅使用厂商支持的方式；不自动读取、复制桌面私有 token 文件。用户看到“已安装、需登录、已通过只读检查、当前任务可用”等具体状态，不得到一个含混绿灯。

## 10. 取消、检查点与实际 writer

1. 核心结束授权/撤销待输入，Supervisor 记录 stop_requested 并走优先控制通道。
2. Driver 发原生取消；记录发送与确认，继续接收可能迟到的原生更新。
3. Runner 核对进程组、工具、子任务与登记预览资源；协议 turn 取消不自动等于全部资源静止。
4. 无法确认时保持 indeterminate。新副本也不能隔离远端写入或共享 git 元数据，仅允许确有能力限制的只读/patch-only 接续。
5. 确认静止后冻结 commit、dirty diff、必要文件和环境；下一 Assignment/Attempt 获得新 epoch 与工作区。

检查点至少标注 native context 是否可恢复、代码快照、环境、外部副作用和未决问题。仅 git snapshot 或 conversation fork 不能被标成完整环境重放。

ownership 必须区分 spawned_process 与 shared_service_session。前者可管理自己的进程组；后者只能取消/关闭自己拥有的 session，不能 kill 共享 service 或其他用户工作。

## 11. 首批目标的证据与 spike

| 目标 | 当前静态证据 | 不能当成已验证能力 |
| --- | --- | --- |
| Codex | 安装版 0.164.0；本机导出 320 个 schema；官方 app-server 文档 | 认证、真实 turn、问题、权限、取消和后台资源均未实跑 |
| DSH | 安装版 0.2.1-rc.2；官方 `dsh --profile acp` 与 `sdk` 入口 | master/较新 rc 的全部能力不能套到安装版 |
| ZCode | 安装版 0.16.5；官方源码 commit `aac4755...` 可见 | source CLI 0.1.0 不保证对应安装版；v4 模块内 wire=3、projection=1，且草稿未冻结 |

每个 spike 必须独立完成：identity、配置/home bootstrap、握手/schema、认证状态、scratch session、允许与禁用动作、结构化问题及拒绝/取消、运行中停止、原生状态核对、断线恢复。没有执行到的场景写 NOT_TESTED，不补绿色结论。

### Codex Native agent 的交付

- 以安装版生成 schema 编译 parser，固定 method 白名单与 schema hash；不把最新网页字段盲套到旧 CLI。
- 映射 initialize/initialized、thread/start/resume、turn/start/steer/interrupt，以及 thread/turn/item/request 来源。
- command/file/permissions 批准与 requestUserInput、MCP elicitation 按真实工具来源分类。requestUserInput 也可能承载 connector 副作用批准。
- 以真实 scratch turn 验证结束/取消/后台资源；保留 stdout 与 stderr 独立证据。详细方法名差异以安装版 schema 为准。

### ACP v1 / DSH agent 的交付

- 使用官方 TypeScript SDK stable v1 入口；所读 SDK 2.4.0 的默认仍是 v1，v2 有单独实验入口，SDK major 不等于 wire major。
- DSH 优先以 `--profile acp` 复用通用 Driver；专用 home、bundle/profile/patch 身份纳入 fingerprint。bootstrap 不覆盖用户现有环境。
- load/resume/close/elicitation 各自核验；form/url 显式协商，`{}` 不代表 form 支持。缺业务问题能力时降级，不能猜终端问句。
- `session/cancel` 等原 prompt cancelled response；通用 `$/cancel_request` 与嵌套取消传播是可选机制，不据此宣称全部子进程已停止。
- 能力不足再评估原生 SDK Driver；SDK JSON-RPC 方法不是 ACP 方法。sdk-minimal 的工具与权限不同，不作为完整助理默认。

### ZCode Native agent 的交付

- 首先对齐安装版 launcher、engine、wire/schema、事件和 interaction，不复用同名的 Codex app-server Driver。
- 公开 design/v2 只作线索，按当前 server、transport、shared v4 core 与安装版实际响应验证。
- 专门捕获 projection/replay、interaction binding、stop 与 background cancellation 的 goldens；不能混用 package、module、wire 和 projection 版本。
- headless 帮助的 yolo 默认不能成为平台的隐含权限。没有通过 prepared native policy 就不 begin。
- 若安装版与公开源不能匹配，维持实验/未就绪状态；不能借源码可见声称有稳定外部 API 承诺。

## 12. 三个 Driver agent 的独立验收包

每个模块提交同样结构的材料，允许三个实现并行评审：

```text
driver/<vendor>/
  semantic-map.md       发送、受理、结束、取消、问题、权限、恢复映射
  source-lock.json      官方来源、commit/schema、安装版与 digest
  fixtures/goldens/     脱敏原生请求/响应/事件及 normalization 期望
  tests/                parser、mapping、真实子进程 fixture、contract tests
  reports/native.json   每个产品/版本/配置的 PASS/FAIL/SKIPPED/NOT_TESTED
  reports/recovery.md   具体故障窗口、核对来源、剩余不确定性
```

Goldens 必须包含：拆帧/UTF-8、未知通知、错误、EOF、问题来源、decline/cancel、过期绑定、取消迟到更新、受理后丢回执、版本不符。生产日志材料只能经有范围采集并脱敏，不能直接搬用户整个原生会话目录。

Native 报告至少记录 agent/Driver/SDK/schema/配置/权限版本、OS、命令资产身份、capability 声明、实际测到的能力、证据与费用。模拟 fixture 和实际 native 的结果分开，不用 schema 导出代替运行验收。

## 13. 通用契约用例

| 用例 | 可观察验收 |
| --- | --- |
| RT-01 旧 report 在 retry 后到达 | 新 Assignment 不被 legacy report 修改，旧事实仍可诊断 |
| RT-02 begin 在 policy.prepared 前到达 | 拒绝业务执行，正常 cancel/诊断仍可处理 |
| RT-03 等待答案时 cancel | 控制通道响应，不等待用户或正常 prompt Promise 完成 |
| RT-04 已受理但回执丢失 | indeterminate/reconcile，不重复发起副作用 |
| RT-05 新连接收到旧答案 | 不复用旧 request ID；保留语义答案并重新判断有效性 |
| RT-06 取消已发、writer 未静止 | UI 停止中，不复用其可写目录或重复外部写 |
| RT-07 关键流拥塞 | 问题/权限/结束不丢，progress 有界，停止控制有保留容量 |
| RT-08 profile/HMR 改变但 binary 相同 | fingerprint 失配，旧准备事实失效并进入核对 |
| RT-09 共享服务 session 取消 | 只影响归属 session，不退出别人的 service/work |
| RT-10 native end_turn | 仅产生运行事实，不能绕过最终验证使 Ticket ready |

ACP TCK 可作为补充；它仍实验性且不完整，不称官方兼容认证。默认不做 logout 等账号状态操作。短任务没测到取消属于未覆盖，不是通过。

## 14. 扩展与升级的具体出口

同协议 agent：新增 staged Profile、版本锁、认证引导和兼容报告；当语义完全落在现有子集时不改 Kernel/QuestionBroker/UI。新协议：新增 Driver 与原生 fixture，不复制平台生命周期。

首版 Driver 随应用打包，在 owned Runner 内运行；不动态 import 工作仓库插件或下载脚本。外置 Driver 生态仅在真实需求出现后，通过相同版本化 Runner 契约评估。

升级候选只影响新 attempt；运行中的已记录绑定不静默替换。外部产品/HMR 不能冻结时记录 opaque/observable_drift，不宣称底层配置永远不变。无法观测的限制不能标为 enforced。

回退只改变后续分配，不保证旧产品能读取新原生会话，也不撤销外部副作用。恢复旧备份先 paused/reconcile，绝不把未记回执的动作全部重发。

## 15. 完成定义与证据引用

一个 Driver 完成意味着：实现与类型通过、没有跨包写状态、适用 RT fixtures 通过、对应产品安装版 native 报告齐全、实际权限准备通过、取消/恢复窗口可解释、诊断能给具体动作。首个 beta 可只启用一个完整通过的目标，其余保持准确状态。

未来 CAC 仍使用同一 Driver/Runner/Question/验收契约；拿到新版 sub team 后验证真实接口，不因 CAC 关系熟悉就绕过门禁。

主要原始依据：

- [ACP SDK](https://agentclientprotocol.com/libraries/typescript.md)、[初始化](https://agentclientprotocol.com/protocol/v1/initialization.md)、[elicitation](https://agentclientprotocol.com/protocol/v1/elicitation.md)、[取消](https://agentclientprotocol.com/protocol/v1/prompt-turn.md#cancellation)、[TCK](https://agentclientprotocol.com/libraries/testing.md)。
- [OpenAI 官方 app-server 文档](https://developers.openai.com/codex/app-server)；安装版 schema 位于本仓前期调研的 `research/schemas/codex-0.164.0/`，不是已经运行成功的证明。
- [DSH CLI 官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md)、[SDK guide](https://deepseek-harness.github.io/deepseek-harness/en/guide/python-sdk)。
- [ZCode 官方固定源码](https://github.com/zai-org/ZCode/tree/aac4755666d09fdcd70272fcf063c077a639015f)，重点为 bootstrap server/transport 与 shared protocol-v4 core。
- 本仓既有 `Engine`、`Store.atomic` 与 `Executor` port 是复用和安全 ingress 的实现证据；并非上述规范化 Driver 已存在。
