# 第二十一轮：可复用启动、真实业务恢复与同字节验收

2026-11-13。沿用原A–E工作树/分支和全部历史scope/账本/产物。审查见[0057](../../docs/rfcs/WP-16/0057-wave-21-admission-and-delivery-outcomes.md)，main新[0056](../../docs/rfcs/WP-16/0056-standard-start-reviewed-instance-identity.md)/f856fa5已接标准pnpm start和actual health读取选择匹配。

## 本轮出口

| Owner | 整包目标 | 三个可运行里程碑 |
| --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 双格式个人恢复数据与缩小Scope | 精确数据fixture → 两格式personal进程 → 同包recipe/失败重入 |
| [B](agent-b-runtime.zh-CN.md) | 完整控制proof到真正业务attach | 严格可编译port → 新协调器同Runner业务流 → 原身份恢复交付 |
| [C](agent-c-context.zh-CN.md) | 双格式来源审阅与可解释拒绝 | 合法窄Scope → 两格式personal只读 → 同包可参数化用户流程 |
| [D](agent-d-delivery.zh-CN.md) | launcher选择生效与新包交付 | 拒绝错误reuse → 新准确字节 → 同数据恢复/升级/交接 |
| [E](agent-e-acceptance.zh-CN.md) | consumer与数据同字节验收 | 不借source补installed → 新包personal恢复 → 同subject最终结论 |
| [main](main.zh-CN.md) | 标准启动后接可信恢复 | 已交f856 → 已有资源对账 → 业务恢复/私有许可组合 |

A两处strict已修，A/C真实personal CLI+demo进程读取已过，无新生产slice需合；下一包不是重修已关桥接。B旧3边界已关但port仍strict失败、返回preproof且只有inspect/cancel。D新e4e包含773读取入口但reuse未核对选择；E旧ee普通24项scope保留，新增两source-only review不能给旧ee补installed。

## 连续执行

每人建立/沿用整个结果包goal（无token预算），十阶段、三个可运行source checkpoint，提交/push后继续独立队列，不把第一个修补或partial当整包完成。外部依赖未到只对应NOT_REACHED；编译/断言/观测错误自行闭合，不等下一轮再定位。验收以用户行为、真实来源、原身份和资源结果为准，不靠测试数、标签或报告长度。

先合并origin/main，保留B两旧report差异/untracked real-begin、C lock、E全部runs及用户日志；只stage明确ownedpaths，推原origin分支，main origin/main，不upstream/reset/清旧产物。每阶段新进程/故障有deadline、完整正对照与精确自有清理，不无限等人或重复低风险循环。

状态写各自`wave21-status.json`。主线控制contracts/config/root lock/HTTP/provider/UI；A控制storage/workflows/迁移；B控制原execution/driver/runner/native-acceptance；C控制context/proposals/knowledge/routing；D控制launcher/distribution/portability；E控制product-acceptance断言。跨owner交最小真实consumer/RFC，不新ledger/确认权威/执行生命周期。

真实vendor model/native额度0，B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot继续BLOCKED，无reset/top-up/退款/补样/价格研究，goal不改变预算。fake仅私有本机，不能回退真实CLI/网关；无新Driver/CAC/桌面/自动接受/动态DAG。

十二组5180/8796至5191/8807及全部state/profile/tar/ledger保留。仅独立证明probe出生PID/start/UID/root/operation资源受信号，禁止global socket发现或别的credential。默认workflow1/显式2与personal-evidence/bundle另协议；同一数据subject不等于同一consumer字节。普通安装/个人只读独立于private启动/target/研究，变化运行字节先freeze再E验，docs-only不重冻。

分别转发[五段话术](forward-prompts.zh-CN.md)。静态检查`node agent-tasks/product-wave-21/verify.mjs`不授runtime/native/release。
