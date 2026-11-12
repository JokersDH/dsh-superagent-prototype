# 0041：第十四轮验收与稳定内测闭环

2026-11-12，主线基线`1453cf279b872eb99116547f1b4ce77867b74880`。这是固定输入的范围验收与下一轮实施边界，不是发布批准。实际证据见[wave14-admission](../../../reports/releases/wave14-admission/README.zh-CN.md)。

## 1. 本轮已确认的进展

| Owner / 固定source | 独立复验 | 可承认范围 |
| --- | --- | --- |
| A `278b665a5c35fe9f10e0db0819d4c7d8ec2f6402` | 旧4/4、storage87、workflows100、strict/build通过 | 负rowid、activation索引/镜像和原command payload三项旧源问题关闭；有可消费逻辑source reader。main实际baseline消费者仍欠缺，不再把接口缺失归给A |
| B `aacc342462a96211f9f34fdaa3c131a97fac2ea5` | 旧5/5、strict/exactOptional、68包测试、真实产品正常纵向6PASS+1NT | 原Work/Ticket/queue全空的结论过时；当前正常流真实执行create_work/Effects/Runner/Broker/answer/accept。重开仅核对行，不能称恢复后控制完成 |
| C `83ac3e1e629cc4a77963328460721ac8c7169e9a` | 旧6/6、四包276、当前main组合9、consumer strict通过 | Scope/coverage与候选数据旧反例关闭。真实HTTP默认factory替换仍由main完成；公开source-review未整体准入 |
| D `d833d0f5f91eaae61e80c9d2e471196fcabd0e0c` | 旧6个mock通过、旧legacy纯谓词拒绝缺绑定、新tar逐文件核验通过 | PID start缺失/复用、总扫描失败和旧第三install入口已有修复；新增身份/部分扫描/角色仍P1。旧live legacy探针缺独立operation证明，本次未运行 |
| E `3dfdcbdf667815bbf6e95440a1b8aa498af96006` | 旧3/3必测分类通过，动态schema同18误判已修 | 必测标签进入tier，不等于实际证据及正确artifact绑定。旧installed报告153PASS/18NT仍是020af82，不是D新包或M1 |

这些候选问题不撤销main已测history/source/reply/readiness能力。所有本轮自动真实模型/native turn0。B正常纵向使用受控本地fixture进程，不是新的厂商模型兼容认证。

## 2. 尚需关闭的具体问题

### D：任何真实停止矩阵之前

新6条mock全部复现不安全结果，实际OS扫描/信号/进程启动均0：

- start相同但UID、精确argv、operation不符的record仍SIGTERM；foreign journal scope亦被信任。实际recover失败清理也走到这一分支。
- 逐PID stat失败及malformed inventory行被丢弃后，`scannerOk/proven`仍为true。
- `dirname(value)`不区分app目录与installDir角色，installDir的父目录可被当成old/new角色，写入confirmed。

必须统一完整身份与不完整扫描的UNKNOWN语义，关闭record、journal、orphan、recover各入口；只修新探针名称不算收口。所有真实矩阵仅可使用本次独立证明PID/start/UID/root/operation的资源，不能停用户十一组实例。

### E：把必测绑定到实际字节与操作

新5条证据变异全部被接受：三项required仅PASS标签+空evidence、格式合法但错误的source、tar SHA、build/size、installed context foreign tuple。它们用实际installed-alpha的对应规则隔离检查，不构造完整发布PASS。当前完整installed tier仍因fault/current-install/rollback的NT而FAIL。

同时，sources route检测把`:id`写成`:.id`，当前安装与upgrade-fault仍有固定NT分支，安装context helper仍强制fixture。下一包必须实现这些动作并记录actual mode；不能通过把NT改为PASS解决。

### B/C：模块范围的剩余边界

B新4例：getter校验/clone两次读取导致实际输入变成BigInt；数组Symbol键与Map上下文静默丢失；Windows路径只遮掉盘符。它们位于尚未接入main的实验helper/公开诊断，不宣称当前个人产品权限绕过。关键产品欠项仍是独立Runner与崩溃后实际answer/stop/unknown恢复，重开进程exit code也必须验收。

