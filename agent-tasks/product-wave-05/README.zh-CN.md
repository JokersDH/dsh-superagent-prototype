# 第五轮：证据路由建议与第二执行器只读复核

日期2026-11-10，输入基线`21b9eef`及本轮main检查点；开工合并最新`origin/main`。用户已要求按修正后的方向继续分工。本轮是正式实施包，取代wave-04的新派工；保留历史测试范围、剩余缺口和所有模型账本。

## 本轮用户可见出口

主对话描述目标 → 看推荐执行器/排除理由及是否附加复核 → 明确确认 → 原Agent开发和注册检查 → 停止并冻结候选 → 第二真实协议在证明的只读权限下复核 → 展示发现/依据/不足 → 按原合同人工接受。

首版推荐基于准入和固定规则，不是学习型“最优路由”。只一个合格执行器就明确only_eligible；只有受控数据就标controlled。复核没有发现不等于证明正确，机器FAIL和必需人工条款不被复核意见覆盖。

**本轮不做同合同多writer竞速、不做置信度自动接受、不做动态Ticket DAG/通用LLM循环。** 作者和复核者执行各自的现有Work/Ticket/Assignment，持久关联是subject，不增加第二个主候选或另一套执行生命周期。

## 五路连续整包

| 角色 | 任务入口 | 主要结果和唯一拥有路径 |
| --- | --- | --- |
| A | [证据与索引](agent-a-evidence.zh-CN.md) | storage/workflows、唯一生产迁移；建议/复核/结果持久化、出处与时间线读索引 |
| B | [第二执行器与只读运行](agent-b-second-driver.zh-CN.md) | execution/driver-kit/testing/catalog/policy-preparation、runner、drivers、native-acceptance；最小真实协议＋运行证明 |
| C | [推荐和复核规则](agent-c-routing.zh-CN.md) | context/proposals/knowledge及新packages/routing；先闭合决定接线，再做纯推荐和证据有效性 |
| D | [可迁移发行与诊断](agent-d-trial.zh-CN.md) | launcher/distribution/portability；当前发行准入、第二执行器打包/doctor和新目录试用 |
| E | [独立验收与收益评估](agent-e-evaluation.zh-CN.md) | 只拥有product-acceptance；负例/产品纵向/安装和等预算评估工具 |
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

1. A先交证据port；B先交版本绑定的profile/driver消费接口与协议/只读证据探针；C先交决定接线修复。三者发布源码checkpoint后直接继续整包。
2. C可立即用同schema的fixture实现推荐/有效性；E可立即实现独立反例；D先消费main恢复修复并验证已交发行物，不必等新Driver才工作。
3. main消费checkpoint逐段接线；B的真实第二协议和D安装由E在已提交产物上验，功能未到就明确NOT_TESTED，不修改断言或造生产替代实现。
4. 每包五个连续阶段，不逐缺陷等用户批准。遇缺口交最小复现/RFC/owner后继续独立项。全部可执行项完成或仅剩明确外部依赖时统一交接，不无限轮询/空转。

每人写自有`reports/wave05-status.json`，含base/source commit、接口checkpoint、实际命令/证据、分层PASS/FAIL/NOT_TESTED、模型/unknown账和下一消费者步骤。

## 模型与费用边界

main/A/C/D/E模型任务0；受控/mock只用本机。B不新增额度：沿用原`wave03-b-native` limit4，报告used0、历史其它批次used3分别保留，开工按实际ledger/unknown重新核对。所有会触发模型的直接Driver/SDK/CLI入口也要先持久预留。

B在核实剩余原额度且安全前置检查通过后，优先分配给一次当前Codex控制缺口、一次真实第二协议只读复核、一次第二协议只读拒写/停止目标；最多使用原剩余量，未知发送先核对，不能换ID重跑；余量不是必须花完。此任务包不刷新日期/phase预算，不让E代跑，不增设新grant。额度或本机条件不足时继续交完整受控实现并标真实路径NOT_TESTED。

收益实验此轮先交固定预算、数据隔离和负例工具。大样本实际模型对照需另立预算，不能以“创新验证”名义隐式开启。
