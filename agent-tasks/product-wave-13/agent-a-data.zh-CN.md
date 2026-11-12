# A：源证据到实际恢复准备的数据闭环

原目录superagent-agent-a、分支codex/g2-workspaces-verification，拥有storage/workflows。合并最新main，读README/0039，保留旧迁移/账本/证据。A18回复/history已经接入main，不重做已交表；模型/native0。

## A1 关闭三个新源完整性反例

运行`probe-wave13-storage.mjs "$PWD"`并将报告写/tmp。负rowid行的逻辑内容变化不能被扫描起点-1漏掉；ignore的activation各索引字段必须与不可变body完全一致；原command event必须保留确切recorded payload。错误应可见或非complete，不给旧摘要。复用已有A fact mapper，不复制第二套弱校验。

## A2 提交可消费源检查点

同connection事务内核对schema/fact/receipt/event/全部逻辑族，准确区分complete/bounded/unsupported。保留精确单笔排除与heartbeat规则，其他变化必失效。补rowid首尾/边界、坏source/target/principal索引及event payload、scan上限；首个source过strict/build和负例后push并继续。

## A3 非空源与真实多连接变化

源同时含work、绑定、回复、回执、资源/队列；单一快照不混不同提交的记录。另一真实连接在快照前后写入，下一次必发现；坏表/schema/缺artifact给准确状态。不得用逻辑摘要证明物理writer停止，也不排除所有控制事件。

## A4 真实epoch和控制数据支持

支持B使用现有runtime binding/history/dispatch/answer stores，先找已持久的fence字段和原receipt。确需新读port先给main最小RFC；不得为B13补一个只供测试的表、ledger或recover方法。只在必要时append-only迁移，生产连接/UoW唯一。

## A5 接实际main source消费者

main发布baseline/prepare/confirm后，验证本笔确认前后摘要相同、其他业务/资源/确认变化拒绝、响应丢失重入与源readonly。入口未到仅此项NOT_TESTED，继续数据边界、备份和进程窗口；不以noop revalidate自测当生产准入。

## A6 非空backup/restore完整产品读验

实际main e1e0c97及后续history/sources/reply消费者在第二临时根读回原正文/结果/原request，不继承授权。覆盖context/reply/decision/work引用、缺表/坏bytes/坏派生字段/未来schema；阶段3–6交第二个可运行source和D/E public recipe。

## A7 真正跨进程数据故障窗口

独立产品进程SIGKILL覆盖结果、消息、source确认、snapshot登记前后，reopen走真实A port/main消费者。补回的是原artifact正文，不能用固定测试文字冒充；无结果时保持unknown、没有重发/新工作。

## A8 稳定分页与规模

10000条绑定、多个项目/会话/work、同时间、页间新写入/撤销；验证索引、查询/扫描上限、正文不被第一页全读。记录rows/bytes/耗时和上限，坏页不静默跳过。新源读取超预算不能complete。

## A9 当前schema安装输入

向D/E提供当前schema与required tables/families/public snapshot函数，不硬编码18为永远当前。升级v15/v16/现18保持原FTS、回执、绑定和结果；历史migration不改写。普通安装无需等恢复激活。

## A10 分层最终交接

storage/workflows全回归、当前main消费者、备份/进程/规模，维护packages/workflows/reports/wave13-status.json。每条标actual source/命令/exit/范围/依赖，source、history、reply、activation分别准入，只push原分支。

## 独立备选队列

- A1–A3所有逻辑完整性/快照变化可直接做，不等HTTP。
- 当前main已有history/source/reply，非空恢复和损坏矩阵无需激活。
- B新port没到先做既有绑定/回答字段的公开读支持，不自建权威。
