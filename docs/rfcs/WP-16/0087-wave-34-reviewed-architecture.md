# 0087：Wave34验收后的实际架构与准入

2026-11-16。读[本次独立验收](../../../reports/releases/wave34-admission/README.zh-CN.md)、[0086已交实现](0086-main-native-callbacks-and-support-consumer.md)、[0088连续工程程序](0088-wave-34-two-package-engineering-program.md)。完整方案B工程继续，CAC排除；安装是工程一环，不回到临时ZIP冲刺。

## 架构继续采用原权威链

主对话/工作台→原认证HTTP/Application→Ticket/Assignment/core→原Effects/Execution/QuestionBroker→每attempt Runner/I channel/Driver→原事实Store ACK→原检查/currentCandidate→人工接受。一个单writer Store，一份原command receipt和candidate/完成证据，不复制第二生命周期或candidate表。

main `23d5a98e` 现在在原NativeProductAttempt中共用readPayload/recordFact/beforeNativeWrite；原stdio和attachCallbacks共用同一方法。write wrapper只在原guard成功后显式allowed:true；原guard current/product-command digest/live answerWrites一次性准入不变。原ready/register/current之后才返回port/callbacks，不autoattach。

因此B/I不再缺原方法回调。主线下一接原run和原Broker，原work/contract/attempt/producer/target/command身份不换，detach后unknown不自动重发，终态关闭、业务权限和物理资源各自核验。类级15PASS不是Native.launch/原SIGKILL恢复/原2&4资源归还通过。

## 未合候选的边界

### B/I/H运行控制

B显式decideNative0effect拒绝真关；新的rawfeed/cancel未准入。foreign cancel先close service再identity_mismatch必须改为effect前trusted producer/currentlease判断。business epoch/原command账本也必须独立校验，lease正确不代替业务权限。

不可伪造spawn来源必须由original factory发出private能力；prototype/instanceof/观察到的PID/fullargv不能反推“我创建的”。物理操作前完整known birth/PID/start/UID/orderedargv/root/config/op/fullresources，逐次fresh，UNKNOWN保留。只纯控制验证，unsafe live不得补证。独立AttemptSlotScheduler不替原core队列；原槽实际运行/退出/queue状态才是消费者。

I继续唯一通信实现，B管理auth/dispatch/lifecycle，H独立实际consumer，main原权威。无新channel、server、ledger或共享新grant。

### A生产历史

真实keyset生产continuation值得集成，但先统一所有kind编码预算/截止/过大首条明确refusal或有界可推进策略。returned0/hasMoretrue/cursornull不可叫完成；attempt envelope也计bytes。

public reader由main当前principal/project/Scope确定subject，严格row投影、外部cursor签名绑定筛选/身份，不能直接转发内部base64/rawattempt。available是扫描source数，不是authentic review数；live keyset不是冻结snapshot。原历史validity用当时binding，当前eligibility另算，原Completion和accept权限不受history UI影响。

### C明确决定

旧draft权限/symlink/expiry/strict已修，保留正向；新snapshot必须校验完整shape、canonical当前scope/版本/sourceMessageId/textDigest/recordedAt/expiry，nested数据深拷贝。data-only的valid不能当Work创建权限。

新Work消费者必须在create之前preview选定决定、原prepare/assert重验、明确确认，当前source撤销/替代/过期拒旧快照；不把create后work-scopedcontext试验叫创建前已绑定。main授权当前principal/Scope保持原链，旧合同/过去上下文不被改写。

### G/F/J日常产品

G默认metadata支持已main：fresh授权观察→严格DTO→只读GET→scope-key取消/digest浏览器下载；origin暂null/unverified，通用passthrough上传没有公开。此后工作是有证据身份、真正反馈/解释和兼容，不重复造另一支持入口。

F真实fc38工作台已有重试/support/windows/原form，当前新rows只是capability展示，不能算完整history body。继续真正日常多个对象、首次连接、安全表单、history/source、错误保草稿、mobile/keyboard/WebKit体验；main独占HTTP/App/transport，F组件typed callbacks。

J两个注册真实scratch项目受控原交付/bytes重开确有进展，rebind/module仍候选。元数据一致不代表恢复授权/currentgrant，root由main原登记，reidentified只报告变化/要求当前原确认，不继承旧项目权限。原Work历史保留，不能换fixture新Work补原链缺口。

## D/E固定版本与清理

W33 `048f/f880`、inner`ee45`、outer`46e`已全量静态核验192uniqueclosure/6867文件链接，含fc38，不含23d5。E当前真正新增是W32 actual ZIP/非空恢复，mixed R1+W32普通199/功能200非同W33全套。

E先修所有caller catch/finally：Start出生后status失败或stopUNKNOWN仍rmHome，不能只helper retain却删其install/runtime/state。全report oracle须拒foreignPID/缺start、旧空after、selectedproject403伪sameProject。E sole assertions；main/D不得改断言降标准。

D非空backup/restore/CONFIRMED upgrade和原bytes真进步，rollback rawBLOCKED与summary成功冲突须给真正成功receipt或准确HELD。不从data可读反推rollback命令成功，不强清未知wrapper补过。

D固定W33先交E，不等E才能freeze形成环；新23d5或后续runtime确需successor时另立完整subject，E不追移动main。docs/test-only不refreeze；普通App/数据/安装与原活动恢复/blocked研究独立推进。

## 验收与方向

四个整体出口：日常原项目明确交付；同原Work故障续接到交付/原资源归还；完整来源/决定/历史/支持；同准确安装重复使用和非空搬迁。每个出口以真实consumer而非接口数量验收。

source、controlled、installed、native、recovered、value分层。当前stable76/100、B不含CAC55.7/95保持，不按十人/六成果/测试数加分。独立复核价值/第二协议仍未测，native/model0与blocked预算保持。

所有owner原roots/branch/owned/dirty保留；A唯一迁移/E唯一productassertion/I唯一通信/main唯一共享根与授权组合。十二服务与所有材料不动；无globaldiscovery/substringkill/其他凭据/CLI回退/newDriver/CAC/desktop/autoaccept/writerracing/dynamicDAG/第二生命周期。仅origin，main HEAD:main。
