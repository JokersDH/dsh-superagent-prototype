# A：版本、schema与真实source确认恢复整包

继续原A目录/`codex/g2-workspaces-verification`，只改storage/workflows及自有测试报告。读README/0049，合并main新e32a3fc。旧v2 exact21family、真实SDK候选和问答数据恢复及87+109包回归成立，不能重新说原修复未做；本包收口新边界并消费实际确认。模型/native0，无新DB迁移需求不升级schema18。

## A1 格式版本必须成对

拒绝snapshot/1与evidence/2混配、v2缺familySetVersion、未来/未知组合。当前21family清单不可通过改外层版本降格为任意子集。旧真实v1以明确版本规则保留其能力，不能直接信任攻击者自称旧格式；原v2正对照与混版本篡改队列负例同跑。

## A2 required schema真实存在

当前schema18快照必须核对required tables/indexes及版本，而非把缺空表当空family。删除原本为空的assistant_reply_results也要拒绝。使用标准schema inventory/既有公开reader，不在测试里补建表求通过；未知/缺失/未来schema与合法legacy升级分开。

## A3 实际source确认事务

直接消费main e32a3fc两个source HTTP入口和原A facts/receipt；未到假设已解除。验证准备无写入、confirm唯一原事实、正常模式/签名/foreign principal拒绝、expiry/marker/profile/source变化拒绝与same-UoW额外写全回滚。阶段1–3交早期源码及真实消费者，不用模块committer替代HTTP。

## A4 exact ignoreCommitted与重放

核对只排除本笔事实/回执/两个精确event及固定heartbeat。之后相同body的新event、其他command/queue/runtime/resource变化仍可见。相同认证渠道原token丢响应重开核对原结果，不能重签/重做业务；跨渠道冲突与audit GET语义保留。

## A5 真实恢复只读启动

用当前实际SDK候选/确认决定或held工作、context来源和问答生成非空快照，搬到第二root后启动真实recovery_readonly runtime/HTTP。断言读得到原结果、旧queues held、无model/native重发、业务POST拒绝。现有第二ProductStore数据读取只是前置，不算此项完成。

## A6 恢复与确认中断

复用main新的source commit前后独立进程SIGKILL，增加本轮格式/空表与数据配方相关窗口，不重复相同测试计数。每次重开保持同command/fact及原artifact，partial backup不可用，missing result未知不重发。阶段4–6交中期source。

## A7 D/E可运行非空配方

交无需手工SQL/伪造verified marker的生成→snapshot→verify→第二根readonly启动配方，注明source/schema/格式pair/family-set/完整artifact及原请求。D/E可直接消费e32源确认正负例和版本混配/缺表反例。

## A8 历史兼容与能力边界

至少一份真实旧v1格式、一条legacy DB→18非空数据与当前v2保持区别。能读取旧格式不表示满足当前完整恢复/执行证据；不可通过旧格式标签提升能力。旧credentials、source确认或备份从不授新根启动权。

## A9 有界读取与失败成本

新增schema inventory/family配对早拒绝、读正文懒加载、扫描/恢复预算要有实际调用次数/bytes及deadline。已测1万binding与旧性能可引用，不机械重跑；不持SQL事务跨await或引入第二writer。

## A10 完整交付

写`packages/workflows/reports/wave17-status.json`，第三checkpoint及真实consumer map交main/D/E。明确当前source确认已实现，但私有许可/物理屏障/target启动仍单列。显式owned paths推原分支，每次交付后继续独立阶段，不修版本开关就停止整包。

## 独立备选队列

- 新许可/target未到：A1–A9数据与source确认均可继续。
- B恢复未交：使用已测正常真实问答数据，不拿B14合成row冒充。
- D/E冻结未到：先交可运行配方与稳定source，不反复等待。
