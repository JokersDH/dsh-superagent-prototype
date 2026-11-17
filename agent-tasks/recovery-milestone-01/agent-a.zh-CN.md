# A：原 Work 数据连续性

**投入模式：按需支持，当前不自动开工。** 下文是触发后的职责边界，不是待办清单。只有main/B/H的原恢复或D/E固定包实际出现本模块阻断时才执行；否则保留现状并待命，不修未用候选、不做独立维护队列。

目录 `/Users/hh/Desktop/joker/superagent-agent-a`，分支 `codex/g2-workspaces-verification`；本轮已验输入 `269c9c3af3c7049311574c8f1f1b6838a50e5548`。
先读[共同里程碑](README.zh-CN.md)、AGENTS/START-HERE/product-spec/README和[验收](../../reports/releases/wave37-admission/README.zh-CN.md)。保留dirty后fetch/merge origin/main，固定实际consumer source。原owned/excluded路径仍以[原表](../product-wave-36/dispatch.json)为准。

你负责恢复链路中原数据的连续性及失败定位，持续支持 main/H/E 至里程碑关闭。A269 的历史 reader 已与主线字节一致，本轮不再重复实现或申报新历史功能。

从原 Store 的实际 Work/合同/attempt/question/answer/command/delivery/候选/产物开始，提供非空 reopen、原事实重复 ACK、旧 epoch 与撤销后的查询/当前权威对照。历史有效性依原绑定判断，当前执行资格单独判断。

对 main 受控原入口提供可复用的真实 Store seed/读回与最小故障复现；缺失证据明确 unknown，不用直接插 accepted、候选新表或第二 ledger 补链。若发现生产持久化缺口，在原 owned 包修复并交最小 source 闭包，迁移仅你 append-only。


完成出口：同一非空 Store 在恢复前后保有原 ID/bytes/receipt，旧/foreign/撤销负例真实拒绝；main/H 可直接消费你的 source 和原始结果。

被激活的具体事项交可运行source后，继续解决同一个consumer的集成和复验；无剩余实际阻断即可交回待命，不新建任务或独立队列。仅在现有状态文件补commit/命令exit/原IDs/剩余缺口，不额外生成大套报告。只显式owned路径提交到原origin分支，保留其他人的候选。

自动vendor/model/native和真实信号均0；Bcap4UNKNOWN不可花，原E试点本阶段不推进，材料/ledger不变。十二用户实例及state/profile/tar/历史保留；不新Driver/CAC/desktop/自动接受/第二生命周期，不global discovery、借凭据或绕stop拒绝清理。无工时/当天deadline/新token预算；无需用重复测试填执行时间。
