# 0095：原 Native.launch 的回调接入与正常 Work 闭环

2026-11-17。基线 `7e550991`，延续0092–0094；本次闭合实际组合，尚未证明故障恢复或真实原生兼容。

## 实现

`NativeProductAttempt.launch()` 在原登记、policy.prepared 和 current 检查之后，从实际返回的 RunningAttempt 调用 `attachRunningAttempt`。先完成首次 bind，再返回给原 ProductExecution 发送 begin；随后由该 attempt 持有轮询任务。fact、payload 和 native-write 分别调用原 recordFact、readPayload、nativeWriteDecision。原 stdio 业务命令和物理收尾保留。

失去 lease 会停止轮询，不自动重绑、重放业务命令或迁移批准。waitExit、quiesce 和 dispose 收掉回调任务；原资源屏障仍是结束绑定的权威。nativeFence → 原 command index → allowAnswer → send → native_applied 的授权顺序未变。

新增 Node 组合依赖 `NativeRunnerLinkFactory`，默认仍构造原 RunnerLink。它不能由 profile、环境配置或 HTTP 选择；用于在原 launch 内替换进程连接，不反射改 endpoint，不另外造 Work/生命周期。

成套导入 B579c40bc 的四个已审源码及两项相关测试：attached-attempt、recovery-transport、recovery-endpoint、runner-service。cancel 需要原 producer envelope，业务控制携带 lease，终态无 lease 的原 cancel 仍可取物理屏障；旧/新协议混用拒绝，不做降级。B signal 工具、I host、其他新模块未导入。

## 实际验收

`tests/integration/original-native-callback-flow.case.mjs` 使用真实 Store/Application/QuestionBroker、原 Native.launch、原 serveRunner 和生产 CodexProductDriver。Node-only adapter 实现原 SpawnedRunner ABI，使用相同 state/payload/recovery root 和 eager preparation。协议对端与 ProcessHost 完全受控，没有调用厂商模型或生成 OS 原生进程。

正向：原 HTTP 创建 Work → 原问题42 → bind generation2 → 原回答及同 commandId 重放 → native_applied → 隔离目录真实 Beta 文件 → 原已登记 Node 检查 PASS → 当前候选 → 明确人工接受 → delivered → 三项产物读取及原 Store 重开。bootstrap 后的问题、回答和 turn 事实不走旧 stdio；live guard 经 attached callback 使用。

反向：同一路径出现问题后，撤销原 Store authority，再通过原 HTTP 回答，得到 rejected，虚拟原生写入0，无 native_applied。

17项原回调/port/完整链测试、13项 endpoint/interop 测试均通过；coordinator 与 product 严格类型检查通过。常规检查会实际启动 Node，测试内屏蔽 verifier 的信号调用；这不是物理资源退出的证明。

## 仍未达到

协调器故障后的同原 Work 接管、真实厂商/OS 原生控制、原调度器2/4槽归还、准确安装版独立复验和操作者收益均未由本次证明。I 新 host 的 borrowed-parent 删除问题与 B 工具重登记出生身份竞态继续阻断各自采用；不将它们混作这四个控制文件的失败。

下一步由 main 端到端负责原 Work 恢复；B/I/H 提供原接口所需支持。统一任务入口为 `agent-tasks/recovery-milestone-01/`，保持固定安装 cohort，不扩新功能线。用户已确认本阶段不推进复核价值试点、依赖它的第二协议复核及路由收益研究；历史材料和预算不变，价值未测。

## 2026-11-18：原问题窗口的受控故障接管

ProductExecution重启时，对原active native绑定先核原product-start receipt及digest、running Assignment、当前合同/用户授权、profile、原项目/workspace、原执行policy和环境；Native.resume再核原注册endpoint/完整资源清单及serving/open状态。符合才以新随机lease接管同一Runner，不恢复ended绑定、不重新spawn/begin。原payload/fact/写前guard与watch检查/接受链复用，nativeFence仅在callback连接仍有效时返回current。接管安装失败仅收掉本地回调和本次临时根，原物理核对逻辑独立保留。

新增测试由父宿主持有真实serveRunner和生产Codex Driver的虚拟ProcessHost，原coordinator worker在未完成问题窗口直接process.exit(0)，绕过product.close；退出后才由新worker打开同一Store。原问题/attempt/session接续到native_applied、已登记Node检查、currentCandidate、人工接受、delivered和三产物重开，Runner1/begin1/虚拟写1。撤销授权、profile变化、policy变化、资源UNKNOWN四负例均拒绝，虚拟写0。35项相关测试和coordinator/product strict通过，无模型/native/真实信号；verifier信号仍由测试屏蔽。

此结果只关闭“原问题窗口、受控coordinator owner退出后的业务接管”。真实OS coordinator崩溃/stdio EOF/旧stdout EPIPE、已ACK terminal后崩溃、ACK未知业务调和及原2/4槽/物理资源尚未验收；不能把父host保留输入流的测试当它们的证明。B/H继续这些实际依赖，D/E已有固定W36子集验收完成后待命，不重新冻结移动main。

## 2026-11-18续交：终态回读和写后回复窗口

