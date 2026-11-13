# 0051：第十八轮验收与同包产品出口

2026-11-13，审查基线main d494212/6050b4b，固定A6dc4bc5/B1e1f82a/Ca07e660/D94ee3c6/E48f73f6。随后main交[0050](0050-snapshot-schema-admission-checkpoint.md)/e438ab5安全切片和B正常准备诊断。本轮真实vendor model/native0，十二组用户服务/状态/历史/账本未改，不是完整Alpha批准。

## 当前结论

| Owner/固定source | 独立确认的范围 | 未到或阻断 |
| --- | --- | --- |
| A6dc4bc5b948661a473032a2a9699fafa8e0edb25 | 原A/C合计8反例关闭；storage87/workflows109、strict/build及实际source确认14通过 | 真实旧main v1非空binding备份被新verifier拒绝；全v2/legacy不可整包导入 |
| B1e1f82a6a0076ea06c7a3d769388b6a4b1bc8bd5 | 实际App/Effects/原ProductDriver/子进程及A失败事实2已接；原Driver14、B16 3PASS+1NT、normalB13 6PASS+1NT保留 | fake可执行脚本语法与协议均未闭合，未prepared/begin/question，无业务恢复 |
| Ca07e660cb1fb817e7c87f5f0072edcbac42f2751 | 原getter关闭、四包124+41+96+44=305、strict/build；实际候选/readonly/source确认消费成立 | readonly同根切换与第二根copy是分开的用例，统一第二根流程仍欠 |
| D94ee3c6150ec49bebab801dda9eec7ecf7cd4f20 | 准确65102f7包及其同包helper5/5、6737项字节、source确认消费成立 | 新包普通personal/非空候选与统一搬根独立E结果仍未齐；不孤立摘upgrade漏依赖 |
| E48f73f65fb213a41e8b4331a2b3a256d8aabe2d6 | 原exit/pointer探针3/3关闭，source确认两个受控Hono/SQLite消费者2/2 | installed-alpha PASS混用新源码安全证据与旧97包，不能采信 |

## E：跨包安全证据可错误放行（P1）

`tests/product-acceptance/cases/w17-d-child-gate.mjs:9/18`从当前D checkout import helper；E177PASS/15NT、installed-alpha PASS的产品subject却是旧97cace7/build8a5a0a85631f22ca。`lib/release.mjs:833`没有把E5-D-OWNERSHIP-MOCKS纳入subject关系。

有限全mock直接import不可变包模块：新65102f7完整registered-child正对照及负例5/5通过，旧97同测2PASS/3FAIL，actual recover仍错误REVERTED。保留完整原installed报告正对照，仅把安全helper provenance设为真实新651 tuple/hash，而旧97安装subject不变，gate仍PASS（1PASS/1FAIL）。因此它是在用修复后的源码给旧有问题binary补证。

E必须从同一冻结包加载helper，或证明字节完全相同，且所有required case加入完整subject比较；不能只匹配部分case。旧ordinary讨论/context/history/reply限定scope保留，撤销的是这次跨subject installed放行，而不是所有旧能力。

## A：真实旧v1摘要不兼容（P2）

主线未修改的v1 producer生成真实非空assistant_context_bindings快照，self verify=ok，A新verify=blocked；真正empty-v1两边ok。旧族digest51d53c57b7d4be9c586f5b6a255a9d8f6bbd8db64c71f3e032e70a2df6cce7dd，新配方包含work_id后7022d0a2ca54342c557a37667dbdcadf90b487be66640eb76dffbaa26b6b5bc8。

`packages/storage/src/backup.ts:90`改变字段配方，`packages/workflows/test/snapshot-d.case.ts:455`的legacy测试却重标新v2并只留前两族，未包含真实旧binding。因此原混版本/缺表修好不等于历史兼容通过。需要版本专属配方及明确完整历史family集合，不接受任意子集，也不把新derived字段强加旧摘要。

main本轮只接schema inventory/helper和create/verify检查，保留v1 protocol、原13族配方及完整digest，未接A全v2/legacy。新7/组合29及主线87/93等通过，见0050。所有旧备份/tar和A/C分支不变。

## B：可执行producer与可观测失败

`.mjs`第29行的`as Uint8Array`使`node --check`和`--version`退出1。原B17真实创建Work/Ticket/link/binding/current各1、effect2、fact_receipts2，dispatch/question/answer0，binding stopping；两事实经现有API确定为writer.observed和runtime.error(protocol_error)，不是policy.prepared。

原fake thread/start还缺cwd/approvalPolicy/sandbox/model，approval方法及thread/turn/item身份也不匹配原Driver。B17又查询不存在的fact_receipts.kind、runtime_bindings.fence_epoch并吞错；`store.observations.forAttempt()`/binding API已足够，不需A迁移或新的normal main入口。

main给出已运行本地对照`tools/bootstrap/diagnose-wave18-b-preparation.mjs`及fixture：保留原ProductDriver/guard/A Store，经现有native.profile接口得到policy.prepared→begin1→dispatch1→Broker question1、A事实4、同attempt和清理完成。结果显式MAIN_DIAGNOSTIC_NOT_B_SUBMITTED_DELIVERY、creditedToB=false；不是B已提交交付，不是恢复/answer/stop/native兼容准入。B可直接对齐producer，再连续做后续整包。

## 恢复只读范围要准确

A第二根真实HTTP目前覆盖候选/回复/held row与业务拒绝，问答恢复仍Store/inventory。C实际readonly/source确认HTTP重用原root/Store，先前第二根copy另测。现有结果均成立，但不能拼成同一份数据的完整第二根用户流程。source确认6050已实现且被消费，不能继续列main缺入口。

## 准确冻结包与下一出口

D新tar`/Users/hh/Desktop/joker/pa-artifacts/wave17-target/wave17-target-65102f7.tar.gz`，source65102f79352743ef38cdbcf9170f37b4d3ade06b clean，buildf55470ae14cc4985，SHA33d874c9a25f22d2710fb29d686f03ad5b37de7ad2cdb09f40d16fd7ecb86340，20225208bytes；6716文件+21内部symlink=6737项通过，schema18/darwin-arm64/Node24.21.0/ABI137/SQLite3.53.4。

包确含建议/偏好/source确认及child修复，早于e438 schema guard；不能把后来源码检查借给旧包，也不因docs-only变化重冻。main没有完整launcher/portability组合，不能单独摘upgrade.mjs就说已安全集成。

下一[wave18](../../../agent-tasks/product-wave-18/README.zh-CN.md)按完整结果建立/沿用goal，每人十阶段、三个可运行checkpoint，交后继续独立队列，转发[五段话术](../../../agent-tasks/product-wave-18/forward-prompts.zh-CN.md)。main继续最小源码、私有许可和真实恢复消费者；普通personal同包安装不等激活/试点。真实model/native0、B UNKNOWN/E BLOCKED预算、十二服务/全部state/profile/ledger/tar保留，无新Driver/CAC/桌面/自动接受/动态DAG。证据及复验见[本轮报告](../../../reports/releases/wave18-admission/README.zh-CN.md)。
