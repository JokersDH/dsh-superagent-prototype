# 第三十轮：按完整产品成果推进

2026-11-15。十位外部A–J沿原目录/分支开发，main负责主架构、公共接口和跨模块集成。这轮增大的是结果范围，不再把24阶段改成更多小阶段。每包四个完整子系统deliverable，每个都含实现、实际消费者、必要正负、源码交接和验收；可连续跨多个工作日，不设当日deadline或token预算。

先读[0077主线组合](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078已验输入](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079四大出口](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md)、[验收报告](../../reports/releases/wave30-admission/README.zh-CN.md)和自己完整包。分别转发[十段话术](forward-prompts.zh-CN.md)，原工作区见[workspaces.json](workspaces.json)。没有新建checkout、代发聊天或刷新模型额度。

## 这轮必须推进的大步

1. 可反复使用的项目工作台：当前项目真实建议→原表单→预览/应用/编辑/重验→原Work/问题/检查/候选/人工接受，7/30观察与返回原工作保持。主线0077已合具体源，外部继续完整日常使用和同包消费。
2. 同一准确包的内部试用：D冻结当前完整运行bytes，E针对同tar完成ordinary/functional、最新模板/窗口/来源功能与安装/升级/重开/只读恢复；给新同事独立冷装入口，不再错用上一包。
3. 同一个原Work的恢复到交付：B/I/H接原A/Broker、真正三callback、safeSIGKILL/原ID ACKunknown→原Completion/check/currentcandidate/manualaccept→2/4槽资源归还。普通demo/模块测试不替代恢复纵链。
4. 可信历史、观察导出与支持：A/C历史有效性和当前资格分离，G数据与报告/导出保scope/窗口/层/币种/unknown，F展示范围与点击一致，用户/同事可诊断可退出。

## 已验事实

B最终I/RunnerAttachChannel、sink missing-deny-throw freshguard和actualconsumer strict旧三阻断真关；不重派旧修。新remotelease意图仍双发旧stdio与signal工具边界先收口，原A/Broker恢复交付仍未交。A strictcanonical旧P2、F blocked/exclusion方向旧P2真关，新历史/current混淆和display/preview范围矛盾各自修，不把全部数据路径说成不可用。

D1fba包6849项/120closure、J实际安装UI6/6/两个原受控Work人工接受是真进展，但该包无0076窗口selector。E已实际1ba，ordinary186/functional187真PASS，未独立新J包；新forceproof分支的globalps/UNKNOWN空集/config遗漏hold，旧默认knownlivebirth/no-record修复保留。

main本轮按已验F/J/D源合成0077当前项目建议入口、J读一致性和稳定content helper、requestedmode/一般health检查与J/G构建闭包。准确源码实际8模板+9观察（两受控创建/人工接受、postrecorded未知同ID）、13后端/23纯与传输/12launcher控制/strict/build通过，桌面/手机核对。read-only preview虽POST但无业务写，统计探针分别记录preview与command/event；第一次旧断言FAIL保留，修事实分类后通过。

## 十路四份完整交付

