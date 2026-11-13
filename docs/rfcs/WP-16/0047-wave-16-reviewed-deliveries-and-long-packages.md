# 0047：第十六轮固定交付验收与长任务包

2026-11-13。用户要求验收wave15并继续大颗粒派工，另提示B重新提交。本次主线产品基线a64a127/运行字节1169535；审查期间新增87d548c只有两份架构文档，原样保留，未改变产品源码。模型/native自动发送0，十二组用户服务未变。这不是Alpha发布批准。

## 固定输入与实际结果

| Owner / 固定source | 已独立验证 | 本轮边界 |
| --- | --- | --- |
| A `29800f652ec8804e6139e312c3235e4ad202c976` | 旧source4、storage87/workflows106、strict/build、实际main/A逻辑source8通过 | 新manifest兼容实现有2个完整性反例，不能整包接入 |
| B `c7f7e77e405f33a612c59c69c8305245917a5b44` | 旧4+5、strict/exactOptional、helper68、B13正常6PASS+1NT、B14修正后6PASS+1NT | cancel确到receiver一次；begin/answer仍0，业务恢复和物理writer未实现 |
| C `f6f985e1c8ce95610bf231bdf1804e2053f72164` | unknown-wrapper4、四包124+39+84+44=291、strict/build；当前main候选11、C/main13、factory6通过 | 新增非空fixtures仍手造wrapper/泛提案入口；旧缺入口声明过时 |
| D `0b9481ce83cf455a9ef41d0ccf94b5255c4d55d1` | 旧身份3反例+正对照4通过；新tar6719项字节通过 | 子进程继承归属、discovered UNKNOWN仍P1，未运行广泛live矩阵 |
| E `ed1c8903b5f3c01077d3e441ce94ced764e6f759` | 旧五行为变异+两source控制7通过，有一致真实personal正对照 | actual recover失败输出仍可过gate；167PASS/16NT只对应旧114b73c |

B提示更新后，用户确认仍是原B目录；本地及远端`origin/codex/g1-runtime`均为c7f7e77，已按此重新交付纳入复验。B目前没有wave15-status，新增仅三份fixture/report文件。其真实normal B13已测范围保留，不被下面恢复缺口撤销。后续新SHA仍须增量验收。

## 优先阻断项

### D：后代和发现资源不能绕过完整归属

`apps/launcher/lib/upgrade.mjs:504/587`将父进程的后代纳入候选后按路径判owned，未独立读child UID/start/operation。完整父正对照下，未登记foreign-UID子进程仍被SIGTERM，child UID未读取。

`:595`将全局发现PID的stat UNKNOWN过滤，形成空集合proven=true；actual recover据此REVERTED，而mock writer仍活。新有限纯mock探针1个正对照PASS、3个安全预期FAIL，没有真实OS扫描/信号。必须统一registered/discovered/child与停止前后规则；安全门未过不做live stop/install/cleanup。

### B：真实业务恢复仍未交

`tests/native-acceptance/fixtures/b14-coordinator.mjs:48/94`仍以原receipt或新receipt存在推导begin/delivered。观测receiver inspect6/cancel1/begin0/answer0；SQLite仅command_receipts3，Work/Ticket/effect/fact/dispatch/question/answer/binding/current均0。独立服务的writer仍为字符串状态，没有真实子writer。

本轮c7确实修好了fixture5/current1配错、合法cancel未触达和crash stdout覆盖。新所谓旧epoch从current1减为0，被schema正整数规则拒绝，仍缺current≥2/old≥1的有效旧值边界证据；这是测试缺口，不是生产权限绕过。下一包第一个checkpoint必须真实begin+question，不再新建receipt-only世界。

### A：删family可降低当前快照验证

`packages/workflows/src/snapshot.ts:203`接受任意非空evidence family子集，且不核对整体evidence digest。非空队列快照原样验证OK；改queue并重算DB hash时完整18family正确拒绝；删effect_queue family（剩17）或只留1family则返回OK。新探针2PASS/2FAIL。

