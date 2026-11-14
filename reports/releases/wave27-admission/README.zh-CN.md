# 第二十七轮输入验收

2026-11-14，main验收基线6787bd0。固定八个候选：A06390ae、B36c0e60、C2296c38、D8ed7a72、E3ed0e9d、F3037cbe、G2adeeff、H420cf78。详细命令、source、原始观察和限制在 [core.json](core.json)、[operations.json](operations.json)、[experience-insights.json](experience-insights.json)。按正常节奏补完整能力，不设当日完成要求。

## 可保留的进展

A真实Node新4/4、storage/workflows strict通过，旧重复import/类型失败和普通消息drift误verified已修。B原135540字节五chunk还原、完整tuple/ref/foreign拒绝成立，strict通过。C当前A/C对准确a826同manifest真实v1/v2两根restore/readiness/原ID HTTP/独立STOPPED，provider2→2，旧“缺整链”说法不再适用。

D/E已对齐同一个普通个人候选：source`ce64fc1fd986bde9a6eba5ace1a4658beadcda21`、build`d4b1780d999a4b74`、schema18、Node24.21.0/ABI137/darwin-arm64，tar`/Users/hh/Desktop/joker/pa-artifacts/wave26-target/wave26-target-ce64fc1.tar.gz`，SHA256`8c36aaeb472263bbb7c6ab5e4dafb3e9394306c83b3b6e1ab257d8770480c33a`，20272436字节、6754项逐项核对、closure96/96。E真实238PASS/0FAIL/16NOT_TESTED，164 required ordinary installed通过；包内实际F App/readiness、四原动作/原草稿、三截图/bundle hash/三模式公共schema均核对。此精确普通范围可采信，不外推完整native或其他平台。

F实际hook独立Chromium6/6、纯11与strict通过，身份切换立即隔离旧观察、晚到不污染新源。G core57/tools34/strict、原七反例及真实受控两项目Q/A/accept/ReviewTiming采集通过，usage/queue保持unknown。H新hardening4/recovery3共7/7通过，四旧问题关闭，原600/1800秒fixture记录保留，没有机械重跑长观察。

## 新问题与准确边界

| 等级/owner | 实测问题 | 下一步 |
| --- | --- | --- |
| P1 B candidate transport | 移除累计页guard后160条合法小日志超64KB页，facts(0,131072)变unknown_outcome；独立10/11 | 先inline/ref选择，再对完整编码envelope累计，保持seq与多页进展；大chunk正向不能回退 |
| P1 E测试工具 | stopOwned仅command substring，fallback TERM/KILL无start/UID/fresh；sibling也被杀，record无条件删除，启动前还有登记窗口 | 先纯mock闭合所有权/失败收尾，再live；实际产品无新停止绕过证明，旧ce64观察保留 |
| P2 A数据核验 | 缺真实artifact后把report.artifacts设空，仍independent verified | 完整inventory必须由独立subject约束，不能信可缩小report |
| P2 A数据摘要 | 任意conversation_search*持久表静默漏出摘要且complete | 确切派生表身份/SQLite结构元数据，其他持久表纳入或明确不完整 |
| P2 C数据consumer | 整event_log允许operational变化，追加work.accepted仍verified | 精确row/operation/允许变换，复用A正式proof，不整表豁免 |
| P2 G分析界限 | 一个WorkEvidence嵌套2outcomes越maxRecords1仍complete | 接受/昂贵处理前总nested界限与partial传播 |
| P2 G来源冲突 | workIndex A→B→A删除后可复活映射 | 输入内永久冲突隔离，未知/coverage不能变完整已知 |

新A/C问题是数据proof边界，未证明主线执行权限绕过。G compact consumer遇quarantine会insufficient、F隐藏缺范围指标，未证明当前默认UI显示错误完整数据。B三callback/统一dispatch/同Runner双client/原ID SIGKILL/恢复后accept/2&4仍未实现。H实际业务恢复NOT_REACHED。E来源说明installed UI、独立A/C同包链、跨机器/native/value/private/target仍分别未测。

## 主线本次交付与下一轮

main967dc0c接F四源一测试与App观察identity，发布CoordinatorChannel小接口/local校验与生成资源；实际模块待I，实际服务接入待B。237contracts、13trial纯/传输、strict/build、8干净source实际Appbrowser及桌面/手机截图通过，真实模型/native0。详见 [integration](../wave27-integration/README.zh-CN.md)。G默认指标/H工具/项目模板未接。

[下一轮十路长包](../../../agent-tasks/product-wave-27/README.zh-CN.md)用I建设通信模块、J建设项目声明草稿，其余继续各自完整能力，20阶段/五结果后持续。所有旧实例/dirty/ledger/tar保持；ce64普通包不因docs/E测试工具修复重冻，后继运行字节先freeze后独立验。历史69/100与50.8%不按人数/测试数调高，不宣称完整产品已发布。
