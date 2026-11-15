# 第三十一轮：十路三倍范围完整产品交付

2026-11-15。主线303b2c6a。原A–J十位加main，不增新目录/分支，不设同日完成、工时或token承诺。用户要求上轮范围三倍：每位由4个完整子系统成果扩大为**3个连续交付包×4个完整成果=12个**，一次指令连续执行全部，交source后继续独立队列。

先读[独立验收](../../reports/releases/wave31-admission/README.zh-CN.md)、[0080主线新源码](../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)、[0081架构与输入](../../docs/rfcs/WP-16/0081-wave-31-reviewed-architecture.md)、[0082连续实施](../../docs/rfcs/WP-16/0082-wave-31-three-release-program.md)。下表是新工作，不是已完成证明。

## 十二成果与真正产品出口

| 角色 | 包一：4项 | 包二：4项 | 包三：4项 | 任务 |
| --- | --- | --- | --- | --- |
| A 数据 | 当前历史/覆盖/原Store消费者 | 两项目普通问答/检查/接受、未知回执与源级v1/v2恢复 | 日常分页/迁移/支持完整性 | [A](agent-a-data.zh-CN.md) |
| B 运行 | 安全出生+原Store/Broker三回调+同Runner接管 | 同原Work崩溃→候选→check→人工接受 | 原两/四槽、取消、重开与发行 | [B](agent-b-runtime.zh-CN.md) |
| C 上下文 | 上游truncated保真+当前真实读取 | 原提案/决定/来源连续流程 | 日常重开/双format/支持 | [C](agent-c-context.zh-CN.md) |
| D 发行 | 固定829包完整交接 | 确定R2新source后同包发行 | 同事冷装、升级、迁移恢复支持 | [D](agent-d-delivery.zh-CN.md) |
| E 独立验收 | 修安全全集合/ppid/oracle，再同829实际准入 | 两项目完整journey及固定R2验收 | 故障/迁移/支持与最终独立结论 | [E](agent-e-acceptance.zh-CN.md) |
| F 体验 | 当前工作台三kind/范围/窗口 | 新导出、草稿/错误/导航完整体验 | 重复使用/键盘/移动/支持 | [F](agent-f-experience.zh-CN.md) |
| G 观察 | 固定R1的观察语义、表格与报告基线 | R2默认导出实际消费者、格式/截断/快照全链 | 重复观察/支持、诚实产品结论 | [G](agent-g-insights.zh-CN.md) |
| H 运行支持 | UNKNOWN不kill+原实际consumer | 独立同原run恢复资源证据 | 两/四槽、重开、同包支持 | [H](agent-h-trial-operations.zh-CN.md) |
| I 通信 | 唯一原B消费者三回调 | 同原run重绑/未知/ACK | 有限资源、双client与长期支持 | [I](agent-i-coordinator-channel.zh-CN.md) |
| J 项目声明 | 当前facts/config/声明输入 | 三kind原表单→原交付 | 常见项目/迁移/支持适配 | [J](agent-j-project-recipes.zh-CN.md) |
| main | 默认导出、真实source、R1交接、历史组合 | 原Store/Broker恢复纵链与原槽 | R2安装/日常使用/迁移/整包结论 | [main](main.zh-CN.md) |

## 固定目标，减少等待

R1锁现成8296720d8a25f38c：source82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2，tarSHA04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543。它已真实包含0076窗口+0077模板，D197closure/6849项已验；E仍是1fba旧结论。E先pure修工具安全，再直接独立验R1，不等待移动main或因docs/test重冻。

R2是本次303b2c6a导出/J/B-I新source，先source交接，D在实际运行字节确定后冻结，E再锁定同tar；不借R1结论。R3做反复使用与同事支持，可复用固定已验包，不强制新tar。普通App/安装/观察不等原恢复/private/target/blocked研究。

各人source早/中/晚提交，持续整包与独立队列。外部依赖只阻对应项，不能只交一个小修就结束；PARTIAL/SOURCE_READY/NOT_REACHED明确。真正完成必须含实现、actualconsumer、合法positive/独立negative、source交接。132个计划成果不是完成率，旧测量分母与发行门槛不变。

## 开始方式

分别转发[十段话术](forward-prompts.zh-CN.md)。每人在[原目录/分支](workspaces.json)保留dirty/history，fetch并合并origin/main，读AGENTS/START-HERE/product-spec及自己完整任务包。只提交owned路径到原origin分支；main HEAD:main，不upstream。无需新chat/checkout，不复制用户state。

shared contracts/root/config/lock/HTTP/provider/App/transport/globalCSS仅main写，F trial/I attach-channel子树明确排除。A唯一生产迁移，E唯一产品assertions，其余原ownership完整保留。公开接口不足先交RFC/最小可编译consumer，继续owned独立队列，不复制第二套实现。

真实vendor/model/native0，B旧cap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED不reset/topup/refund/补样。十二用户服务及全部state/profile/tar/ledger/dirty/runs保留。完整独立birth/fullargv/UID/start/root/config/op/full资源先验，每signal fresh，UNKNOWNretain；无global发现/substringkill/借凭据/真实CLIfallback/新Driver/CAC/desktop/autoaccept/writer racing/dynamicDAG/第二生命周期。

静态检查：`node agent-tasks/product-wave-31/verify.mjs --workspaces`。只验派工/证据/依赖/ownership/预算，不运行产品或授予发行/native权限。
