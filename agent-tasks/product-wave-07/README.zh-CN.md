# 第七轮：集成收口、恢复新工作与可核算试点

日期2026-11-11，派工基线`d4d51ae`。本轮延续原A–E工作区/分支与所有权，每包六阶段连续执行；不是从零重做第六轮。wave-05修订01和原预算账继续有效。计划/接口设计不计作产品完成。

主线首批实际接口：[0027](../../docs/rfcs/WP-16/0027-wave-07-command-and-recovery-checkpoint.md)，源码da54758。A/C消费者源码已最小集成，应用同步命令companion和恢复意图fact port已可消费；恢复目标启动/HTTP提交尚未开放。C有效列表撤销后复活旧项的独立反例已补入C任务，不能由包内PASS覆盖。

先读 [共享边界0026](../../docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)、[0025已实现接口](../../docs/rfcs/WP-16/0025-outcome-projection-and-recovery-preflight.md)、自己的完整任务及本页末尾启动指令。

## 1. 本轮三个出口

1. 同一干净集成来源的可安装个人版候选：真实上下文/提案确认与已有决定/交付/计时可连通；D/E独立验证安装、双产物二进制升级、数据备份和拒绝不兼容回退。
2. 恢复只读历史与新工作执行隔离，完成明确计划/确认/持久回执/可重入激活；不启动旧queue、不删除marker、不替旧writer签发新证明。main承担关键路径，A提供必要持久port，D/E消费验收。
3. B/E交一条满足原grant的统一可执行试点链，或对当前适配器给出有证据的NO_SUPPORTED_BOUNDED_RECIPE/BLOCKED结论。缺价格、执行上界、隔离或会话证据时不发送。无法运行是可行性结论，不是复核无收益；不为填结果扩大预算或第二Driver。

个人版推进不依赖pilot正收益或第二协议。预算和来源完整后才消费原E额度；只交更多harness自测不能称价值已验证。

## 2. 最新交付审视

以下是已读取的候选报告/关键源码，不表示本轮独立重跑所有测试。完整快照见 [dispatch.json](dispatch.json)。

| 角色 | 候选 | 当前事实与本轮增量 |
| --- | --- | --- |
| A | d3207d8 | 真实C消费者、31 workflow测试与快照证据摘要已交；main已接接受投影。优先支持恢复激活事实与有界历史读取，不重写Outcome |
| B | 6890fe8 | 真实app-server传输/Seatbelt子进程隔离已交；原grant余量UNKNOWN，整turn费用上界仍BLOCKED。把隔离/预算验证绑定同一实际运行器，不重复协议调研 |
| C | 119bb96 | 真实A port、23 proposal/50 knowledge/44 routing及显式扫描不完整已交；main尚未接通用proposal/context。提供可直接组合的闭环，不重做决定HTTP |
| D | 4a0ea7f | 干净源码schema13产物、49步smoke与数据跨版本证据已交；二进制跨版本切换/独立E升级仍未测，恢复commit仍缺main |
| E | 3cfe445 | 131条记录中多个缺口已缩小，review-value已独立；实际pilot仍0/24。CLI估算预留与B硬边界结论需统一，安装还缺第二产物/覆盖配置根路径 |
| main | d4d51ae | 已交决定网页、共享排序、Outcome/工作证据、恢复inspect/prepare；commit、通用proposal/context和D安装物集成仍为主线责任 |

旧报告保留。新状态只维护自己一个wave07-status文件，明确哪些旧阻断已解决，哪些是新接口未集成；不得让主状态和continuation报告互相矛盾。

## 3. 原工作区与整包

| 角色 | 目录与原分支 | 任务 |
| --- | --- | --- |
| A | `/Users/hh/Desktop/joker/superagent-agent-a` · codex/g2-workspaces-verification | [恢复激活持久事实与历史证据](agent-a-activation-and-evidence.zh-CN.md) |
| B | `/Users/hh/Desktop/joker/superagent-agent-b` · codex/g1-runtime | [统一运行准入、隔离与预算可行性](agent-b-runtime-admission.zh-CN.md) |
| C | `/Users/hh/Desktop/joker/superagent-agent-c` · codex/g3-assistant-context | [可组合上下文与提案闭环](agent-c-context-and-proposals.zh-CN.md) |
| D | `/Users/hh/Desktop/joker/superagent-agent-d` · codex/g3-local-distribution | [二进制升级与恢复切换](agent-d-binary-upgrade.zh-CN.md) |
| E | `/Users/hh/Desktop/joker/superagent-agent-e` · codex/g3-product-acceptance | [统一预算拒绝与独立产品准入](agent-e-study-and-install.zh-CN.md) |
| main | `/Users/hh/Desktop/joker/superagent` · codex/g2-execution-integration | [恢复激活、提案网页与集成版本](main.zh-CN.md) |

