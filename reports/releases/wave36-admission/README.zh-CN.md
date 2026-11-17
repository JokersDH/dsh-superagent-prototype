# Wave36：Wave35十路独立验收

2026-11-17。固定main5860da13和十位HEAD，核源码、实际consumer、必要正负及准确归档。[固定目录/提交](workspaces.json)、[主线交付](../wave36-integration/README.zh-CN.md)、[下一整子系统任务](../../../agent-tasks/product-wave-36/README.zh-CN.md)。source-ready不等完整产品通过，旧已关闭问题不重新派。

## 仍需处理的发现

1. **P1，B候选终态与原完成流程不兼容。** 原自然退出后仍须合法physical cancel/quiesce再确认完整资源屏障；新control closed一律拒，导致原completion不能通过。旧firstlease/foreigncancel/helper身份修复真关，但不能凭早期7安全case合默认；完整矩阵保留8PASS/1FAIL。工具另有原child退出后同PID复用再adopt刷新birth/mock signal新风险。[具体源码/复现](runtime-channel.json)。
2. **P1，E查询未知被当没有子资源。** 原mixedset/重复post问题已修，新lateDescendants把pgrep error/status2/timeout当空集合，可mock TERM/release。release还允许缺alive/sameIdentity布尔，required operation副本未绑定主结果。只纯复现，无真实信号/删除。[报告](delivery.json)。
3. **P2，C同步绑定守卫。** 旧selected-window40/32缺口已修；新sync guard仍接受正常superseded决定，snapshotDigest改全0也current。async原治理正确拒绝，默认create事务不得直接采信新sync bool。[报告](data-experience.json)。
4. **P2，D新target回执与来源清单范围。** W35 raw upgrade仍BLOCKED unknown_live_resource，status却写CONFIRMED；不能借旧W33成功回执。192项source audit全match但漏新GUI两源，须扩来源或准确称选定审计集；完整运行文件并未缺失。[报告](delivery.json)。

## 真正进展与当前准入

| 角色 | 本次确认 | 尚未闭合 |
| --- | --- | --- |
| A | exact最终4MiB/+1边界真关；正常生产keyset/真实bytes保持；9focused/2strict | 全读取成本/更多kind与默认产品维护；main已实际接首三kind |
| B | firstlease/foreigncancel/旧lease/handle身份等旧反例关闭、4文件strict | post-exit quiesce/PID复用readopt；原App/Broker恢复和原2&4未达 |
| C | 显式选40条外的current决定修复、source同UoW guard consumer有进展；5tests/2strict | sync superseded/digest；默认server持久binding仍未集成 |
| D | 必要W35 GUI/launcher后继真实存在、安装GUI selftest/两project受控证据 | E同W35独立、当前upgrade真实receipt、来源audit完整标签 |
| E | 336PASS/21NT，旧全set/dup/403/pending/mainoperation独立负例真拒 | query UNKNOWN/缺布尔/required副本；仍R1+W33而非W35 |
| F | 49pure/strict，继承main模型修复，实际旧viewer回归 | 旧WorkHistoryPanel不是新Completion协议，未盲挂；更多整合/访问质量 |
| G | 25相关测试，声明/inventory/运行输入分层、缺文件/hash/comment负例修复 | 当前运行仍需main/D可信start输入；未把caller输入自证为OS运行 |
| H | 原正确available gate/固定source/非空W33材料继续保留 | pin时间范围不当最新B/I；human cohort/同原run恢复仍未达 |
| I | owns/launch-shaped consumer与strict有源进展 | shape/反射不等真实launch返回；原Broker/原槽/恢复仍未达 |
| J | 31相关observer/module/held-layer/原两项目交付测试 | 真实Verifier FAIL与archive restore未达，fixture固定通过诚实HELD |

## 新安装包与主线校验器

D W35：source `edfe5e14f2f8fbc7f395a84520c781c7f07ce9e7`，build `599de3e98c02de0b`，inner SHA `11027a375848c25c2d2ae8e18755f65fa77272db533dcee7bb9ff27ba8ba50db`、20598155B、6883清单项；outer SHA `39c0fff0e13d61c59198f8a55f0ed692b887194aaa4e2782b2b3e9cbd623f6c5`、63536701B、6891项。实际tar在`/tmp/w35art/`，永久outer位置见报告；不能按旧路径猜missing。

W35 wrapper与已审main8cd字节相同，旧verifier仅允许8de31误挡新339b。主线现在仅加第二个明确已审hash、仍要求actual==manifest；第三hash/伪声明拒。独立实际W35 static已VERIFIED，无重包/运行代码/放宽身份或许可证。该包含模型GUI，不含本轮新分类历史。

E仍实际锁W33 f880/ee45/46e。recorded普通204/功能205真实过，但含legacyR1/W32baseline；full206native缺仍拒，不能把这些结果贴给新W35。D两原project证据是同state连续单project受控runtime和同fixture profile/check，不等原公开双项目默认适用全链。

## 主线实际推进与保护

main已将A byte-exact workflows.ts和最小类型导入，公开严格三kind metadata/HMAC当前Scope游标/128KiB流界限→原WorkDetail分类历史，真实App8/原模板9/模型6通过。人工criterion验收与整体交付接受语义分开；原timeline/机器FAIL/人工接受权威不改。详[0092](../../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)。

没有导入B新控制/工具、C sync guard或G运行身份作为默认权限。source/受控/安装/native/恢复/value继续分层，计分仍stable76/100、当前B55.7/95=58.6%，不按四线/测试数上调。

十位候选/dirty、12服务5180/8796至5191/8807、state/profile/tar/ledger/runs/五用户日志保持。自动真实vendor/model/native0，B cap4UNKNOWN不可花/E原pilotBLOCKED不变。无危险live信号/全局发现/新tar/用户实例操作；下一派工是更完整子系统，不再9→12加微阶段。
