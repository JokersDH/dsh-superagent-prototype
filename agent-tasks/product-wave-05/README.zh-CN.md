# 第五轮：证据路由建议与第二执行器只读复核

**后续新派工已进入 [第六轮整包](../product-wave-06/README.zh-CN.md)。** 保留本轮已交候选、修订01及所有预算/证据；原工作区继续执行新角色包，不重做已完成实现。本页其余阶段保留历史追溯，不覆盖第六轮的新执行顺序。

日期2026-11-10，输入基线`21b9eef`及本轮main检查点；开工合并最新`origin/main`。用户已要求按修正后的方向继续分工。本轮是正式实施包，取代wave-04的新派工；保留历史测试范围、剩余缺口和所有模型账本。

**修订01优先：先读 [价值试点与注意力修订](AMENDMENT-01.zh-CN.md)。** 当前Codex的独立新会话价值试点先于新增第二Driver；一次性密封副本默认；main/C先交跨项目注意力工作台。未过R0准入的推荐/复核默认关闭，只走显式实验入口。下文第二协议阶段都受该闸门约束。

## 本轮用户可见出口

本轮首出口：普通个人版闭环＋跨项目待办/截止/批量审阅＋独立会话复核价值初筛。初筛promising后，后续可扩展为主对话目标 → 推荐/确认 → 原Agent开发/检查/冻结 → 密封副本复核 → 人工审阅；第二真实协议是后续兼容能力，不是价值初筛前提，也不自动进入默认路径。

首版推荐基于准入和固定规则，不是学习型“最优路由”。只一个合格执行器就明确only_eligible；只有受控数据就标controlled。复核没有发现不等于证明正确，机器FAIL和必需人工条款不被复核意见覆盖。

**本轮不做同合同多writer竞速、不做置信度自动接受、不做动态Ticket DAG/通用LLM循环。** 作者和复核者执行各自的现有Work/Ticket/Assignment，持久关联是subject，不增加第二个主候选或另一套执行生命周期。

## 五路连续整包

| 角色 | 任务入口 | 主要结果和唯一拥有路径 |
| --- | --- | --- |
| A | [证据与索引](agent-a-evidence.zh-CN.md) | storage/workflows、唯一生产迁移；建议/复核/结果持久化、出处与时间线读索引 |
| B | [第二执行器与只读运行](agent-b-second-driver.zh-CN.md) | execution/driver-kit/testing/catalog/policy-preparation、runner、drivers、native-acceptance；最小真实协议＋运行证明 |
| C | [推荐和复核规则](agent-c-routing.zh-CN.md) | context/proposals/knowledge及新packages/routing；先闭合决定接线，再做纯推荐和证据有效性 |
| D | [可迁移发行与诊断](agent-d-trial.zh-CN.md) | launcher/distribution/portability；当前发行准入、第二执行器打包/doctor和新目录试用 |
| E | [独立验收与前置价值试点](agent-e-evaluation.zh-CN.md) | 只拥有product-acceptance；先独立会话三组小额试点，再负例/产品/安装/评估 |
| 主线 | [集成](main.zh-CN.md) | contracts/application/questions/coordinator/console/root lock；公共接口、权限、唯一调度与产品接线 |

B本轮显式接手catalog、policy-preparation、execution及新增协议Driver路径；main不并发修改这些源码。B不能改coordinator/console/contracts。C不能改Catalog准入事实或SQL。E不改生产代码，其他人不改E断言。

## 工作目录保持

| Agent | 目录 | 分支 |
| --- | --- | --- |
| A | `/Users/hh/Desktop/joker/superagent-agent-a` | `codex/g2-workspaces-verification` |
| B | `/Users/hh/Desktop/joker/superagent-agent-b` | `codex/g1-runtime` |
| C | `/Users/hh/Desktop/joker/superagent-agent-c` | `codex/g3-assistant-context` |
| D | `/Users/hh/Desktop/joker/superagent-agent-d` | `codex/g3-local-distribution` |
| E | `/Users/hh/Desktop/joker/superagent-agent-e` | `codex/g3-product-acceptance` |

