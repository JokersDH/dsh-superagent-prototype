# I：唯一通信层的恢复支持与安全收尾

**投入模式：按需支持，当前不自动开工。** 下文是触发后的职责边界，不是待办清单。只有main/B/H的原恢复或D/E固定包实际出现本模块阻断时才执行；否则保留现状并待命，不修未用候选、不做独立维护队列。

目录 `/Users/hh/Desktop/joker/superagent-agent-i`，分支 `codex/g5-coordinator-channel`；本轮已验输入 `14ea58c70730ad50032415257e0b77eb5ff2c654`。
先读[共同里程碑](README.zh-CN.md)、AGENTS/START-HERE/product-spec/README和[验收](../../reports/releases/wave37-admission/README.zh-CN.md)。保留dirty后fetch/merge origin/main，固定实际consumer source。原owned/excluded路径仍以[原表](../product-wave-36/dispatch.json)为准。

你负责原 sole attach-channel 的恢复通信支持，持续协助 main/B/H，不再实现第二套宿主/生命周期。主线42f6daab已从实际 Native.launch 返回对象激活回调，I host不是这条默认路径。

未采用的I37-HOST-SHUTDOWN-DELETES-BORROWED-PARENT-STATE保持登记且禁止使用，不是当前main的前置；如未来明确采用才修：构造时借用stateRoot、零launch再shutdown不得删父目录或sentinel；只删除自己确切创建且确认收尾的run目录。分别测借用父目录、自己建临时root、重复shutdown与UNKNOWN保留；不以便利factory绕主边界。

维护detach/rebind、原factId durable ACK、payload body/预算/新intent相关ID/fresh guard和terminal拒绝。已pending写意图断连仍indeterminate，不迁移批准、不自动重放命令。类型客户端inspect/cancel不得伪装main VerifiedRunnerInspection物理proof。

给B/main/H提供与现有模块ABI一致的最小source/故障consumer。Native的SpawnedRunner/eagerPrepare/同stateRoot已有main adapter，不再增加不兼容RunnerHost替换方案或复制B auth/dispatch逻辑。


完成出口：借用状态树完整保留，原通信反例通过且实际consumer使用相同实现；模块close不等物理quiescence。

被激活的具体事项交可运行source后，继续解决同一个consumer的集成和复验；无剩余实际阻断即可交回待命，不新建任务或独立队列。仅在现有状态文件补commit/命令exit/原IDs/剩余缺口，不额外生成大套报告。只显式owned路径提交到原origin分支，保留其他人的候选。

自动vendor/model/native和真实信号均0；Bcap4UNKNOWN不可花，原E试点本阶段不推进，材料/ledger不变。十二用户实例及state/profile/tar/历史保留；不新Driver/CAC/desktop/自动接受/第二生命周期，不global discovery、借凭据或绕stop拒绝清理。无工时/当天deadline/新token预算；无需用重复测试填执行时间。
