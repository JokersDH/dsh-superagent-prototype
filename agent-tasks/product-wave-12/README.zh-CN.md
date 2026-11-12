# 第十二轮：可靠来源、真实控制与当前个人版交付

日期2026-11-12。继续原五个工作树/分支，先保留改动并合并最新origin/main。先读[0037验收与准入](../../docs/rfcs/WP-16/0037-wave-12-admission-and-product-delivery.md)、[固定证据](../../reports/releases/wave12-admission/README.zh-CN.md)，再读自己的packet。本轮每人十阶段、早期/中期/最终三个source检查点；检查点发布后继续，不逐阶段等待用户。

## 当前真实输入

- main `530085c`已按路径接入A回复结果/schema18/备份族，并以真实产品runtime做独立进程SIGKILL恢复；71条原主线+4条新进程测试通过。HTTP测试已移除内存结果替身。
- A `121ab84`包内87/88通过，但source扫描/重复事件两条与history work索引一条新反例失败。RecoverySourceStore没有接入main；raw history代码因依赖已在main，但其筛选未准入，尚无HTTP消费。
- B `4a40920`、C `553983b`的旧反例分别11/11、17/17关闭；新增B三条、C八条失败。B13测试自建表未驱动真实产品恢复，B8/B9未完成。main现有私有来源guard不撤销。
- D `ebcebe1`修复原requested-data-root stop，仍有install/config/recover/共享路径认领四条失败。其schema16新tar确实含context-use；E `fa45457`仍使用旧schema15安装结果。两者都不是main当前schema18安装准入。

## 分工和出口

| Owner | 长包 | 本轮可验收出口 |
| --- | --- | --- |
| A | [源完整性与持久数据](agent-a-data.zh-CN.md) | 正确的同事务逻辑快照、work完整性、真实主线回复/备份消费 |
| B | [生产控制与故障恢复](agent-b-runtime.zh-CN.md) | 原Store/队列/Runner被实际驱动，独立协调进程恢复，answer/steer/多槽位 |
| C | [来源到候选完整数据链](agent-c-context.zh-CN.md) | Scope/provenance/coverage不丢失的检索、冻结来源/历史、正确候选绑定 |
| D | [进程归属与个人安装](agent-d-delivery.zh-CN.md) | 所有有副作用命令精确归属、schema18当前字节冷安装/升级 |
| E | [当前源码与精确字节验收](agent-e-acceptance.zh-CN.md) | 动态实际能力断言、真实A恢复、同源UI/SSE与独立安装故障矩阵 |
| main | [产品集成与授权](main.zh-CN.md) | 来源历史网页、准确恢复baseline/授权、当前source冻结与产品收口 |

原有路径归属不变：main管contracts/application/questions/coordinator/console/root配置与lock；A唯一storage/workflows/生产迁移；B管execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C管context/proposals/knowledge/routing；D管launcher/distribution/portability；E仅product-acceptance断言。新共享语义先给最小RFC，main发布；不要复制私有wire、授权器或数据库。

在自己的worktree运行共享probe时，用`PA_ADMISSION_REPORT=/tmp/pa-wave12-<role>-probe.json`指定临时报告，或指定本角色拥有的报告路径；不要覆盖/提交main拥有的共享验收报告。默认位置仅供main本轮固定验收使用。

## 连续执行

阶段1–2交第一个可运行source；阶段4–6交第二个；阶段10交最终结果。每次明确actual source/命令/exit/范围，并push原origin分支，之后继续独立阶段。主线按最小source逐步准入。

缺外部输入时，只将对应组合列NOT_TESTED，提交最小复现/owner后转packet独立队列。所有独立成果完成再收尾；不能用重复测试、空等或无关扩展凑时长。普通个人安装不等待恢复激活或试点；先冻结真实字节再给E最终验收，不形成相互等待。

## 保持边界

自动开发和验收真实模型/native turn0。B旧cap4 UNKNOWN不可花；E原24turn（8作者+16复核）/200000计费token/USD5/单在途保持BLOCKED，不清账/补样本/退unknown。只做有限inert拒绝协议，不重做费用/recipe研究，不新增Driver/CAC/桌面壳/自动接受、writer racing或动态Ticket DAG。

保留九组5180/8796到5188/8804、全部state、原分支/工作树、私有账号和历史tar/账本。仅结束本次可证明自有PID/start/root/operation；共享install/cache/logs/workspace或模糊argv不能证明所有权。D危险cleanup在修复前只允许mock inventory/signals及本次自有进程测试。

静态检查：`node agent-tasks/product-wave-12/verify.mjs`，只验证派工，不代表产品/原生/安装通过。[五段开工话术](forward-prompts.zh-CN.md)可分别转发。
