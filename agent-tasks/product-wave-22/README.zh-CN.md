# 第二十二轮：真实业务attach与可交付恢复审阅

2026-11-13，固定wave21验收见[0059](../../docs/rfcs/WP-16/0059-wave-22-admission-and-implementation-milestones.md)。沿原A–E五个工作树/分支、scope、ledger、tar、报告继续，不重开项目。main712e191已接[0058](../../docs/rfcs/WP-16/0058-optional-frozen-source-scope-diagnostics.md)可选Scope诊断，默认接口与授权不变，UI尚未消费。

## 已关范围

A/C两格式actualpersonal恢复、合法新签窄Scope/排除路径和独立fresh负例通过，双方strict/build通过。B控制适配类型/postproof/intent四分支通过，可窄用于精确登记inspect/cancel，业务attach仍未实现。D595新包包含包内prepare+start、选择复用与拒绝；E旧sourceconsumer补installed问题关闭，但当前目标仍e4e且诚实因旧reuseFAIL阻installed。下一包不重复这些已关闭的修补。

## 三里程碑长包

| Owner | 整个结果包 | 第一 → 中期 → 最终 |
| --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | B恢复所需的实际持久事实与同包数据配方 | 原命令/投递事实 → 新进程一致读取 → 真恢复结果与双格式审阅 |
| [B](agent-b-runtime.zh-CN.md) | 真正same-Runner业务attach | 实际attachport → SIGKILL后原身份回答 → 恢复交付/资源归还 |
| [C](agent-c-context.zh-CN.md) | 可解释且不扩权的恢复来源 | actualscopeReview → 真实失效/回执 → 同包可参数化用户流程 |
| [D](agent-d-delivery.zh-CN.md) | 准确新安装包与完整交付闭包 | 595输入 → 同consumer真实审阅 → 稳定普通内测包 |
| [E](agent-e-acceptance.zh-CN.md) | 精确595或后继包的独立最终结果 | 正确REUSED终态 → 同包个人全链 → 分层required结论 |
| [main](main.zh-CN.md) | 普通发行闭包与业务恢复消费 | 已交Scope诊断 → 完整ordinary分发集成 → 真实attach/许可组合 |

## 持续执行与权属

每人建立/沿用整个结果包goal（不设token预算），十阶段、早/中/最终三个可运行checkpoint。提交后继续独立阶段，不等下一轮修自己的类型/断言/观测错误，不将partial或inspect/cancel当业务resume。外部依赖未到只标对应NOT_REACHED并转独立队列；场景有deadline、完整正对照/准确自有清理，不无限等人或凑测试数。

合并origin/main，保留B两旧report差异/untracked real-begin、C lock、E所有runs与用户日志，显式ownedpaths推原origin分支，main origin/main，不upstream/reset/清历史。状态写`wave22-status.json`，source/consumer/package/data/normal/recovered/native/value与原身份/行为/退出码单列。

main独占contracts/config/root lock/HTTP/provider/UI及集成；A storage/workflows/迁移；B原execution/driver/runner/native-acceptance；C context/proposals/knowledge/routing；D launcher/distribution/portability；E product-acceptance断言。跨owner交最小真实port/RFC，不新ledger、确认authority或执行生命周期，不专为probe新增空方法。

真实vendor model/native额度0，B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot继续BLOCKED，无reset/top-up/退款/补样/价格研究，goal不改预算。fake仅私有本机、不得回退真实CLI/网关；无新Driver/CAC/桌面/自动接受/动态DAG。

十二组5180/8796至5191/8807与全部state/profile/tar/ledger保留。仅独立证明probe出生PID/start/UID/root/operation可受信号，禁global socket扫描/其他credential。默认workflow1/显式2与personal-evidence/bundle另协议；数据subject相同不能认证不同consumer。变化运行字节先freeze再E最终验，docs-only不重冻，普通安装/读取不等target/试点。

分别转发[五段话术](forward-prompts.zh-CN.md)。`node agent-tasks/product-wave-22/verify.mjs`静态检查不授runtime/native/release。
