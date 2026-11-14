# 第二十四轮：完整原身份与可安装的恢复流程

2026-11-14。承接 wave23，验收见 [0063](../../docs/rfcs/WP-16/0063-wave-24-admission-and-product-closure.md) 和 [固定报告](../../reports/releases/wave24-admission/README.zh-CN.md)。原 A–E 工作树、分支、拥有路径与全部历史记录保持。

## 已到达的实际能力

main `4b42a9001c4040aa6c87c1c6056056d04ea1e9af` 已交 [来源诊断界面及CLI帮助](../../docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md)。默认正文请求不变，用户明确点击才读取范围说明，错误/缺失/失效/遮蔽和原文守卫保持。干净源码13项实际浏览器场景、4项传输测试、1项帮助测试、strict/build通过；桌面/手机截图、焦点与延迟切换均验证。不要继续列UI消费或全局help缺失。

A 已证明真正新 Node 进程读取；C 的源级结果/HTTP期限/实际服务身份修复通过8项回归。A manifest的新原subject/集合完整性和成本边界尚未准入；C package实际入口、进程身份、清理与全阶段总deadline仍待补，source正向结果不贴installed。

B 旧facts来源身份、foreign-source写前拒绝与160条十页小预算回放通过；仍漏command assignment/attempt/contract，合法大页/大单frame无法过64KB传输，真实回调重绑、双client、SIGKILL恢复未交。新通道不进入用户默认路径。

D 新0ede包6747项和closure78/78通过；live工具记录前窗口/精确新鲜子资源身份未闭。E 已准确验a9b普通安装162required，208PASS/0FAIL/15NT；旧四missing/contradiction修复通过，保留595历史161required。E capability自报降级与诊断数值边界有新窄缺口；0ede和本轮main字节尚无E最终验。

## 完整结果分工

| Owner | 第一可运行结果 | 中期结果 | 最终结果 |
| --- | --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 原完整subject、required集合、UoW/成本受限清单 | producer/新进程reader与C同一数据输入 | 原B结果落库与两个独立快照恢复数据 |
| [B](agent-b-runtime.zh-CN.md) | 完整命令身份/大payload、实际回调重绑、双client交接 | 同A原ID的协调器崩溃恢复和回答 | 原Work检查、候选、人工接受与2/4资源归还 |
| [C](agent-c-context.zh-CN.md) | 准确package入口/实例/清理/总deadline | 真实包启动并消费A清单 | 同Store双恢复与独立失效用户流程 |
| [D](agent-d-delivery.zh-CN.md) | 记录前窗口与信号前精确归属全部闭合 | 含新main UI的准确同包双恢复 | 冻结、升级、重开和可交给同事的安装包 |
| [E](agent-e-acceptance.zh-CN.md) | capability与诊断schema必测边界 | 准确新包UI和同数据双恢复 | 有界可用性、资源归还、分层required结论 |
| [main](main.zh-CN.md) | 已交真实来源界面及CLI帮助 | 实际合格attach消费者与原授权组合 | 产品级崩溃恢复和同包独立交付 |

## 连续执行

每人建立或沿用整个结果包goal，不设token预算。十阶段、早/中/最终三个可运行source里程碑，发布后继续独立队列，不在小修、PARTIAL或检查点停工。缺外部输入只阻对应项，准确NOT_REACHED并做独立阶段，不以非法fixture或另一数据根补成功。

共享数据流程只有一套：A负责真实producer/reader/数据清单，C负责唯一consumer driver，D负责真实安装及生命周期，E独立断言。开发driver不必为证明存在而塞进运行安装包；但执行的实际包内CLI、模块和数据subject必须准确绑定。原Work/attempt/assignment/contract/epoch/question/answer/native_applied逐一核对；两份快照字节相同不代替两个真实恢复消费者。

main独占根contracts/config/lock/HTTP/provider/UI与授权集成；A独占storage/workflows及追加迁移；B原runtime路径；C context/proposals/knowledge/routing；D launcher/portability/distribution；E product-acceptance。最小RFC/实际调用端口早交，不能新增另一ledger、SQLwriter、执行生命周期、确认权威或probe专用空方法。显式stage自有路径，推原origin分支，不推upstream。

## 固定边界

所有自动开发/验收真实vendor/model/native调用为0。B原cap4 UNKNOWN不可花；E原pilot24turn/200000token/USD5/单在途保持BLOCKED，不reset/top-up/refund/补样/新价格配方研究。goal不刷新额度。不新增Driver/CAC/桌面壳/自动接受/动态Ticket DAG。

十二组5180/8796至5191/8807与所有state/profile/tar/ledger、B旧report差异/untracked、C lock、E旧runs、用户日志保持。只对独立证明本次probe出生的PID/start/UID/完整argv/root/config/operation发信号，每次信号前重新核对；未知保留现场，不先删活根或用substring/端口/共享install推归属。禁止全局socket扫描、其他credential和真实CLI回退。

每个请求、准备子进程、身份检查、启动、停止及总流程均有期限，清理宽限另列。普通安装/只读UI不等待B/private/target/BLOCKED试点；运行字节先freeze再E最终验，docs-only不重冻。a9b、0ede、新main各subject分开，完成度不按轮次/测试数上调。

分别转发 [五段话术](forward-prompts.zh-CN.md)。`node agent-tasks/product-wave-24/verify.mjs` 只检查派工结构，不授runtime/native/release准入。