| Owner | Deliverable 1 | Deliverable 2 | Deliverable 3 | Deliverable 4 |
| --- | --- | --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 历史真实性与当前资格清楚分离的完成 reader | main/C 唯一稳定数据与旧消费者兼容闭包 | 原 Work 产品流、回执与当前包双格式数据闭环 | 高风险故障、限额与可操作支持完整交付 |
| [B](agent-b-runtime.zh-CN.md) | 安全可运行的唯一通道与正常工具 | 原 A/Broker 的同 Runner 双客户端 | 一次安全崩溃到人工接受的纵链 | 原调度器 2/4 槽与持久归还 |
| [C](agent-c-context.zh-CN.md) | 正式 schema 的历史/当前完成消费者 | 当前 main 审计与真实数据的完整两项目用户流 | 同 manifest 当前 J/window 包双格式恢复整链 | accepted/unknown、撤销替代与恢复源支持完整交付 |
| [D](agent-d-delivery.zh-CN.md) | 同source两format、完整mode与资源政策 | 当前main完整runtime闭包与可复现候选 | 与E同一tar的安装升级、重开及只读恢复 | 新同事独立目录冷装与支持交付 |
| [E](agent-e-acceptance.zh-CN.md) | 完整无记录资源政策与安全工具 | 尽早对齐D当前同tar的ordinary/functional矩阵 | 一个完整两项目模板、窗口、context与重开journey | 当前artifact release oracle、有限持续使用与支持证据 |
| [F](agent-f-experience.zh-CN.md) | 当前项目到原交付的完整体验 | 反复使用的工作/待决定/交付视图 | 精密工作台的可访问性与移动品质 | 同一安装包的用户交接与长期用法 |
| [G](agent-g-insights.zh-CN.md) | 同一授权窗口的报告与导出闭环 | 当前产品的稳定指标语义 | 可日常使用的只读工具与性能边界 | 主线与同包产品交接 |
| [H](agent-h-trial-operations.zh-CN.md) | 不可变 owned handle 与运行前安全基线 | 当前 I/B 生产入口与原 A/Broker 数据 | 独立 ACK 故障与外在进程资源闭合 | exact 当前包的只读观察与同事支持 |
| [I](agent-i-coordinator-channel.zh-CN.md) | 实际 B/shared responder 与准确采用 | 实际 B 入口的三回调闭合、并发和容量 | 原 handover/crash reconciliation 的模块支持 | 已发布 interface、稳定性和真实采用交接 |
| [J](agent-j-project-recipes.zh-CN.md) | 当前事实与模板重用的完整一致性 | 真实项目的有界读取与版本治理 | 模板到用户工作结果的完整多项目消费 | 完整可打包产品模块与同事开发交接 |

main自己的[四个成果](main.zh-CN.md)负责持续实际source/独立消费者/同包和恢复集成。每人发布早/中/最终runnable source后继续，不在小修/接口/文档或PARTIAL检查点等新派工。

## 依赖与执行方式

任务包是覆盖完整结果的goal，四个里程碑并不等于四次重新派工。外部依赖仅阻对应项：先做owned实现、真实consumer、兼容、错误和独立队列，早交source让main渐进消费；队列穷尽再交准确NOT_REACHED和最小所需端口，不无限polling或造第二实现凑工作量。

I只有通信implementation，B实际auth/transport/dispatch/lifecycle，H独立consumer/资源观察；三方先修singleowner与安全工具再live，先正常原链再同一原Work恢复链。不新candidates表/ledger/coordinator。A历史按原attempt binding核、current单独，C读取事实不授新权。

J/main/F使用同一当前预览字段；main0077真实scope与preview映射同fields，不信独立展示applicable。Node观察/分析不进浏览器。G导出若重新读取必须标新snapshot，不能反解析格式化值伪造numeric权威或生成收益估计。

D一次冻结当前完整runtime，E再同tar终验，Dfreeze不等Efinal；docs/test-only不重冻。普通日常功能/模板/观察/安装独立于B恢复、private-target和blocked study。source/controlled/installed/native/recovered/value/target逐层记账，旧包scope保留不贴新功能。

## 所有权与限制

main唯一root/contracts/config/lock/HTTP/provider/App/transport/globalCSS/跨模块，排除Ftrial src/test/e2e；BRunner排除Iattach-channel src/test。A唯一生产append-only迁移、E唯一product-acceptance断言，J/G/H/D等原ownedpaths保持。开工保留dirty后fetch/merge origin/main，不reset，不并改别人断言/source。

全员自动真实vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilotBLOCKED，无reset/topup/refund/补样/价格配方研究。十二服务5180/8796至5191/8807及所有state/profile/tar/ledger/B旧diff+b16/C lock/E runs/五用户日志保持。完整独立私有birth/UID/start/fullargv/root/config/op与全资源计划先验、每signal fresh，UNKNOWN保留，禁止global发现/substring强杀/其他credential/真实CLI回退。

无新Driver/CAC/桌面/autoaccept/writer racing/动态DAG/第二生命周期，只推原origin分支，mainHEAD:main、永不upstream。四个结果或44里程碑不是完成度；`node agent-tasks/product-wave-30/verify.mjs --workspaces`只做静态归属/依赖/证据/预算与原分支检查，不提供runtime/native/release准入。
