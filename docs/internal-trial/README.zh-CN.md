# 内部试用操作手册（同事版）

本手册只覆盖**只读预检、诊断和有限观察**。安装、升级、启动、停止、迁移仍走产品自己的 `pa` 入口和已准入流程；本工具不会替你做这些动作。

## 0. 开始前

准备三样东西，全部由你显式提供：

1. 一个包：发布清单里给出的 `*.tar.gz`，或已经展开的安装目录；
2. 一个**全新**输出目录（工具会创建为 0700，拒绝覆盖）；
3. 需要看 readiness 时：你自己实例的 loopback 地址，以及你自己的 0600 token 文件。

不要指向你正在使用的默认数据根，不要让工具去“找”实例、端口、socket 或 `~/.codex`。工具不会这么做，也不需要。

## 1. 先核对包身份

从发布清单抄下 `tar SHA-256`、`bytes`、`buildId`、`schema`、`source commit`。预检会重新计算并核对，提供 `--artifact` 时还会核对 closure digest、install/release manifest 摘要。

目录名和 tag 不是身份。两个 `waveXX-target-*` 目录里放错包，预检会拒绝。

## 2. 只读预检

```bash
node tools/trial-kit/bin/trial-preflight.mjs \
  --tar <你的包.tar.gz> --artifact <同目录 install-artifact.json> \
  --expect-sha256 <hex> --expect-build <buildId> --expect-schema <n> --expect-source <40hex> \
  --out <全新目录>
```

看三处即可：

- `preflight: OK|DEGRADED|REFUSED`；
- `checks: PASS=… FAIL=…`，FAIL 的 id 就是拒绝原因；
- report 里的 `refused` / `unknowns`。

`DEGRADED` 常见于“本机 SQLite 版本尚未在预检阶段验证”（`host_sqlite` UNKNOWN）或平台/ABI 未测量；它不是完整性失败。任何 `FAIL` 都是拒绝，不要绕过。

## 3. 机器检查与 readiness

当前 main 工作台（a302ddc）已在默认主对话旁提供“试用准备”导航：只有认证 ready 且你打开该视图时才读取一次 readiness，四个按钮分别打开原模型设置、原项目导入、原执行器目录和原主对话。它们不是新的派工/授权入口；配置、派工、问题和接受仍走原命令。

readiness 只报告配置事实；缺包身份时报告 `package_binding: unknown`。包内命令只在完整性通过后执行；`REFUSED` 不会运行 `help/status/doctor`。


```bash
node tools/trial-kit/bin/trial-machinecheck.mjs \
  --tar <你的包.tar.gz> --artifact <install-artifact.json> \
  --expect-sha256 <hex> --expect-build <buildId> --expect-schema <n> --expect-source <40hex> \
  --out <全新目录>
```

它会在本次新根里只读运行包内 `pa help`、`pa status --json`、`pa doctor --json`，并生成：

- `machinecheck-report.json`：逐项检查；
- `diagnostics-bundle.json`：脱敏后的诊断材料；
- `reproduce.txt`：最短复现命令。

包内 `doctor` 的 `release_manifest`、`console_assets`、`runtime_dependencies`、`source_identity`、`runtime_abi` 必须 PASS；`instance/state/ports/executor/review_executor` 在空根下是预期 WARN，不是失败。

若你确实有正在运行的**自己**实例，可追加：

```bash
--readiness http://127.0.0.1:<api-port> --token-file <你的 0600 token>
```

readiness 只代表配置事实：它不含包身份（报告会写 `package_binding: unknown`），也不是执行许可。需要防陈旧/防串包时加 `--expect-configuration-revision <hex>` 与 `--max-observation-age-seconds <n>`。

## 4. 收集问题

- 先看 `machinecheck-report.json` 的 `refused` 与 `unknowns`；
- 把 `diagnostics-bundle.json`、`reproduce.txt` 和**原始命令/exit code**一起发给维护者；
- 不要手工粘贴 token、对话正文、个人绝对路径；诊断包已脱敏，仍请快速扫一眼；
- `pa support` 不会自动运行，因为它会在有数据库时以可写 pragma 打开数据库。请在自己的副本上运行后，用 `--support <file>` 引用；或让工具在“空的自有新根”上采集。