保留各自修改/提交/预算，检查状态后在自己目录fetch/merge新main。不reset/clean/force-push，不切他人分支、不覆盖main已验收的新实现。只显式暂存拥有文件、push自己分支；根锁和公共schema由main提交。

## 当前交付与剩余准入

| 输入 | 已看到的证据 | 本轮首阶段仍要处理 |
| --- | --- | --- |
| A `1dddee9` | schema12、AssistantStatePort与成员索引已进main | 新证据持久化按本轮schema消费，不改旧迁移 |
| B `56b1e61` | 自报假通过/预算/生产ProcessHost停止修复，native本轮0 | main复验候选；真实原生控制、问题窗口仍不可写成已测 |
| C `45bf9de` | 原3项独立准入通过；实际SQL消费者6PASS/1FAIL | 同决定重放＋决定只读prepare/同步commit，见wave-04补充任务 |
| D `bf85594` | 自报33 portability/25 launcher/45-step staged smoke | main复验候选；main本次已修复带项目绑定的readonly恢复，D/E消费复验 |
| E `9257d76` | 新gate50自测；main旧反例已被拒绝 | 合并最新main重测；旧报告不包含最新设置/A-C/D，因此不能整体沿用 |

自报包内结果不是main已准入或完整个人Alpha。当前公开个人预览5183/8799及5180/5181/5182旧实例均不得被测试重启；每人用隔离state、临时端口、临时项目。

## 已交公共输入

`packages/contracts/src/routing-review.ts`提供ExecutionProfileRef、RouteAdvice、ReviewSubject、ReviewReport、ReviewEvidence、ExecutionOutcome的唯一parser/type，以及同步RoutingEvidencePort；配套generated/routing-review.schema.json/manifest。它们是新增产品记录约定，未改变frozen Runner/data wire。

`createProductRuntime`接收startupMode；recovery_readonly保留恢复项目的原只读范围并禁止start业务effects。demo自动restore marker门禁仍在。完整接口/版本/信任边界见 [0020检查点](../../docs/rfcs/WP-16/0020-wave-05-dispatch-and-shared-inputs.md)，架构依据见0019。

## 阶段依赖与持续工作

1. E先准备并执行协议允许的小额独立会话价值试点；main/C同时交注意力视图，A只补必要计时/出处，B先提供现有Codex session/checkpoint和材料隔离消费入口，C原事务缺口仍先闭合。
2. 第二协议先零模型发现/接口，新增Driver实现等promising闸门；C推荐只做有界fixture，不扩学习/平台。D继续个人发行，E验R0和注意力不等新Driver。
3. main消费checkpoint逐段接线；B的真实第二协议和D安装由E在已提交产物上验，功能未到就明确NOT_TESTED，不修改断言或造生产替代实现。
4. 每包五个连续阶段，不逐缺陷等用户批准。遇缺口交最小复现/RFC/owner后继续独立项。全部可执行项完成或仅剩明确外部依赖时统一交接，不无限轮询/空转。

每人写自有`reports/wave05-status.json`，含base/source commit、接口checkpoint、实际命令/证据、分层PASS/FAIL/NOT_TESTED、模型/unknown账和下一消费者步骤。

## 模型与费用边界

main/A/C/D日常开发模型任务0；E除单独`wave05-independent-review-pilot-01`外仍为0。该grant上限24个有界turn、20万计费token、5美元，三者任一先到停，价格/用量无法有界核算就BLOCKED，详见预注册protocol.json。它独立于B，不自动补失败样本；本次真实调用0。

B仍不新增额度，只保留并核对原wave03 grant及全部used/unknown/历史账。pilot前可用原剩余量关闭已有Codex控制缺口，但不得用B额度执行独立价值试点或提前铺第二Driver。pilot后若需第二协议实测，仍只能按已核实的原余额和相应前置检查执行，不刷新日期/phase，不借E新试点额度。

小额三组初筛本轮前置，大样本实际模型对照仍另立预算。初筛不是统计证明，缺arm/usage/隔离证据不能伪造结论；新Driver投入按AMENDMENT-01明确go/no-go/inconclusive。
