# 第十二轮独立验收与产品交付边界

日期2026-11-12，复验main `b466bc7`；本轮实际集成`530085c`。用户要求验收已完成的A–E并继续派发长任务。新包不是宣布上一轮全通过，而是保留已验证能力、关闭明确新缺口，继续真实产品出口。

## 固定来源与结论

| Owner | 完整候选source | 独立结论 |
| --- | --- | --- |
| A | `121ab84818b9cb8204a67c4d639e69cbf5040ef2` | 包内storage87/workflows88通过，回复结果/备份/schema18可集成；source尾部/重复事件/history work三条新负例失败。 |
| B | `4a409207848157fdcccdd91e005d23051b83eb11` | 旧11条和strict/exactOptional通过；function/Symbol/默认路径三条新负例失败。B13仅测试台账与fixture进程，生产恢复不准入；B8/B9未开始。 |
| C | `553983b3c12c386e106047146f1d52be72d8204c` | 旧17条、context101/proposals32/knowledge79/routing44通过；新export八条失败，新检索/审阅/history/candidate不整体替换main。 |
| D | `ebcebe1be556db9e35de83f1ddff467b3d5a1934` | 原data-root stop修复成立，通用stop/recover/共享路径资源认领仍四条失败；实际schema16 tar含context-use。 |
| E | `fa45457f095334cbd54878223db9b8accb601062` | 当前HTTP/context独立用例6PASS，真实持久回复尚未消费A18；安装报告139PASS/1FAIL/18NT仍绑定旧schema15字节。 |

以上HEAD与origin各自分支一致。A/D跟踪源码干净；B原runtime.json差异、C原root-lock差异、E旧untracked runs保留。报告原source不可随这次HEAD重标。

## 先修的发现

### D所有有副作用命令的P1

- `upgrade.mjs:435/504/513`用config/data/logs/cache/workspace任一路径命中认领全局PID，随后信号终止。mock inventory证明A的shared cache能认领未登记的B PID，considered=0仍proven=true。诊断路径匹配不证明PID/start/operation所有权。
- `upgrade.mjs:749`的recoverSwitch starting分支缺requested scope，requestedA遇recordB仍RECOVERED并把journal写confirmed；cleanup分支亦需统一检查。
- `identity.mjs:47`默认不要求install，stop仍接受wrong install；复制record到另一config也能停原API。原requested-data-root修复保留，不因此撤销。

新probe只停止其新spawn的自有API；全局PID扫描与信号均mock，且mock拒绝触及任何非fake PID。新scope全部关闭前，不运行真实宽范围installed/upgrade cleanup矩阵。

### A逻辑source与history新边界

- `recovery-source.ts:150`先LIMIT再排除，自有row占掉lookahead。perFamily5加入第6条非排除activation后仍complete，旧fingerprint不变。
- `recovery-source.ts:78`按topic/entity/payload排除所有同body intent事件，后来新增同body事件也不改变fingerprint；只应排除原来那一条确切事件。
- `assistant-context.ts:24`没有验证新增work_id派生列。将列改为foreign-work后，history查foreign-work仍返回body中的actual-work。不是新HTTP权限绕过，raw history消费暂不准入。

source核对与扫描还应在同一读事务，原fact/receipt/event索引与body全部一致。main没有引入RecoverySourceStore或以其启动任何target；source逻辑完整也不证明物理writer停止。

### B消费者与恢复证据

`review-sender.ts:211`直接通过非object，顶层function/Symbol均reserve1/fakeSend1；必须在reserve前拒绝。`runtime-diagnostics.ts:348/365`公开binary/versionError/reasons仍含绝对路径，pathRedacted=true不代表已脱敏。这些新helper未被现用main产品消费。

`b13-durable-control.mjs:51`新建b13_command/b13_epoch，不由实际Runner读取；fixture自行启动writer。`150`在cancel停止writer后kill fixture，随后才写epoch，并在同父进程正常close/reopen。其6PASS/1NT只支持这段测试逻辑，不能证明生产begin/answer/stop或新协调进程恢复。后续必须驱动现有产品Store/queues/Runner，不造第二测试权威台账。

