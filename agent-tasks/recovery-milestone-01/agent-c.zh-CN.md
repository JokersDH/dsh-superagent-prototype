# C：恢复期间的来源与决定一致性

目录 `/Users/hh/Desktop/joker/superagent-agent-c`，分支 `codex/g3-assistant-context`；本轮已验输入 `d4ce6f67d06b2af32dfcee84207cf7217163ab61`。
先读[共同里程碑](README.zh-CN.md)、AGENTS/START-HERE/product-spec/README和[验收](../../reports/releases/wave37-admission/README.zh-CN.md)。保留dirty后fetch/merge origin/main，固定实际consumer source。原owned/excluded路径仍以[原表](../product-wave-36/dispatch.json)为准。

你负责原 Work 恢复所依赖的来源/决定边界，持续维护现有模块至集成结束。上轮 superseded 和 forged snapshotDigest 已经独立关闭，不再作为待修任务。

使用真实 AssistantDecisionStore.getSync 和原同步 UoW 边界，证明准备后撤销/替代/来源失效、重开以及 old Work 历史读取与当前新执行资格分开。沿用 prepareCommand→同原事务 current guard→commitPrepared；异步准备不是授权。

为 main/A/H 提供最小可消费的原 ref、失败码和跨重开正反例，修本 owned 包真正缺口。原 create 的 persistent selection 接线由 main 持有，本里程碑只在恢复必需时接，不为了填满包增加一条 UI/记忆产品线。

独立队列是现有来源/草稿/同步 guard 的兼容、可复现缺陷和恢复保留。停止扩 routing、复核、学习或第二协议研究。

完成出口：主线能复用真实同步边界，旧选择不能在撤销后恢复成新批准，历史仍可读；源码/组件/default/安装分别说明。

早交可运行source及必要source闭包后，连续支持本里程碑集成、修复、复验和上述独立队列，不逐fix等待、不把SOURCE_READY当整包完成。状态写原owned报告目录的 `recovery-milestone-01-status.json`，列commit/base/实际命令exit/原IDs/层次/剩余项。只显式owned路径提交到原origin分支；外部依赖只阻对应项，不改他人候选。

自动vendor/model/native和真实信号均0；Bcap4UNKNOWN不可花，原E试点本阶段不推进，材料/ledger不变。十二用户实例及state/profile/tar/历史保留；不新Driver/CAC/desktop/自动接受/第二生命周期，不global discovery、借凭据或绕stop拒绝清理。无工时/当天deadline/新token预算；无需用重复测试填执行时间。