## 3b. wave-29 current source、可信出生与原交付

- `tests/operational-soak/selected/produce2.mjs` 以当前 I/B/H commits 物化 exact source，不 pin 旧 head；先 source 拒绝再 import/执行。
- I current 12/12（含 fresh intent/namespace/prune）；B current 三回调通过。wave-29 看到的 **sink-only guard 自批是旧 B 范围**，当前 B（205076f）已改为 missing/deny/throw 拒绝、每次 intent fresh guard，produce2 的 8/8 正向即为当前语义。
- `procguard/produce3.mjs`（wave-30）是当前安全 helper：WeakMap + 不可变 birth facts + handle；仅注册 handle 可 signal，root/config/operation 与 spawn 精确匹配，ps UNKNOWN 不等于 gone。
- 旧 `procguard/produce2.mjs` 仅保留历史材料；它返回的 record 与内部共享，不能作为当前 helper 使用。
- 原交付：question/answer→currentCandidate→manual accept→delivered；begin/answer/accept 同 commandId 重放均幂等；2/4 works 观察有，native slot 资源集 NOT_REACHED。
- 包：1fbaf94（6849 项）只作只读预检输入。
- 仍未达：same-Runner route、SIGKILL 原问答、recovered candidate/accept、真实产品 readonly/SSE。

## 3c. wave-30 不可变 handle、current I/B 与原 A 读回

- `tests/operational-soak/procguard/guard3.mjs` 关闭 wave-30 P1：registry 以 opaque handle 为 WeakMap key，只保存 private deep-frozen birth facts；返回的 observation 是防御性副本。修改 pid/argv/root/config/operation/birth/plan、伪造或复制 handle 都不会改变目标。
- 每次 TERM/KILL 都重新核完整 identity（PID/start/UID/command/argv/root/config/op/birth/resource plan）；`ps` 失败/不可解析保持 UNKNOWN，`waitGone` 不返回 gone。
- 运行顺序固定：先 `mockSuite()`（0 spawn/0 signal/0 ps），再 `pureControls()`，最后只对本 run 的 own probe 发有限 TERM/KILL；不重跑旧 SIGKILL/procguard/long soak。
- `tests/operational-soak/selected/produce2.mjs` 绑定当前 I/B commit：I 12/12、B 8/8（含 missing/deny/throw 与 fresh allow），source/materialized 前后不变。
- `selected/produce-original2.mjs` 用原 Application/QuestionBroker/A Store 生成并读回同一 Work/question/answer/attempt/native_applied；**B sink 的 runner facts 未接到该 question/answer ingress**，business ingress join 明确 NOT_REACHED。
- `delivery/windows2.mjs` 用原 A facts/answers/deliveries 判定 begin/answer 写前、receiver 后 receipt 前、durable、written、terminal、missing delivery 与 late duplicate；所有窗口 `resend:false`。
- `delivery/resources2.mjs` 只有每个已知资源都有 end evidence 才称 quiescent；`module.close`/parent gone 单独不算，UNKNOWN/缺 plan 不放行。

当前精确包 `wave30-target-8296720`（build `8296720d8a25f38c`，source `82ee5b8f`）的只读预检为 `DEGRADED`：32 PASS / 1 UNKNOWN（host_sqlite 需运行包内 doctor）；绑定 machinecheck 为 46 PASS / 3 UNKNOWN（host_sqlite、package_binding、support.reference），0 FAIL。`pa status` 在新空根返回 `STOPPED` exit 2，`doctor` 因无 managed instance 为 DEGRADED，这是空根预期而不是功能失败。

## 4. wave-28 selected source、信号与原交付

