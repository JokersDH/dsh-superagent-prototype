# 0071：第二十八轮架构事实与实际消费入口

2026-11-15，主线输入 `22d0c759c59e6387ee397476f3d15d28425818df`。十位外部开发 A–J 加主线，继续正常工程节奏与大颗粒整包。本文纠正本轮消费者误读，明确一份通信实现、原候选链路和项目草稿的授权语义；不创造新执行生命周期、账本或迁移。

## 1. 验收按准确 source 和消费者记

固定 Aaeeced18/Bcb4e975/Cf2c4af69/D26f8ad6c/E03349a6c/F2a862525/G2b41765a/H0651a50f/Id95df88b/J46020ff2。B两历史report差异+b16、C lock、E未跟踪runs和主树五个用户日志保持。原十个工作树/分支不变。

A 的 artifact inventory 缩小、普通 conversation_search 前缀持久表漏摘要，C 的整 event_log 豁免均已独立复验关闭：有完整正确restore positive，也有旧变异拒绝。当前 C 单driver+A正式proof 对准确 ce64 包同manifest、v1/v2两根真实恢复/原HTTP/readonly/STOPPED 成立，provider2→2。这是实际数据消费者进展，不能继续说缺整链，也不授恢复业务执行或物理静止证明。

G 的总嵌套预算与永久冲突隔离也已独立复验关闭。main现有0070授权Node读取/GETinsights/实际App不是缺失；按G当前原字节更新纯模块后保留main的项目授权、总上限、两秒接受预算与F明确投影。不因为新的generic collector存在就另造一条默认数据读取路径。

## 2. 候选与接受不需要 candidates 表

原候选结构是 `CandidateRef`，含 ticketId/assignmentId/contract/candidateGeneration；不是 `{candidateId,workId}`。原 `ProductCompletion.current()` 从 `store.commands` 的 reviewId 取审阅记录，并每次用 CompletionEvidenceStore 解析验证；`verify()` 用原 WorkspaceManager.freeze、VerificationRunner/CheckRegistry、artifact 与绑定的 quiescence receipt 生成验证记录；`accept()` 写原 acceptance。core保持唯一完成权威。

实际受控执行入口已在 `apps/coordinator/product/execution.ts` 的 run.waitExit→runtime.quiesce→原Assignment ready→core.completionCandidate→application.verify 接通。主线 `tests/integration/usage-observation.case.mjs` 的 `real Product/Broker` 用原应用命令完成两个真实受控项目问答、检查、当前候选和明确人工accept；本轮定点实际通过。B自己checkout的原product-execution首项也能沿同链到delivered/重开。

因此 B 的 `SELECT ... FROM candidates`、自行构造candidateId和“缺候选生产者必须A迁移”判断不成立。恢复后要进入同一原callback/effect/binding和completion消费者；定位结果/终态/undelivered/资源事实的实际缺口，不再要求A建候选表或另起正常Work补结果。slot探针从 `inspect()` 取得的是 WorkView，应读 `work.work.id`，不是 `work.id`；30秒没找到错误字段也不是缺投影证明。

上述正常链通过不等于恢复链已通过。必须同一个原Work/attempt/session/question/answer经接管后再走check/currentCandidate/人工accept和资源归还，保留unknown/observed语义。

## 3. B/I 必须收敛到一份通信实现

B确实已删除原runner-service的三个waiter maps，并提供自己的 business-channel/dispatch 和真实进程交接/SIGKILL素材；I报告旧maps仍有15引用针对的是I旧树，不能否认B已删除。与此同时，B并未消费I具体模块，`business-channel.ts` 与I `attach-channel/` 在承担同一职责，两份实现不符合0068分工。

选择I独占的 `apps/runner/src/attach-channel/` 为唯一通信 implementation。I把实际B消费所需行为、错误、同步/异步发送与容量时序补进该module；B在原runner-service/recovery-endpoint/RunnerLinkClient中只保留认证、transport adapter、原command dispatch和生命周期。B删除或降为不保存pending/generation/timer的薄adapter，不永久保留第二组通信状态。H独立消费同一个具体module，不新server、coordinator、ledger或gate。

这里退役的是重复通信状态，不是B原业务admission/幂等/dispatch守卫；这些仍由B统一拥有，不能仅按business-dispatch文件名删掉业务控制。

本轮独立事实：B的160条小fact加135540字节五块完整还原与摘要通过，但实际 `facts(...,2048)` 仍可回64753字节；B自带small-pages另实现pager，不能认证真实service。修复必须在actualservice完整envelope上执行effective bound，保持64KiB总上限、descriptor、多页原seq与完整chunk正向。

B回调 `.next()` 不能隐式bind/rebind：旧A在B取得generation2后读取，不得夺回generation3；foreign expected source也必须拒绝，不改变当前lease。连接替换是显式、已认证producer下的CAS动作，普通读不能改变所有权，旧reply/close不得伤新lease。

I的原同lease、同commandId第二次beforeNativeWrite被第一次已结算allowed原帧结算，说明通信相关ID被错误复用。原v1允许native intent的 `id` 独立于 `command.id`；每次hook必须生成新的不可复用correlation id，保留原业务command.id/body，responder按原frame.id回复。不需要新wire/授权/账本。旧成功批准不能给后来意图；断开未决写仍indeterminate、回原command reconciliation，不自动转移或重发。