需要明确版本化的完整清单兼容，不能让当前版本随意降格。该新候选slice尚未集成main，既有main逻辑source预检及已准入scope保留。跨当前main组合时应先同步新contracts；A旧dist会拒绝新replyFormat/sourceTextDigest，是旧依赖基线问题，不是当前主线候选回归。

### E/D：恢复状态和退出码的实际关系

`tests/product-acceptance/lib/release.mjs:385`只要求recover.status非空。保留同一真实成功正对照，仅将实际recover输出改为BLOCKED/exit2/unknown_live_resource，仍接受。`e4-upgrade-fault-child.mjs:81`的status OR exit也会掩盖失败。

D `apps/launcher/bin/pa.mjs:476`只认NO_OP/RECOVERED为exit0，实际生产还返回RECOVERED_PREVIOUS/REVERTED；E保存的真实RECOVERED_PREVIOUS输出exit1仍记PASS。D应明确兼容成功终态并给一致退出码，E独立核对exit/status/code/operation与真实pointer/data，而非放宽状态映射求绿。

### C：消费当前真实候选入口

C在`main-context-use-consumer.case.ts:494/604`手工构造verified wrapper/任意artifact digest，`:628`走泛`/v1/proposals/prepare`。这是有效数据/提案事务测试，不是原回复candidate GET/指针prepare的origin绑定验收。当前main这条真实SDK→A→C→原提案路径已经独立11项通过；下一包消费现成入口，不再重复“main尚无非空建议”结论。

## 新冻结包的准确范围

D tar：`/Users/hh/Desktop/joker/pa-artifacts/wave15-target/wave15-target-b1854c0-r2.tar.gz`，source`8962d102711e2d2f6b9bb8d5b8ed98437348f6a3` clean，build`88df6d2eef1feeb7`，SHA256`11497980a4077e854b64596c71efe45b1e68e058639838acef0b07657d61f54b`，20190414 bytes。

6698普通文件hash/size及21内部symlink全部核对，schema18、darwin/arm64、Node24.21.0、ABI137、SQLite3.53.4。确含M1、697efdc逻辑预检、history/source/reply/context；早于main新建议UI，冻结回复仍suggestions=[]。时间范围差异不是旧包回归，但它也不能叫当前建议版。

E167PASS/16NT实测测试source77d59c2、产品114b73c/builda7df2b225a8c5c42；installed-alpha因required E5-D-OWNERSHIP-MOCKS NT保持FAIL。没有认证新8962d10，更没有认证main1169535。旧结果和tar均保留，不重贴标签。

## 下一整包与主线责任

沿用A–E工作树/分支、所有scope和ledger，任务见[wave16](../../../agent-tasks/product-wave-16/README.zh-CN.md)与[分别转发文本](../../../agent-tasks/product-wave-16/forward-prompts.zh-CN.md)。每人十个连续阶段、三个可运行source检查点、外部依赖独立队列。真实动作/退出码/consumer是完成标准，文档或测试总数不是。

main下一出口是实际source确认/原请求核对/私有许可，再接获验的B真实port和D资源门；不能继续用派工代替真实消费者。M1–M3实际运行字节现已可让C/E直接验证、D冻结新包，普通安装不等确认/激活/试点。主线未发布source确认前只有这一项NOT_REACHED，A/C/D/E其他阶段继续。

所有自动真实模型/native turn0；B cap4 UNKNOWN不可花，E原pilot24turn/200000token/USD5/单在途仍BLOCKED，无重置/补样/新价格研究。无新Driver/CAC/桌面壳/自动接受/动态Ticket DAG。十二组服务5180–5191/8796–8807及全部state/profile/账本/tar保留。完整证据见[本轮报告](../../../reports/releases/wave16-admission/README.zh-CN.md)，完成度不按PASS数量重算，releaseApproved=false。