- **唯一实现边界**：当前 B 有自己的 business channel，尚未导入 I 的 attach-channel，不能称“唯一通道已合一”。H 的 `tests/operational-soak/selected/` 只按 admitted commit 物化并消费实际模块，错误 root/blob 在运行前拒绝。
- **安全信号**：`tests/operational-soak/procguard/` 是唯一可复用的出生/fresh helper；B 旧脚本在采用该 helper 前不要跑。只允许本次 spawn 的 probe，TERM 后 KILL 必须 fresh 再核；unknown 保留，不按 PID 盲杀。
- **原交付读取**：WorkView 身份是 `view.work.id`；候选/接受走原 `currentCandidate` 与 `accept_candidate`，2/4 slot 在该 fixture 无 cap 配置，native slot 资源集 NOT_REACHED。
- **当前包**：1cd（6759 项）只作只读预检输入；不是 installed/release 结论。
- **仍未达**：B runner-service 使用 I 唯一通道、同 Runner 双 client、SIGKILL 原问答恢复、真实产品 readonly/SSE。

## 4a. wave-27 渠道与消费者输入

- 当前 main（`967dc0c`）把试用观察绑定到 transport/auth identity：切换 identity 会立即隐藏旧观察并忽略晚到结果；这是 UI 观察键，不是 token 或权限。
- `tests/operational-soak/channel/` 提供共享 `CoordinatorChannel` 的合法 frames、拒绝边界，以及真实 B stdio bridge 上 fact ACK / payload / native-write guard 的 actual 计数。I 的 attach-channel、同 Runner 双 client、SIGKILL 恢复仍 **NOT_REACHED**，不要把它们当成已可用能力。
- 项目配方（J）尚未进入本指南；在 main 明确接入原草稿/确认链前，不要向同事演示“自动生成项目模板”。

## 4b. 合法恢复输入（给 B/main）

`tests/operational-soak/recovery/` 提供合法零模型输入包：真实 Work/Attempt/Question/Answer/native_applied、原 producer 生成的 journal、原公共 reader 和已准入 recovery port 的正例/故障。它**不包含**业务 attach/begin/deliver/answer 与 SIGKILL 恢复，`businessResume` 明确 `NOT_REACHED`。详见该目录 `README.zh-CN.md`。

## 5. 有限运行观察

```bash
node tools/trial-kit/bin/trial-soak.mjs --scenario mixed --duration-seconds 600 \
  --poll-ms 1000 --sse-interval-ms 1000 --reopen-seconds 60 --sample-ms 2000 \
  --out <全新目录>
```

输出 `run.json`（实际开始/结束/elapsed、请求数、延迟、重连、重开、失败、unknown、cleanup）与 `samples.ndjson`（资源时间序列）。`resume.txt` 给出续跑命令。

这只是**一次有限 fixture 场景**：不是 24/48 小时稳定性证明，也不代表 daemon 恢复、provider/队列稳定或真实模型/native。

## 6. 交给验收

H 的材料是原始观测。E 会按自己的 required 断言独立核验；不要把本手册的 `OK`/`DEGRADED` 当作发布结论。材料目录保持只读引用，不要覆盖历史运行。

## 3d. wave-31 独立原证据、包内 backup/restore 与 R1/R2