在仍可认证读取的原端点已terminated且完整原资源quiescent时，Native.resume从原business turn.ended observation、不可变payload和重建的canonical fact receipt恢复终态；未命中/超过10000历史界限则拒绝。不重新bind闭channel，仍由原watch调用物理cancel/资源屏障再走检查、当前候选和人工接受。端点已消失时不由旧事实制造新物理证明。

新增“terminal已ACK但原watch尚未交付”“原回答已写出、协议resolution暂未返回即owner退出”两个受控原Work窗口，均一次写入到交付；原命令同ID重放只回读receipt。缺terminal receipt的对照不能产生accept动作。原Runner receiver诊断现记录完整command，8个恢复场景断言实际begin接收1次/answer最多1次及原attempt/assignment/contract；不再仅以turn/start计数替代。

B4703的b38在当前真实main entry复验4PASS/1NOT_TESTED：旧stdin EOF/关闭stdout、同PID新lease、原fact重放、旧reply拒绝、原deliver接收与正常无信号退出。main entry此前已有EPIPE处理；B新增mainRunnerService防护无默认consumer，未导入该片段，仅采用receiver记录片段。该真实Runner fake-driver传输结果与上述虚拟nativehost的原Work结果分别成立，不能拼称完整真实原生故障恢复。B脚本失败分支仍会删UNKNOWN根，不原样复跑该分支；独立复验保留UNKNOWN材料。

原ProductExecution容量改为从原Store的current绑定去重计数，非ended即占用，不依赖丢失的内存attempts；原Effects队列仍唯一，未加scheduler/ledger。Node组合参数maxActiveAttempts可为2/4，默认4，不由HTTP/profile/env选择或授执行权。受控原消费者分别验证2槽的第3项、4槽的第5项等待；WorkA UNKNOWN仍占位，只有另一WorkB自身原屏障结束才放行后续项，A不借B证明释放。UNKNOWN fixture状态保留。该结果是原队列/绑定/屏障的逻辑容量验证，尚非多槽同时owner故障或真实物理证明，H继续独立组合验收。

## 2026-11-19：同run受控组合通过，真实终态清退保持阻断

H1a1be9db的nextWork失败来自测试factory硬拒绝successor的所有spawn；原排队Work实际上已获得application.execution.prepared，新attempt只因该断言被park。原target禁止再次spawn仍正确，原排队Work首次spawn必须允许。主线在自有integration路径采用并修正这个consumer，允许且只允许original.nextWorkId首次启动，累计Runner数应为capacity+1；检查/接受按原ticket+assignment+candidateGeneration绑定，产物按原view.artifactIds读回，UNKNOWN原材料保留。

2/4两个同run消费者均通过：N个原Work+第N+1项等待→原owner绕过close退出→目标原Work接管/问答/check/currentCandidate/manualaccept/三产物→目标原binding ended→第3/5项原Work首次启动并出现问题；其他UNKNOWN原binding不借证明释放。target实际receiver begin1/answer1、原Work数不增加。无需修改生产容量逻辑。42相关测试与coordinator/product strict通过。父宿主virtual ProcessHost仍不证明真实OS/native物理归还。

B91ba4f9a终态生命周期暂不导入：直接strict缺RunnerServiceHandle.awaitTerminalBarrier；closed/noLease cancel内就resolve退出等待并50ms后关端点，不等main confirmOwnedQuiescence持久提交。cancel回复丢失或confirm前再次故障会重现无端点证明；资源indeterminate也不能因closed就清退。B39的fake-driver cancel正例不等自然turn终态或持久屏障。

### 唯一剩余生命周期接口约定

原inspection/cancel只观察、关闭业务和停止原资源，**不得因此清退终态endpoint**。main先按原可信证明调用confirmOwnedQuiescence并提交其原command receipt/event，再通过原注册认证连接明确确认终态清退。B可在原私有恢复transport中加可选、向后兼容的postcommit finalize操作；不改冻结Bridge v1/hash，不另建队列/ledger或公开用户命令。

main独占Store侧确认适配：核原registration、同attempt/contract/producer、已提交的confirm-owned-quiescence/v2 receipt、scope、完整resourceManifestDigest、proofRef和confirmedEventSeq。仅在原UoW外且上述结果与已ended绑定一致时发送。B不读main数据库、不假造该receipt，只验证认证producer、固定attempt、同完整资源manifest及真实terminated/closed/每资源quiescent后接收这项可信coordinator确认；缺失/错subject/UNKNOWN均保留端点。Finalize不能获得新的进程停止/业务授权，也不能重启或删除借用目录。

关键验收窗口：读proof/普通cancel后丢响应、confirm前owner再次退出，后继仍可读取原端点；confirm事务后finalize前退出，后继只从原持久receipt完成清退；有效finalize后响应丢失可按原确认ID调和，不能重做业务或重新释放其他槽。资源仍UNKNOWN则不finalize、不关端点。50ms可用于发送后本地排空，不能作为提交或持久性的依据。自然terminal和普通显式shutdown分别验，全部真实模型/native/信号0。

B负责同一个原Runner的service/entry/transport和实际正负consumer到主线集成，main负责上述原Store适配与原Work组合，H负责独立同run验收。只有这个结果实际闭合才结束责任包，不为它扩通用进程管理或另开产品线。