代码归属保持AGENTS：main公共schema/application/questions/coordinator/console/root lock；A唯一storage/workflows/生产迁移；B原execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C context/proposals/knowledge/routing；D launcher/distribution/portability；E仅product-acceptance。包内文档/证据归对应owner，共享任务/ADR/准入文档由main维护。

## 4. 大颗粒与检查点

每包六阶段，先push一个稳定可运行的接口检查点，再连续推进独立阶段。不能只交报告或stub就结束，也不必每修一处等用户下发。阶段状态为NOT_STARTED/IN_PROGRESS/PARTIAL/PASS/FAIL/BLOCKED/NOT_TESTED，标明实际证据层。

依赖未到时：留最小复现、source、owner、需要的输入，转到自己包中的独立任务；不造私有替代实现冒称组合通过，也不无限轮询/空转/截图。必须停止的计费路径继续停止，不用扩大平台来维持忙碌。

main逐段收货与发布，优先准入A/C新消费者和D最小发行源码，使E可从一个版本验证；main在本轮早期发布恢复激活及proposal公共接口，避免D/E反复等一个未实现入口。

## 5. 预算与研究闸门

没有新grant。main/A/C/D及E非pilot任务真实模型0。B原wave03-b-native余量UNKNOWN，视为不可花，不以重建空ledger推定4个空位，不扫描用户开发会话来补账或抹掉历史。

E仍仅wave05-independent-review-pilot-01：24原生turn启动、200000累计计费token、USD5任一先到停、一个turn在途，8作者+16复核，作者同样预留。实际ledger先核对，跨波次不重置；unknown不退款、不换ID重发、不补样本。

当前Codex适配器仍未取得可花费准入，即使补上pricing也不能直接执行：字节/4估算、固定padding、Math.min裁小预留、timeout、结束后usage、一个孤立的布尔声明都不构成保守硬上界。B/E先统一同一实际adapter的证据。真实provider/model/价格、全部计费组件、可执行上界与宿主隔离缺一阻断。

若当前版本确无有界recipe，B交有限可行性决定与零模型验证的替代提案；E确认不发送。换模型/provider/测量设计或预算须main先在0调用/保留旧账条件下显式版本化处理，不能自行切换或静默放宽。promising也不授权本包新增Driver。

## 6. 产品与研究并行

| 当前可开始 | 后续验收依赖 |
| --- | --- |
| A迁移/快照/历史读取、C上下文/提案库、B运行/边界负例、D双安装物/first-run修复、E预算/现有产品反例 | 不等main恢复commit，也不等pilot执行 |
| main准入并发布A/C/D最小来源与共享接口 | 随checkpoint分段进行，不等五个整包同时完成 |
| main恢复激活＋A事务事实＋D启动切换＋E独立窗口 | 共同验证旧state永不dispatch，计划漂移/重放/中断正确 |
| E真实pilot | B统一adapter证据、预算/价格/范围有效、main试点准入；不依赖完整安装包 |
| D最终二进制包＋E installed-alpha | 同一来源的两个真实不同产物与数据兼容证据；不要求第二Driver或正收益 |

完整依赖图在dispatch.json中，依赖表示最终组合验收所需输入，不禁止先做本阶段独立准备/负例。恢复激活各阶段可以先交源码/计划检查点再做最终验收，不得用“等E先通过”阻止交给E需要的安装物。

## 7. 服务与交付

保留用户六组实例：5180/8796、5181/8797、5182/8798、5183/8799、5184/8800、5185/8801。新测试用临时端口/新state/临时项目；本轮以同一安装入口收口，不默认再开一串永久预览。原生账号/全局runtime/用户项目不重置。

每包最终交branch/base/source、owned paths、接口checkpoint、实际命令/退出码、source/artifact/预算身份、分层结论、剩余owner及下一consumer步骤。安装物不混不同源码；研究结果不混协议fixture；报告存在或自报executed不是通过证据。root lock仅main更新，agents自己的临时解析diff不提交。

只读计划检查：`node agent-tasks/product-wave-07/verify.mjs`。它不运行产品、模型或改账，也不授予准入。所有本轮阶段初始NOT_STARTED。

## 统一启动指令

```text
继续第七轮整包，按当前目录/原分支确认你的A/B/C/D/E角色，保留修改、候选、全部ledger和历史证据。
在自己的工作区fetch并安全合并最新origin/main，读取AGENTS、START-HERE、product-spec/README、agent-tasks/product-wave-07/README.zh-CN.md、专属任务及WP-16/0026。
先push稳定可运行checkpoint，再连续完成六阶段；缺依赖留source/复现/owner后做独立项，不在首个检查点或一处小修后停止。
只提交拥有路径并push原分支；不改公共schema/root lock/别人断言，不动用户服务，不刷新grant，不开第二Driver或自动接受。
```