- **安全工具（H1）**：`procguard/guard3.mjs` 的出生失败路径不再调用 `child.kill(SIGKILL)`。`failure.json` 记录 `observation_unknown` / `birth_report_missing` / `identity_mismatch` 三种失败，`childKillCalls=0`、`processKillCalls=0`，probe 材料保留且 `signalSent=false`。完整出生才允许经注册 handle 和可注入 kill 发送；每次 signal 前 fresh 全身份。
- **当前消费者（H2）**：`selected/produce2.mjs` 绑定 B `fbc933166758` / I `4bce0673388f` / main 0080，当前 I 12/12、B 8/8；旧 sink bug 只保留历史，不再是绿色条件。H 不使用 main 的 NativeProductAttempt 真实 guard，因此 main guard join 仍标 NOT_REACHED。
- **原 Store（H3）**：`selected/produce-join2.mjs` 用同一原 Application/QuestionBroker/A Store 产生 Work/question/answer，并在同一 Store 做事实 subject 校验与 durable receipt；foreign work/attempt/source/version 全部写前拒绝。真实 B 三回调写入该 question/answer 仍 NOT_REACHED。
- **普通交付（H4）**：`delivery/produce.mjs` 的 normal 问题→native_applied→registered check→currentCandidate→显式 accept→delivered 4 artifacts 是 ordinary 基线；错 candidate 被 `verification_failed` 拒绝；recovered 不等于这条基线。
- **新进程读回（H5）**：`recovery/produce-successor2.mjs` 由子进程 A 生成原 Work 并退出，子进程 B 读取同一 `state.sqlite` 的同一 IDs；旧 PID 已退出、B PID 不同。它不是 B coordinator/Runner 恢复。
- **ACK/资源（H6/H7）**：`delivery/windows2.mjs` 用原 A facts/answers/deliveries 判定 durable/written/UNKNOWN，所有窗口不重发；`delivery/resources2.mjs` 只有 9 类资源全部有 end evidence 才 quiescent，`module.close`/parent gone 单独不算。B 实际崩溃窗口与 2/4 native slot 仍 NOT_REACHED。
- **精确包（H9）**：R1 `8296720`（tar `04926739…87543`，source `82ee5b8f`）预检 32 PASS/1 UNKNOWN，绑定 machinecheck 46 PASS/3 UNKNOWN/0 FAIL。R2 `4dcd28f`（tar `405ecd02…addcc6`，source `c0a1f897`）同样 32 PASS/1 UNKNOWN 与 46/3/0；R2 是 303b2c6a 后继冻结，不是把旧包改 label。
- **同包 backup/restore（H11）**：`package/produce-restore2.mjs` 在 R1 与 R2 包内执行 `backup → verify-backup → restore` 到新根，再用原 A public readers 读到同一 Work/question/answer/native_applied；再次 restore 同目标 `BLOCKED target_not_empty`，缺 bundle 与空 state 均拒绝。`review-restored` 启动/REUSED 路径 NOT_REACHED。
- **只读/多根（H10）**：`package/produce-readonly2.mjs` 在两个新私有根运行包内 `status`/`recovery-status`，根隔离、STOPPED、marker absent 不等于授权、queue never；包内实际 HTTP/SSE 内容入口未启动，标 NOT_REACHED。5 秒 fixture soak 只作独立 SSE 工具观察，不是包 daemon。

所有材料在 `reports/trial-operations/wave31/`；R1/R2 结论分列。H 观察不是 E required、安装准入、native 兼容或 release 结论。

## 3e. wave-32 现场工具与完整工程试用

- `tools/trial-kit/bin/trial-field-kit.mjs` 把准确包 machinecheck、可选当前 I/B source consumer、脱敏 `support-summary.json`、`FIELD-NOTES.md` 和 `manifest.json` 收在一个新根；不安装/启动/停止/迁移，恢复与 native 明确 NOT_REACHED/NOT_MEASURED。
- 一键流程与故障树见 [wave32-trial-checklist.zh-CN.md](wave32-trial-checklist.zh-CN.md)。R1/R2 的 tuple、已知 UNKNOWN 和可分享/不可分享材料已写在该页。
- 新 P1 已封闭：guard3 现在要求独立 launch executable/有序 full argv 与观测 `command` 完全一致；缺失、前缀、ambiguous、观测失败均拒绝登记，出生失败不发送任何信号。
- 当前 I/B source consumer 仍是进程内证据；安装包内 B/I 端口、原 Work 恢复、scheduler 2/4 槽和 review 启动没有因 field kit 变成已支持。
- wave-32 安装态 lifecycle（R1/R2）已实际 first-run/start/readiness/health/console/SSE/REUSED/同一 Work 重开/stop；但包内 `accept_candidate` 对 fixture Work 返回 `Trusted artifact review is unavailable`，安装态人工接受仍 NOT_REACHED。