这些都是candidate模块范围阻断，不是已证明主线现有个人版权限被绕过；不得扩成“旧main一概不可用”。

## 4. 过程测试先证明自有资源

B新SIGKILL脚本有仅凭PID直接signal的路径，本轮未代跑这些unsafe矩阵。先在自己的harness建立独立出生PID/start/UID/fullargv/root/config/operation，并在每次TERM/KILL前重新核对完整资源集合；unknown和失败材料保留。验证精确自有进程之后才能重跑真正恢复窗口。

E旧substring、RUNNING前登记等问题有实际改进，不能回退成“完全没修”。但新独立纯mock表明，record自称stateB、birth和API实际在stateA时，helper先TERM launcher后才发现API wrongroot。完整birth/root/config/每个child必须在任何signal前一起核验；同install、同UID、正确PID/start均不足以证明目标state归属。测试工具不可绕过原产品stop拒绝或删除unknown登记。

## 5. D/E 的运行模式与准确包

D新1cdab25 source、buildecffaa6d3f784426、tarSHA dcfda014ce0ac04ff4a78ebcf27cea9c3659e12bc3156583c985b869401fa86e、20283738字节/6759项、schema18/ABI137，是独立后继包；它含main967的F identity/readiness，不等于main18f统计或本轮G更新。E本轮完整结论仍绑定ce64，不认证D1cd或最新main。

ce64在restore后以 `pa start --discussion-only` 且无reviewfile启动时，launcher record记personal，但daemonArgv的恢复分支丢了discussion-only，实际HTTP health变fixture，随后stop因runtime_mode mismatch安全拒绝。D当前相关源码/1cd同字节路径仍存在。先统一请求、argv、record、health、pointer/startupMode和stop身份；不通过放宽stop或删标记掩盖模式错配。

E把检测到该bug的控制项记PASS，可以说明检测器生效，但不能把用户start→health→stop功能也算PASS或满足functional required。保留ce64原正常普通安装164required范围，新报告260PASS/0FAIL/19NT及178required须逐scope解释；恢复无文件选择启动/停止仍阻断，不机械撤销所有旧普通工作台成果。

运行字节真正改变后D冻结精确successor，包含实际已交G统计、J/F后续草稿和适用runtime closure；E再独立同包验。docs/test-only不重冻。普通体验/安装独立于B业务恢复、private/target和blocked study。

## 6. J/F 草稿必须经过原授权语义

J42 package/30 tools/strict、F16状态/建议测试独立通过，模块与CLI/展示源确实存在。但J当前的prefix containment与原 `packages/questions/src/validation.ts::scopeWithin` 声明原子包含不一致：J同配置 `['src','test']` 生成 `['src/file.ts']` 的draft，UserCommand schema通过，原Application真实dispatch拒绝forbidden。另一方面，原controlled配置合法 `src/`/排除项尾斜杠在J中被当格式错误，默认跟进草稿无法生成。

保留原Scope原子与allowed/excluded表示（包括`.`和`src/`）。J只产当前原授权可用的草稿，缺少精确声明原子返回needs_input，不为matcher扩展core授权或静默扩大用户选择。验收要用同一configuration的actual createProductApplication，不仅看schema/type/另一份fixture。

F在无activeProjectId时可把unknown来源/foreign项目且declared=false的建议标applicable，虽然只是展示层且main尚未传recipes。补当前真实项目、项目内profile/check与来源一致性，不把全局注册误当该项目可用。main最终只接受受限选择，重读当前facts/config/catalog后预填原表单，不能信UI的applicable或草稿digest当授权。

主线唯一拥有已登记项目选择/内部root解析、公开preview DTO/HTTP/App/transport/NewWorkForm与明确确认；J提供可打包的有界只读metadata/facts和pure matcher，F只展示/交回选择。公开请求不含私有绝对根、argv或凭据；不扫描全部项目、不执行scripts、manager版本或安装。J项目声明不是被禁止的native计费配方研究。

实际原表单目前主要按项目默认scope/criteria创建。后续预填完整scope/criteria/profile时必须保持原建议范围，不能只填goal而暗中回更宽默认值。取消零写，配置/facts变更需重验，用户编辑不被异步覆盖；配方不是模型提案，不伪造模型sourceMessage来走Proposal。

## 7. 已实现与后续门槛

main0070的统计、显式context-use prepare/send/audit、来源说明等真实接口继续有效，E旧“都缺入口”说法要对准确source和explicit/automatic区分。自动模型推理、private target activation、恢复后native交付和价值试点仍分别未达，不能从现有读/确认事实推出新授权。

全员自动真实vendor/model/native0，B旧cap4UNKNOWN不可花，E原pilot24turn/200000token/USD5/单在途BLOCKED，不reset/topup/refund/补样/价格配方研究。十二实例与全部state/profile/tar/ledger/dirty保持。无新Driver/CAC/桌面/autoaccept/动态DAG/第二生命周期，历史完成度不按人数/阶段/测试上调。
