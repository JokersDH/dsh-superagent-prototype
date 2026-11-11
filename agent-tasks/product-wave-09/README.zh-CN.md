# 第九轮：恢复目标、上下文与托管升级收口

日期2026-11-11。审视基线7027d31，实际检查与共享端口见[0031](../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)及[独立验收记录](../../reports/releases/wave09-admission/status.json)。本轮沿用A–E原目录/分支、拥有路径和全部预算账；每人六阶段，先交可运行checkpoint，再连续完成独立项，不在一次修复后等待下发。

## 三个出口

1. main把已交提案工作台补成有来源/范围的context预览与交付证据闭环；C的两项新反例先关闭，不新建模型循环。
2. main/A/D把source确认、私有新空target准备、只读验库、当前资源校验及明确激活接成真实流程。共享schema/配置binder已经交，A/D可立即实现，不再围绕旧只读prepare打转。
3. B/D关闭候选中的资源/进程放行漏洞，E对最新冻结source和准确artifact tuple执行网页、托管升级与恢复验收。未通过路径保持关闭，旧结果保留精确范围。

本轮不扩平台：pilot仍BLOCKED，不重复费用上界调查，不开发新Driver/CAC/桌面壳/自动接受。B/E修复是有限的拒绝链与账本完整性，不为研究先搭更多平台。

## 大包与原工作区

| 角色 | 目录 / 分支 | 本轮成果 |
| --- | --- | --- |
| A | /Users/hh/Desktop/joker/superagent-agent-a · codex/g2-workspaces-verification | [目标库只读验收与恢复数据一致性](agent-a-target-inventory.zh-CN.md) |
| B | /Users/hh/Desktop/joker/superagent-agent-b · codex/g1-runtime | [可信资源屏障与不可重放发送](agent-b-trusted-runtime.zh-CN.md) |
| C | /Users/hh/Desktop/joker/superagent-agent-c · codex/g3-assistant-context | [种类/命令绑定及主线context消费者](agent-c-context-binding.zh-CN.md) |
| D | /Users/hh/Desktop/joker/superagent-agent-d · codex/g3-local-distribution | [私有目标准备和全进程升级](agent-d-target-and-upgrade.zh-CN.md) |
| E | /Users/hh/Desktop/joker/superagent-agent-e · codex/g3-product-acceptance | [当前source的网页/托管升级独立准入](agent-e-current-source-admission.zh-CN.md) |
| main | /Users/hh/Desktop/joker/superagent · codex/g2-execution-integration | [context与恢复激活产品闭环](main.zh-CN.md) |

开工先读AGENTS、START-HERE、product-spec/README、本页、0031及自己的专属任务。A仍唯一storage/workflows/生产迁移；B仍execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C仍context/proposals/knowledge/routing；D仍launcher/distribution/portability；E仅product-acceptance；main契约/application/questions/coordinator/console/root lock/共享文档与集成。D在portability实现材料准备属于已有所有权，不得自行授予启动权。

## 验收输入如何接续

A source f2bb24c的备份family已按ee7f382集成。C原四项grant检查通过，context/adapter仅按模块接入，HTTP未开放；新group-kind别名和confirmWithCommand ID不一致仍拒绝准入，该helper未合入main。

B ordinary JSON不能释放资源、token不能重放或换transport；D不能忽略孤儿apiPid或以空集合证明停止；E不得将unknown费用变0，也不能把两次start fixture叫托管upgrade。详见0031的精确反例，先修有证据的问题，不重做已关的旧v1迁移/firstRun/第二tar框架。

main当前真实提案UI/source audit在7027d31，context HTTP/目标激活尚未交。下一步优先补这些实际入口，不把它们登记为C或D的欠项。研究、原生控制、安装与恢复分层报告，禁止用某层PASS扩张全产品。

## 立即可并行的工作

A按RecoveryTargetInventoryReader做真实只读验库；D按RecoveryTargetMaterializer做私有材料准备及全资源停止；B修proof/token与生产consumer；C复跑两个新probe并修绑定；E闭合costOf→settle及当前source输入。它们都不需要等模型或main整包。

main已发布recovery-target共享schema与bindRecoveryTargetConfiguration；目标材料/观测startupAvailable一律false。main重读source事实和当前资源后才可最终激活，D不能拿JSON descriptor或目录/表为空自授权限。完整依赖见[dispatch.json](dispatch.json)，它约束最终组合验收，不禁止独立准备。

## 预算、实例和连续执行

newModelAllowance=0，所有本轮阶段真实模型发送0。B原wave03-b-native cap4余量UNKNOWN不可花；E原wave05-independent-review-pilot-01仍24 turn=8作者+16复核、200000计费token、USD5、一个在途、任一先到停，当前recipe封存BLOCKED。旧ledger不重置/转移/补样本/退unknown；价格/descriptor不能解锁。版本/非计费进程检查与真实turn层级分清，不重置账号或升级全局runtime。

保留用户七组5180/8796至5186/8802和所有state。只在临时端口/目录/项目做probe，子进程必须证明归本次操作才可停止；不pkill、不删旧queue/marker。只提交拥有路径并push原分支到origin，root lock由main生成。

遇外部依赖给source/最小复现/owner/所需输入后继续包内独立项，禁止无限轮询或用mock替生产依赖宣告通过。每阶段记录命令/退出码/层级；每人仅一份wave09-status，旧报告保留，清掉新权威状态中过期的“main无提案/缺第二tar”等描述。

最终交branch/base/source、checkpoint、拥有路径、actual命令/结果、证据/预算、限制与下一consumer步骤；安装额外交tar/hash/source/build/schema及准确所测操作。计划静态检查`node agent-tasks/product-wave-09/verify.mjs`不运行产品/模型，也不授予准入。
