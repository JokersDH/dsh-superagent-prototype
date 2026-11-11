# Agent A：目标库只读验收与恢复一致性整包

继续`/Users/hh/Desktop/joker/superagent-agent-a`、`codex/g2-workspaces-verification`。先读本轮[README](README.zh-CN.md)、[0031](../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)及共享recovery-target.ts。仅storage/workflows，迁移唯一由你追加，真实模型0。

旧读回、RecoveryActivationFacts及activation快照family已交，不重复实现。大成果：D准备的新目标可由A真实只读验库，main取得完整数据观测并组合source/target失败窗口，备份/重开仍不继承执行权限。

## A1 先交真实RecoveryTargetInventoryReader

合并main，消费已发布的共享port，不创建私有替代DTO。只读打开指定target的state.sqlite，不创建/迁移/修复，报告schema、integrity、完整table分类/行数、一致字节摘要和问题；缺库/未来schema/未知table/busy不得变成空库。

元数据/业务表分类从实际schema注册推导并可审查，不能只查works和queue；包括旧权限、receipt、binding、session/业务消息等残留。目标业务为空不是物理writer停止证明。先push可运行库和真实SQLite recipe。

## A2 覆盖只读与不完整目标反例

验证symlink/错根/权限、SQLite损坏、表缺失/未知、WAL或并发修改、业务残留、schema13/14/15与未来版本。声明摘要覆盖哪些字节/一致快照，不能将未稳定的DB/WAL散列说成精确材料证明。

前后DB/目录/marker/queue字节不变，错误不触发自动迁移；completeness bounded/unsupported照实返回。schema有效JSON不成为启动许可，startupAvailable始终false。

## A3 与D材料和main source事务组合

消费D实际RecoveryTargetMaterializer和main binder/committer，用临时私有根验证source确认后空目标、目标部分写入、来源/配置变化、同身份重放。source事实/receipt仍同UOW，文件准备在事务外。

main实际commit/activate到达后补真实consumer，原source queue/marker不动。缺启动协议先交source/target读验半部范围，不用fake启动称已完成；继续A4/A5。

## A4 收口恢复材料快照与再恢复

现有activation family保持，补target inventory涉及材料/摘要的备份对照；完整DB与artifact引用一致，丢表/改行/缺bytes/过新schema给准确失败。target凭据/本机启动许可不进可携带bundle。

原schema13/14升级保持旧合同/决定/交付，新facts不从旧plan自动生成。再恢复必需新的显式确认和当前资源校验；禁止删除升级后数据伪装回退。

## A5 给主线可直接消费的交付证据窗口

复用已有evidencePage，交实际work/project分页、partial timing、source_missing/not_in_window和稳定游标recipe，main无需再猜表。重点覆盖新旧候选混合、跨项目、同时间多条和重开，只有实测必要才加索引。

与现有接受Outcome producer保持同事务/幂等，不重写producer，不从UI活动推质量或权限。外部UI未交则给准确owner，不改console。

## A6 连续回归与明确交接

运行owned包、实际main source/target消费者、快照/分页回归，维护`packages/workflows/reports/wave09-status.json`。交branch/base/source/迁移、port/fixture、命令与退出码、真实层级、限制和D/E步骤。

先A1后连续A2–A5，缺外部输入转独立项，不在首个检查点停止。只push原分支，root lock由main集成，保留七组服务/原账。
