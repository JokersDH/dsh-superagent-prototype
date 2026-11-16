# B：原应用执行、恢复与调度的两个连续工程包

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`。
保留全部 dirty/history/state/ledger，fetch 并合并最新 origin/main，固定 actual source。
先读 AGENTS、START-HERE、product-spec/README 和[本轮 README](README.zh-CN.md)。
再读[0086：主线原方法回调](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。
主线可消费源码为 `23d5a98e6e75a3b0fb08168431260a9935cf5674`；原class11项与既有4项通过，未执行launch/恢复。

依据[独立验收](../../reports/releases/wave34-admission/runtime-channel.json)，建立/继续一个覆盖两个工程包、六个完整成果的 whole goal。
这是完整工程扩展，不把小修拆成六阶段；不设时长、同日完成或 token 承诺。
source 早发后继续第一包余项、第二包及独立队列，不等每个检查点重新派工。

## 当前输入与所有权

- main 已交真实同 class `readPayload`、`beforeNativeWrite`、`recordFact` 与 optional `attachCallbacks`。
- 正常 stdio 与 attached callbacks 调同一实现，原 current/command digest/live answer map 没有复制第二套。
- 原 void/throw guard wrapper 只有 await 成功才返回 allowed:true；失败 false，不缓存旧 allowed。
- main 已有原 clone `attachPort`，提供于 register/ready/current 通过后；不得再等待 only-data port 或不存在的 `this.handle`。
- 原 numeric PID、literal handle copy、payload reference/body、H command 与 main terminal 反例已关闭，保持回归不重派。
- 新阻断是原型品牌仍可伪造 spawn provenance，以及 raw cancel 外来 source 先改变服务再报 identity_mismatch。
- B 拥有原 execution/catalog/policy-preparation/driver-kit/testing/drivers、Runner/native-acceptance 路径。
- 明确排除 I 的 attach-channel src/test；main 管原应用组合/共享契约/root/config/lock/HTTP/App/transport。
- A 唯一生产迁移，E 唯一产品断言；不改其他 owner 的源或为了验收放宽断言。

## 工程包一：原 authority 下的可靠执行与控制

### B1 原 spawner provenance 与完整受控资源工具

完整成果：从出生到观察、错误留存和受控收尾，工具只承认本次原 factory 发出的资源能力。

- `Object.create(ChildProcess.prototype)`、never-spawn `new ChildProcess()` 与复制 metadata 都不是原 spawn。
- 不再只用 instanceof/字段形状；由 original spawner/factory 发不可伪造的私有 provenance，绑定原对象与 intent。
- 保留数值 PID 拒绝、exact handle identity、完整有序 argv 与 root/config/operation 一致性。
- 本次 PID/start/UID/parent、全部必要 child/socket/fd/timer/waiter/queue/journal 资源来源独立于 observed 值。
- 首次与每次操作前 fresh 全集合；UNKNOWN/缺证/身份变化保留材料，不能靠 ancestry/path/同 UID 收编。
- 公共观察是 defensive copy，不影响 private registry；不能用伪 brand 或调用方 JSON 重建 authority。
- 必须有原 own factory positive 和 plain/prototype/never-spawn/foreign/recycled/mixed-unknown 的独立 negative。
- 纯 mock spy 覆盖 spawn、child.kill、process.kill 与 cleanup，0真实信号；不跑 live SIGKILL/procguard 来补证明。
- 缺完整原 provenance 时停止该物理动作，但继续无信号执行接线、回调和兼容工作。

消费者必须拿到原 factory 当次发出的能力，而非在 signal 前从现有进程反向构造出生证明。
资源集新增或变化需重新核全，不能让 parent 一次登记自动覆盖随后出现的未知 child。

交付：可运行 factory/helper/实际调用者、明确资源集与 source/命令/exit/spy0，供 H/E 独立复验。
不得只加一个 instanceof 后将整个安全工具称完成，也不得把工具准入当 native/发行准入。
第一成果提交后继续 B2/B3，不在工具小修处结束工程包一。

### B2 原 Application/Store/QuestionBroker 三回调完整采用

完整成果：一个原应用创建的 Work 和原问题，通过 main 同一组真实方法服务同一个登记 Runner。

- 消费 main `RunningAttempt.attachPort` 和 `attachCallbacks`，不抄新的等价 guard、payload reader 或 receipt ledger。
- 原 fact 走 shared `recordFact`：source/attempt 检查、immutable copy、原 register、sink/UoW 与 policy-ready 顺序保留。
- 原 payload 走 shared `readPayload`，原 reference/body 保真，environment preparation 的原 current 检查保留。
- native intent 走原 `beforeNativeWrite` 与 original answerWrites map；原 QuestionBroker 的 live admission 决定效果。
- 缺 callback/guard、void 未包装、deny/throw 一律不能当批准；main 已包装的原 void guard 成功才显式 true。
- 原 Work/Ticket/Assignment/attempt/question/target/session/contract/epoch 与 immutable registration 不换身份。
- 不把 seeded ticket/Store ingress、fact-only fixture 或另一个正常 Work 拼成原业务采用证明。
- 显式接管后旧 stdio/lease 不重复收到回调，旧 nonce 不批准新 intent，payload/receipt 错误不变假成功。
- 缺共享 API 给 main 最小实际 consumer/RFC，同时继续 owned 实现；不能再用“main 只有数据端口”等待。

policy-ready 必须仍在原登记与 durable sink 后提交，不提前 resolve preparation 或跳过原环境捕获。
类级共享方法测试只是起点，实际原 Question 的 beforeWrite 与原 delivery 也要在同一消费者内出现。

交付：原 Application→QuestionBroker→三 callback→原 answer delivery 的实际 source/同 run IDs/receiver/guard/Store 证据。
正向原问题成功应用或准确 indeterminate；负向 wrong source/target/version/body/lease 与 missing guard0效果。
明确哪些 callback 已真的由原运行调用；只“导出可调用函数”不满足该完整成果。

### B3 原命令账本与受限 feed/cancel 控制闭环

完整成果：原业务入口可执行正常命令与物理停止，陈旧/外来/终端控制在效果前拒绝。

- 保留 `ProductExecution.nativeFence→index→allowAnswer(beforeWrite)→send→runtime.feed` 的原顺序。
- feed 选择同 Runner transport 前仍问原 current/command authority；不要直通 raw attached feed 当权限。
- stopped/旧 callback lease 仍能 raw feed 是边界缺口：callback generation 与 business fence 必须分别核对。
- stale business epoch 要用合法旧 epoch≥1 对当前≥2；foreign producer/source/contract/body 在 receiver 前拒绝。
- 修 raw cancel foreign-source 写后拒绝，身份/原登记必须先核实，不能发 cancel 后才靠响应判错。
- 合法物理 cancel 与新的业务写入分开：保留原 `quiesce`、原登记 proof 与 complete resource barrier。
- sent/accepted 不代表 native applied、物理停止或 slot 归还；重复控制保持原 ID/语义，不新 ledger。
- 需要 additive Node-local 控制接口时先 RFC main 审，复用原 RunnerCommand；不改 frozen wire 或加 HTTP grant。
- main 未准入 raw 方法前不得直接合入默认业务路径；有实际合法 positive 与0效果 negative 才交。

同 ID 的既有 receipt 重放与新命令效果分开计数，不能把缓存成功说成终态后又执行了一次。
对照同时记录请求前后原 current、receiver 和资源，证明拒绝在写前而非仅最终抛错。

交付：原命令/receiver/ACK/guard/physical proof 的同源消费者、错误分类与可操作故障说明。
第一工程包的 source 早交后立即继续第二包，不等 native 模型或临时安装壳成为前提。

## 工程包二：同原任务恢复、真实调度与持久使用

### B4 同原 Work 中断到验证、候选与人工接受

完整成果：原任务在受控中断后续接，原问题/答案与产物最终由原检查和明确人工动作交付。

- 优先无信号断连/输入结束/合法继任；不要求或运行 unsafe live SIGKILL/procguard。
- 同原 Work/attempt/Runner/child/session/request/contract 与原 A Store/登记连续，不能构造替代工作。
- 挂起 native intent 跨接管保持 indeterminate，不迁移旧批准、不换命令 ID、不重发 begin。
- 真实 receiver/ACK/receipt 窗口区分 not_seen、intent、observed、native_applied 与 unknown。
- 继任用原账本/问答/current binding，不加载人工拼成的恢复 JSON，不清未知 ledger。
- 原 frozen artifacts/manifest→registered check→resource barrier→currentCandidate 均在同一原 run。
- 等 `actions.available` 真含 accept_candidate 后经原 Application 接受；candidate 出现不等于门已通过。
- old question/epoch/contract/scope/verification/candidate/晚 ACK 与冲突 body 均有独立拒绝对照。
- 普通 normal delivery、Store reopen 或模块 handover 结果各自保留范围，不能升级 recovered。

每个故障窗口保留原输入、receiver 事实与持久结果，不能通过直写账本制造已观察或未发送。
同 run 不完整时列出第一个真实缺口及实际入口，不用多个不同普通任务补齐一条虚构纵链。

交付：一条可复现原 Work 全链、精确原 IDs/回执/工件/check/acceptance 与未达，不造候选表或自动接受。
成功后继续 B5/B6 的真实容量与持久收尾，不能以一次重连或一个 receipt 当整包结束。

### B5 原 scheduler 2/4 槽与完整资源归还

完整成果：原调度器真实处理混合运行/待答/恢复/取消/未知，并在完整证据后推动原队列。

- 以原 core/queue/bindings 投影和原启动/停止 authority 实施，不将 candidate AttemptSlotScheduler 的另一内存 queue 当 authority。
- 2/4 是实际 attempt 容量，必须观察第五项真实等待/拒绝和释放后原 queue 前进。
- 四 Work 或四 channel 不替代 scheduler；每槽原 credential/source/generation/receipt/payload 隔离。
- UNKNOWN、partial writer、缺 end evidence 保留占用，不用 phase、单 PID、module close 归还。
- 原 process/child/socket/fd/timer/waiter/queue/journal/Runner 全集合都由原 barrier 核对。
- 混合取消、控制重入、late ACK 和一槽失败不停止/错批另一槽；不直写 DB ended 腾容量。
- 只把 slot helper 当可审算法输入；若需复用先消除第二 queue/ledger/lifecycle，不改变唯一产品 authority。
- 用实际原 consumer 给合法运行、超容量、跨槽错误、unknown 保留与释放正负，不靠 helper7PASS。

释放证据必须来自原 complete barrier，不能把调用方传入的字符串 confirmed 当作可信物理证明。
重开后的占用和原 queued work 必须与 Store/原queue一致，不能只恢复一个 helper 的数组快照。

交付：原 scheduler/queue/attempt 与峰值/结束全资源的同 run 时间线和原持久事实。
未接原调度器就写 component/SOURCE_READY，不称原2/4产品能力完成。

### B6 原状态重启、兼容与完整工程交接

完整成果：同事重开后能继续原工作/交付和准确处理未知，主线可以集成完整必要 source。

- 进程重启从原 registration/binding/commands/question/answer 恢复，不用新 constructor root 冒充原 Runner。
- ended 不复活，UNKNOWN 不重发；原候选、工件、回执与 queue 继续或准确 held。
- 原 profile/policy/environment/current 授权重验，不从复制凭据、历史设置、read review 推导执行权。
- shared callback 与原 feed/control 的版本兼容、错误归因、缺执行器/权限/配置提示可以实际操作。
- D/E 只验准确冻结包；source-only 就写 SOURCE_READY，不拿旧包/临时 ZIP 标签承诺新运行能力。
- 交 necessary source closure、actual consumer、数据/资源边界与使用/排障说明，不 wholesale merge 无关计费研究源。
- 准确区分普通、controlled、native、recovered、installed 与价值实验；真实收益仍需独立证据。

恢复 factory 应使用原 Store 登记的 endpoint/session，不因新对象构造而产生新 recoveryRoot 或 runner身份。
安装材料只记录实际测到的内部字节与入口；未冻结的新source不能借旧发行结论变成installed。

交付：非空原状态重开和原任务使用记录、完整 source/命令/exit/兼容对照及剩余 owner 接口。
六个完整成果都达到真实出口才结束 goal，不以 source 早发、测试总数或运行时长代替完成。

## 独立备选队列

- main 原方法已交立即消费；剩余接口给实际可编译 consumer/RFC，再继续原数据、错误、兼容与控制实现。
- I/H 输入只阻对应 proof；继续无信号真实回调、问答、验证/接受和持久工作，不跨 owned 复制实现。
- 安全不完整不做物理信号，但不冻结原业务工程；不要等待真实模型、研究预算或新协议才能实现。

## 整包完成条件

- 六成果各有实现、实际产品 consumer、必要独立正负、准确 source/inner/outer 身份和命令 exit。
- 更新 tests/native-acceptance/reports/wave34-status.json，已合 main/仅候选/未达分列；交 source 后继续第二包。
- 只提交 owned 显式路径到原 origin，不 upstream/reset/清状态；保留 B 两旧 report diff+b16 及他人 dirty。
- 自动 real vendor/model/native0，B cap4 UNKNOWN 与 E 原 pilot BLOCKED，不 reset/topup/refund/补样/价格研究。
- 保留12用户实例5180/8796至5191/8807及全部 state/profile/tar/ledger/history，禁止 global ps/socket discovery 和外来凭据。
- 无 unsafe live SIGKILL/procguard、substring kill、真实 CLI fallback、新 Driver/CAC/桌面/自动接受/writer racing/动态 DAG。
- 不新增 ledger/queue authority/执行生命周期/frozen wire grant；完整方案B工程不缩成临时 ZIP 或纯对话演示。
