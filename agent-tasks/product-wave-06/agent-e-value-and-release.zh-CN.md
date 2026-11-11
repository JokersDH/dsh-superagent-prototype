# Agent E：前置价值实测与独立 Alpha 准入整包

继续`/Users/hh/Desktop/joker/superagent-agent-e`、`codex/g3-product-acceptance`，保留`34ff976`及已有病例/冻结/账本，合并最新origin/main。读本轮README、0023、修订01和现有pilot协议。仅拥有tests/product-acceptance；不改生产实现、共享schema、其他Agent测试/模块或root lock。

## 交付目标与预算

先判断当前独立会话复核机制是否值得继续投入，再对同一集成来源给出个人Alpha准入结论。pilot只用原`wave05-independent-review-pilot-01`：24原生turn启动、200000累计计费token、USD5任一先到停、一个turn在途；预检记录0/24不代表可以重置账。其余任务真实模型0，B原生证据仅消费，不借pilot额度补发行/native测试。

## E1 试点前置审查与当前基线

第一优先复查当前pricing_unavailable及B运行接口、真实作者/续会话/新session、材料与宿主边界、usage完整性、单turn保守上界、未知发送核对和ledger。main只读核验之后才能在既有grant内启动，不需要逐案例审批，但缺前提不能发送。

保留原8例、oracle、评分、顺序seed和protocol摘要。按0023核对“作者前固定规则/初始材料”与“review前冻结实际checkpoint/candidate”两个时点；与已冻结协议不一致就交protocol_semantics_unresolved，等main有版本的澄清后在0调用状态重新冻结。不得看结果后换标签、阈值、模型或样本。

先查真实ledger，不以旧报告0/24代替当前用量。已有调用时不得重封存覆盖旧实验，停止受影响执行并保留结果/费用，交main核对。固定每例/arm的token、费用、输出和时间上限；自查与独立复核的共同上限必须一致，不能事后补预算。

当前main已有attention/计时/设置接口；A/C/D也有候选。更新依赖探测，区分尚未集成与真实失败，不继续复用a70db20的“功能不存在”列表。先交可复跑预检与阻断清单，然后继续可独立的E3/E4，不停在报告pricing缺失。

## E2 8例三组的真实有界初筛

所有前提满足后，只由E通过B接口执行：每例一个真实作者checkpoint，不复核组0次额外review；续作者session自查一次，全新session独立复核一次。8作者+16复核的原生turn上限不意味着底层只有24次推理，实际计费全部核算。

同模型/版本、冻结材料、工具范围、输出/时间/费用上限；保留并报告作者历史开销。新session不能读取作者/其他review答案；oracle/变异脚本不可达；若采用作者后注入，三组最终材料完全相同并明确合成干预。报告只作复核发现，不自动执行命令/修复/接受。

每次发送前持久预留，unknown沿原身份核对，取消未证实不归还为未发生；无自动重发或补样本。触及任一cap即停；材料变异、泄漏、会话假独立、用量不明或外部范围失控为invalid/inconclusive。

先盲评再解盲，按原promising规则报告检出/漏报/干净候选误报、可操作发现、实际用量/费用/unknown和耗时。8例仅初筛。未真实执行时结论BLOCKED；有效完整结果不满足才no-go，不能把环境阻断算负收益。此报告优先于完整异构或发行评估。

## E3 新源码的注意力与决定闭环

使用main公开HTTP/SQLite/真实受控进程，独立验证两个项目、多个会话、不同类别、真实截止与失效、unknown等待、同分稳定顺序、原工作跳转/重开、逐项接受及旧candidate拒绝。列表页/计数/游标覆盖范围要真实，不能只验截图有按钮。

验证权限/认证不跨target合并，批量审阅只导航；模型离线仍能查/答/停。ReviewTiming缺失为null、重叠不重复、采集失败不影响接受；UI代理不作质量或授权。

main接C/A后验证prepare不写、确认前无效果、同command重放、改payload/source/actor/grant拒绝、撤销后上下文失效、事务失败回滚与进程重开。缺接口准确NOT_TESTED，不修production使期望变绿。

## E4 D同一安装物的独立新目录验收

消费D冻结manifest/字节摘要/source/build和支持矩阵，在自己的新目录运行，使原checkout不可用。验first-run/doctor、HTTP静态工作台、版本/ABI/依赖、精确实例复用、并发启动/停止、完整备份/恢复、坏/缺artifact、升级与回滚。

带原项目绑定/旧队列的恢复必须默认只读，旧业务不发送；main恢复计划/提交入口到达后，验过期/漂移/重放/失败回滚以及只允许新授权的新工作。不得删marker、改D断言或用fixture替代缺失生产入口。真实native调用仅消费B已提交且当前适用证据。

## E5 严格gate与有界稳定性

更新module/controlled-product/actual-native-control/installed-alpha/review-value分层矩阵。拒绝缺case、未执行、来源/层级错配、旧source、混用artifact、伪native、预算unknown假0、required review缺失假no_findings和模型自评PASS。个人Alpha与研究收益分开，不要求第二协议或正收益才验普通产品。

对集成后的受控混合工作做最多30周期或45分钟任一先到的稳定性验证；首次未解释不变量破坏即停并保留复现。每项都需实际执行和对应状态，不靠“reports存在”或字段executed=true独自授予通过。没有预算不跑native soak，不重复模型填矩阵。

## E6 最终决策与下一消费

交pilot的promising/no-go/inconclusive/BLOCKED及原始结果摘要、保留所有失败/退出和账；另交个人Alpha逐必需项PASS/FAIL/BLOCKED/NOT_TESTED及source/artifact身份。缺必需证据的tier保持非零。

更新`tests/product-acceptance/reports/wave06-status.json`、release matrix与自有交接。bug给实际owner最小复现后继续独立项。原生会话dump、credentials和隐藏推理不入Git；公开证据使用脱敏ID/摘要，冻结材料不因失败静默替换。

## 验收出口与遇阻继续

- 可核对的预检和8例真实初筛结果，或准确且可复现的外部阻断；不将工具完成称价值通过。
- 新main的注意力/决定/计时与失败边界有独立产品证据。
- D同一安装物在新目录独立跑通，或明确哪项阻断及owner。
- gate能拒绝反例，必需缺项不PASS；旧报告不被覆盖或冒充新基线。
- 价格/运行受阻先继续E3/E4/E5；接口未到先准备独立反例和已有产品回归，不建设更多研究平台。

```text
继续第六轮Agent E整包。保留当前目录/分支、冻结病例和全部ledger，合并最新origin/main，读agent-tasks/product-wave-06/README.zh-CN.md和agent-e-value-and-release.zh-CN.md、WP-16/0023。
完成E1-E6：试点预检优先，前提满足后按原24turn/20万token/USD5 grant执行8例三组；同时独立验main注意力/决定、D同一安装物、严格gate和有界稳定性。先交checkpoint再连续执行；除原pilot外模型0，不借B账，不改production或其他Agent断言，不将BLOCKED当收益结论。
```
