# A：完整证据与非空业务恢复整包

继续`/Users/hh/Desktop/joker/superagent-agent-a`和`codex/g2-workspaces-verification`，只改storage/workflows及其自有测试报告。读README/0047，同步最新main且保留所有历史。已验source reader/实际inspect+prepare范围保留；main当前非空SDK候选和UI已存在。预算0，schema18不因任务包编号升级。

## A1 当前schema备份的完整性

首先复验本轮指出的完整manifest/证据family范围问题。当前版本必须要求它实际声明的完整证据清单，不能通过删family、保留子集或空清单降低核对强度；历史版本用明确版本规则兼容，不能把所有manifest都降格为可选。正对照必须非空并覆盖实际queue、derived work_id、runtime/resource与reply/context。

## A2 生成与验证使用同一证据版本

snapshot创建、manifest、验证与恢复对family/表/索引采用一致、显式的版本语义。新增字段是append-only；不得改历史迁移或为某个老测试默默忽略新family。缺表、缺索引、重复/未知family、部分清单与未来版本须给有界错误，正常旧快照按其真实能力范围继续读。

## A3 当前非空候选的真实跨根恢复

用main实际SDK本机mock→A18结果→候选GET/prepare→原明确确认产生work/revision/decision，再备份、搬到第二私有根并在恢复只读模式审阅。原body/index/digest、原消息与来源绑定、决定/提案/回执必须可核对；不手造verifiedBy代替真实main reader。阶段1–3交早期可运行源码与consumer recipe。

## A4 问答与队列的非空连续性

用实际Application/Broker或B已验证正常纵向生成问题/答案/投递与原Work/Ticket/assignment，非空queue/runtime/resource一并恢复。区分本地记录、真实写入和未知；复制表不表示允许重发，旧queue保持held。不得引入另一个ledger或测试专用权威表。

## A5 source确认事务消费者

main发布实际source确认入口后再接真实组合：确认前source baseline、原fact/event/receipt同事务、精确ignoreCommitted、丢响应重开原结果。只允许排除这一笔已核实确认及固定heartbeat；任何其他业务/queue/资源变化均使新确认拒绝。入口未到只标本项NOT_REACHED，继续A3/A4/A6–A9，不把模块committer说成公开确认。

## A6 同一连接和进程中断窗口

针对新manifest与非空数据链覆盖读取/复制/manifest发布/结果持久化关键窗口，以及第二连接或进程在source比较时改变真实业务行。断言原结果只补一次、partial backup不可恢复、unknown不发模型；复用现有SIGKILL设施，不重复跑相同窗口凑计数。阶段4–6交中期source。

## A7 A/B/D/E共用实际数据配方

提供可运行fixture builder或现有公共API配方，注明输入source、完整schema/family清单、artifact hash及A18结果。D/E可直接产生非空个人数据；不能要求它们手写SQL、伪造完成回复或自行推导授权。保留主仓ownership，不改其HTTP或E断言。

## A8 历史升级与恢复版本

验证至少一个真实legacy schema到当前18的非空读写与一份旧manifest兼容，清楚区分数据库升级与快照格式。旧field缺失只能降低明确能力，不能降低当前版本完整性；确认/许可/凭据不因恢复继承。历史快照及原tar均保留。

## A9 有界规模与失败成本

只对新增/改变路径测量：原body懒读、扫描上限、缺family早拒绝、读取失败时无额外复制或发送。已有10000 binding/20k扫描证据可引用；若新实现改变复杂度，给实际rows/bytes/reader次数和有限时长，不能只写大数据PASS。

## A10 完整交付

写`packages/workflows/reports/wave16-status.json`，发布第三个可运行checkpoint和实际消费者映射。区分源码集成、A模块、main组合、安装/物理屏障/激活。push仅原origin分支及显式拥有路径，全部未到项和真实退出码保留；不是修A1后便结束整包。

## 独立备选队列

- main确认未到：继续当前候选完整跨根恢复、问答/queue快照、版本化manifest和数据配方。
- B恢复未准入：消费已准入正常纵向产生的真实行，不用B14 receipt-only替代业务。
- 不新增迁移仅为测试，逻辑完整不授物理停止/目标启动权。
