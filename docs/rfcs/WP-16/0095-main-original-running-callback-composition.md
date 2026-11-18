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