C新6个阻断观测对应3类：5000遗漏上限后仍`truncated=false/totals.suppressed=0`；四种绝对路径未脱敏；artifact recent违背newest-first约定，预算1条时取旧项。过期候选的展示与`verifiedBy`受信reader边界另列为说明，不计为执行权限缺陷。main必须保留完整回复读验、来源冻结与最终同步guard，字面标记本身不是证明。

## 3. 冻结包与可立即消费的main输入

D新包：`/Users/hh/Desktop/joker/pa-artifacts/wave13-target/wave13-target-99832f6.tar.gz`，source`99832f6c7e6a54b323a9d454f3a4840273d1275a`，build`3ead6a26161f4c72`，SHA256`b7e9dec7d264f94cadda10c6624db582ddd477ff83a7a8816c6acf5f0c5237d4`，20167862 bytes。6692文件与21内部symlink核验通过，实际schema18、Node24.21.0、ABI137、SQLite3.53.4、darwin/arm64。

该包确有history/source/reply/context入口，不能再沿用“没有历史入口”的旧说法；它仍不含`d9d347e/b2b1adb`的无执行器启动，不能重标当前M1。E最终验收须消费一个明确冻结的新tuple。

main`1453cf2`已经是可用于普通personal重新打包的稳定基线，包含0040/M1，不必等恢复激活、C全部替换或研究。D可在自身已审阅差异上合并该基线生成新source；必须记录确切artifact source，并核对coordinator/console/packages来源切片与声明基线的关系。后续仅文档commit变化不自动否定已核对产品字节；实际运行字节变化必须重新冻结，不能拿格式合法的任意commit替代。

## 4. 下一轮完整子系统出口

| Owner | 本轮一个完整出口 | 先交源码，随后连续完成 |
| --- | --- | --- |
| A | 可被实际恢复prepare/confirm与非空搬根消费的数据链 | source/fact/exclusion/预算边界 → main消费者组合 → 非空快照/引用/进程窗口/规模 |
| B | 同一实际产品路径的持久控制与独立Runner恢复 | 输入冻结/诊断修复 → 真实存活Runner传输 → begin/answer/stop故障窗口/unknown → 2/4槽位资源 |
| C | 可用于默认路径的完整来源审阅与候选数据 | 脱敏/总计/排序 → factory与指纹 → main HTTP/候选实际消费 → 来源失效和有界审阅 |
| D | 有完整资源身份的当前personal安装与升级 | 所有mock安全分支 → 新鲜自有进程矩阵 → M1当前tar → 普通personal/非空恢复/双binary升级 |
| E | 消费正确当前字节、动作与模式的独立发布gate | 实质evidence/tuple变异 → 实际current-install/fault/copy动作 → 新tar personal/数据/控制 → 准确分层verdict |
| main | 实际source baseline、C候选和恢复授权消费者 | A/C最小来源集成与实际调用 → prepare/confirm/候选UI → 资源门后target启动；同时早交普通安装基线 |

每人十个连续阶段，早期、中期、最终三个可运行source。检查点是供其他人消费的交付，不是等待用户下一句的理由。缺外部入口只阻断对应组合，记录一次最小RFC/复现后转独立队列，不无限轮询、不重复PASS凑时长。

## 5. 保持的边界

原worktree、分支、拥有路径与历史证据全部保留。main拥有contracts/application/questions/coordinator/console/root lock及共享集成；A唯一迁移作者；E唯一product-acceptance断言作者。共享probe输出显式放`/tmp`或新wave14报告，不改旧报告；B两份旧报告差异、C root lock差异与E runs保留。

不新增模型 allowance：B旧cap4 UNKNOWN不可用；E原24 turns/200000 billable tokens/USD5/单在途pilot仍BLOCKED，不清账、退unknown、补样本或研究新价格。普通安装、产品恢复与研究彼此不互相阻断。无新Driver/CAC/桌面壳/自动接受/新生命周期/动态DAG。

保留十一组服务5180/8796至5190/8806、所有用户数据、旧tar与native profiles。备份/换根/逻辑摘要从不携带可执行许可。完成度仍引用69/100与50.8%的冻结工程快照；本次不靠包内测试数量加分，更不以分数抵消P1或未完成的主线消费者。
