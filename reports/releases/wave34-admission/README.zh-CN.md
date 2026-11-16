# Wave34：Wave33十路结果独立验收

2026-11-16。固定 main输入 `e05ee8d8` 和十个HEAD，逐分支读取实际源码、必要正负与准确安装字节。结论是部分生产能力和非空恢复证据有实质进展，仍不能把十位“完成”汇成全产品/发行通过。main本轮持续交付见[集成](../wave34-integration/README.zh-CN.md)，下一[整块任务](../../../agent-tasks/product-wave-34/README.zh-CN.md)。

## 仍需处理的发现

1. **P1，B原控制调用者：外来cancel先改状态再报错。** actual foreign producer使原service open→closed、serving→terminated，随后caller才identity_mismatch。旧lease/stopped caller仍能feed；原命令权限/当前租约必须在effect之前核。新raw feed/cancel暂不导入main。B信号工具另可用伪ChildProcess prototype取得mock authority，instanceof不是不可伪造spawn provenance。[实际复现/源码](runtime-channel.json)。
2. **P1，E异常清理调用者：helper留存后finally仍删安装材料。** outer Start已spawn/status失败会rmHome；cohort stopUNKNOWN/retainMaterial后仍rmHome。实际source纯stub复现，未删真实资源。必须从caller到finally完整保留HOME/install/state/runtime，再跑生命周期。[具体路径/行](delivery.json)。
3. **P2，A历史预算与继续性。** 合法4395096B verification首条导致returned0/hasMoretrue/nextCursornull；attempt page4194883B却标4MiB下complete。所有kind总编码预算与过大首条策略须统一，公共consumer不能信零进度页。[复现](data-experience.json)。
4. **P2，C决定快照完整性。** 改captured Scope或clone sourceMessageId/recordedAt仍valid；nestedScope未deepfreeze。该data-only候选不等main权限绕过，但不能按完整scope/provenance断言用于新Work创建。[复现](data-experience.json)。
5. **P2，D/E证据主张仍需收口。** D原rollback raw为BLOCKED unknown_live_resource，summary写成功；E oracle仍接foreignPID42/缺start、旧tar空after和sameProject声称却scoped403的材料。保留真实upgrade/普通stop/数据正向，拒绝更强结论。[复现](delivery.json)。

## 真实进展与准入表

| 角色 | 本次独立验证的进展 | 尚未完成的层 |
| --- | --- | --- |
| A | 真实生产keyset，120行50+50+20，原历史subject/append；两原项目artifact实际bytes重开；9test/2strict | all-kind预算/零进度修复后才接新public history；非安装/活动恢复 |
| B | 显式allowed fail-closed回调；deny/missing/throw/void0effect；旧plain-object控制关闭 | 新raw控制及工具未准入；独立SlotScheduler非原scheduler；原Work/Broker/2&4未达 |
| C | 旧strict声明、草稿symlink/0644、非法expiry三个问题真关闭；3pure/2strict和真实CLI7控制 | snapshot Scope/完整provenance；新Work创建前prepare/assert/确认consumer |
| D | W33准确inner/outer静态全量、192unique closure；真实非空备份/恢复/升级，原Work及4产物bytes一致 | 原rollback成功receipt未证；E尚未同W33独立，跨机/signing/native未证 |
| E | W32 actual ZIP包内Node/入口；非空原Work交付/readonly HTTP/bytes；旧parentdead/noSet helper关闭 | caller finally/oracle；199/200是R1+W32 aggregate，不是整套W33 |
| F | 20pure/strict；实际原App日常回归、两capability映射；此前fc38源码已main | 只有两support rows新生产变化；完整history/source body/first-use等继续 |
| G | support report/file/reader/manifest语义15/strict；main本轮默认真实消费 | 通用passthrough不作公共上传；当前origin未知；收益未测 |
| H | 真正available.accept等待后W32接受/delivered/同Work+bytes重开 | 原run/Broker恢复/原2&4/安全故障工具及更强现场试用 |
| I | 唯一channel当前有限consumer/strict；原guard拒绝与detach行为 | main真实callback已提供；仍需原run实际集成，不以channel槽替原调度 |
| J | 21pure/真实CLI/两注册root原交付、bytes与重开/strict | rebind/module仍候选，不能由report转授权；新main/同包后续 |

## 固定安装身份

D W33：source `048f0184606202b0b39e7426b7747f3fe57541c1`，build `f880e5bc9c6c1c57`，inner SHA `ee45c92c7c5a8f2caa0449572b14bf97175b0392f1fd92c6f89d7a19464604e8`、20547728B、6867 manifest项；outer SHA `46e01c8c7b79818d19e019f6d2208ad54c5c9538674218f85455434eff8207f9`、63481603B。Node24.21.0/ABI137/schema18/darwin-arm64。静态核验不执行包、不授发行权限，已实际含fc38工作台，不含新23d5回调/support。

E306PASS/0FAIL/20NT是原始记录；实际新增测的是W32 `e834/88eb`、outer `0a46…`，不是D最新W33。recorded199ordinary/200functional有真实正向，但属于声明mixed-cohort aggregate；full201因native缺仍拒。旧R1和新W32子集必须分别保留，下一先固定W33独立结论，不追移动main。

非空数据进展是真实的，不能重复写“eventSeq0”。D源/恢复/升级原Work一致，四产物1143/187/24/380B及digest一致；E包内受控原Work→nonempty backup→readonly Work/history/artifact HTTP也真实。它们不是活动原Runner恢复或恢复后的执行授权。

## 文件与保护

[固定目录/HEAD/dirty](workspaces.json)、[A/C/F](data-experience.json)、[B/H/I](runtime-channel.json)、[D/E](delivery.json)、[G/J](recipes-insights.json)。本轮未改十位候选树/dirty/lock，未运行unsafe live信号/全局发现/真实模型或native、新tar/用户实例重启；十二服务/全部state/profile/tar/ledger/历史/五用户日志保留。

自动真实vendor/model/native0，Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED不变。完成度沿用stable76/100、当前不含CAC的B55.7/95=58.6%；不按用例/分工/报告数上调，无release/native/recovery/value新增准入。
