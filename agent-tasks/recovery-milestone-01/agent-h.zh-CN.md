# H：同原Work接管与原槽的独立消费者

目录 `/Users/hh/Desktop/joker/superagent-agent-h`，分支 `codex/g4-trial-operations`。保留原历史/状态，fetch并merge origin/main；读AGENTS、共同README和[验收](../../reports/releases/recovery-milestone-01/admission-2026-11-18.json)。当前main `d6244e63`，本轮H `caa48df7`。

**主动，只复验同一原恢复结果。** 旧reopen测试明确调用product.close，binding真实ended，拒绝旧问题是正确行为；保留为graceful-close反例，不要求ended复活，不把它当存活Runner的crash恢复或新source回归。

1. 独立消费main新original-native-recovery原入口：一个未完成Work已有问题，旧coordinator worker自行process.exit绕过close，父宿主保留原Runner；旧Store退出后新Store接管。核同Work/attempt/question/session、原native_applied/check/currentCandidate/available人工accept/原产物，而非仅看main自报PASS。
2. 保留主线撤销授权/profile/policy变化/资源UNKNOWN拒绝对照，独立核原receiver写/Runner/begin计数。虚拟ProcessHost明确标注；真实EOF/旧stdout寿命由B实际consumer交来再复验，不把父宿主保流当真实进程证明。
3. 在同一个原执行/Store/core/queue消费者覆盖写入已发生但回复丢失的窗口，核原commandId/回执调和、无自动重发；再核原2/4容量、第五项等待、UNKNOWN占位、已确认资源归还后的前进。缺产品入口先给main最小复现，不能另建scheduler/ledger或直接改原表。
4. 只在tools/trial-kit/tests/operational-soak原owned范围交消费者/原始事实，不改main/B/I生产或E断言。真实模型/native/信号0，不运行liveSIGKILL、危险close fallback或global discovery；物理证据未达保持NOT_TESTED。

交可运行最小source及同run原IDs/实际exit/未达层，与main/B持续同结果复验；无剩余阻断待命。不要重做正常矩阵、固定包安装或独立维护队列。只推原origin分支，保留所有用户实例与状态。