### C新export八反例

`composer.ts:1131`漏digestScope；`source-review.ts:184/146`超maxItems并泄露omitted绝对路径；`relevance.ts:105/239/227`缺provenance放行且丢上游coverage；`reply-candidates.ts:182`漏整个body的project/conversation/source绑定；`history.ts:196`漏query.workId核对。foreign conversation decision和foreign project revision是两个独立envelope用例，共八条。

main保留现用私有adapter、cutoff和完整同步guard，不以新manifest comparator替代。C9使用Map bindings且未读SSE，不能重标真实A历史/回复/SSE。C负责纯数据链，main负责HTTP/provider/网页与明确确认。

### 发行与验收来源

真实D tar为`wave11-target-a22d3a4.tar.gz`，SHA256 `a10f627492c0f9ebc709137689fb26ed59f2bb463c7ea93d7c347a682770d2cb`，20132388bytes，source `a22d3a4bbc7084265b6fa8cce9205131a17e0a51`，build `3311a04bd20ed7f9`，schema16/darwin-arm64/Node24.21.0/ABI137。已比对HTTP实际字节、manifest及Git source，selected-context send/audit确实存在，不能继续说D没有当前能力字节。

但本轮main已schema18，该包不包含新结果表；其旧scope有效，不成为schema18安装通过。E e4-install1079/1092硬编码schema不一致、无context routes及无条件NOT_TESTED，需改为实际tuple/能力断言。main旧probe-wave11-delivery固定读wave10也是旧测试，不是新tar结论。普通安装不依赖target激活/研究，先有冻结bytes再给E最终verdict。

## 主线已经交付的实际集成

main `530085c`按路径接入A的schema17/18、replyResults、artifact备份/库存、相关context依赖；没有接入RecoverySourceStore，raw history有界查询只作为待验依赖，没有公开历史endpoint。当前HTTP产品测试移除Map bindings/result fallback，原失败断言收紧为：unknown必须notice，已保存结果必须恢复原reply，不允许二选一PASS。

新增`assistant-reply-process.case.mjs`启动真正独立产品进程，经原应用命令/效果队列/真实A SQLite/API消费者：provider中、result后message前、message后SIGKILL，以及持久artifact损坏。新进程恢复provider调用0，原结果只补一次；损坏或未知不重发。全部使用mock provider，不是厂商native证据。

主线本轮回归：storage87、workflows71、assistant/context71、进程4、recovery-target/intent55，共288项通过；storage/workflows build与product strict通过。原九组运行预览不迁移/重启，5188仍4140cac/schema16；源码变化不是在线更新。

另在测试source939a6fe完成9/9网页复跑，真实A18 binding/result、HTTP/React/SSE、desktop/mobile及丢响应核对；首次测试旧变量引用错误已修复并单独保留失败报告。最终网页结果不代替独立进程或安装验收。

## 下一轮交付与依赖

每人十阶段、早/中/最终三次source，检查点后继续；详细见[长包](../../../agent-tasks/product-wave-12/README.zh-CN.md)。A修source/history并完成非空持久数据；B驱动真实生产控制；C交从授权检索到候选的完整纯数据链；D统一所有权后交当前字节；E动态独立验收。main交历史正文网页、实际source baseline/许可/启动、明确执行器退化和当前源码冻结。

主线已交实际reply consumer，因此A/E可立即做持久组合；main其他未交入口仍由main负责，不转嫁给A/C/D。只缺某个外部入口时标对应NOT_TESTED并继续独立队列，全部独立工作完成后收尾，不无限轮询或凑时长。

预算仍真实模型/native0，B旧cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途仍BLOCKED，不重置/补样本/退unknown。无新Driver/CAC/桌面壳/自动接受、writer racing、动态Ticket DAG。九组服务、账本/旧tar/账号及原五个worktree保留。
