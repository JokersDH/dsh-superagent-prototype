# C：恢复期间的来源与决定一致性

**投入模式：按需支持，当前不自动开工。** 下文是触发后的职责边界，不是待办清单。只有main/B/H的原恢复或D/E固定包实际出现本模块阻断时才执行；否则保留现状并待命，不修未用候选、不做独立维护队列。

目录 `/Users/hh/Desktop/joker/superagent-agent-c`，分支 `codex/g3-assistant-context`；本轮已验输入 `d4ce6f67d06b2af32dfcee84207cf7217163ab61`。
先读[共同里程碑](README.zh-CN.md)、AGENTS/START-HERE/product-spec/README和[验收](../../reports/releases/wave37-admission/README.zh-CN.md)。保留dirty后fetch/merge origin/main，固定实际consumer source。原owned/excluded路径仍以[原表](../product-wave-36/dispatch.json)为准。

你负责原 Work 恢复所依赖的来源/决定边界，持续维护现有模块至集成结束。上轮 superseded 和 forged snapshotDigest 已经独立关闭，不再作为待修任务。

使用真实 AssistantDecisionStore.getSync 和原同步 UoW 边界，证明准备后撤销/替代/来源失效、重开以及 old Work 历史读取与当前新执行资格分开。沿用 prepareCommand→同原事务 current guard→commitPrepared；异步准备不是授权。

为 main/A/H 提供最小可消费的原 ref、失败码和跨重开正反例，修本 owned 包真正缺口。原 create 的 persistent selection 接线由 main 持有，本里程碑只在恢复必需时接，不为了填满包增加一条 UI/记忆产品线。


完成出口：主线能复用真实同步边界，旧选择不能在撤销后恢复成新批准，历史仍可读；源码/组件/default/安装分别说明。

被激活的具体事项交可运行source后，继续解决同一个consumer的集成和复验；无剩余实际阻断即可交回待命，不新建任务或独立队列。仅在现有状态文件补commit/命令exit/原IDs/剩余缺口，不额外生成大套报告。只显式owned路径提交到原origin分支，保留其他人的候选。

自动vendor/model/native和真实信号均0；Bcap4UNKNOWN不可花，原E试点本阶段不推进，材料/ledger不变。十二用户实例及state/profile/tar/历史保留；不新Driver/CAC/desktop/自动接受/第二生命周期，不global discovery、借凭据或绕stop拒绝清理。无工时/当天deadline/新token预算；无需用重复测试填执行时间。
