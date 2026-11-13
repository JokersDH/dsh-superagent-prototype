# 第二十轮：个人只读恢复与精确业务重连长包

2026-11-13。沿用原A–E工作树/分支、全部scope/ledger/tar/report，读[0055验收](../../docs/rfcs/WP-16/0055-wave-20-admission-and-personal-recovery.md)。main新[0054](../../docs/rfcs/WP-16/0054-explicit-restored-personal-review.md)/773b34d提供真实personal恢复显式只读启动，不再等待入口。

## 当前实际基线

- main默认workflow-v1/显式v2、source确认与候选工作台保持。新`review-restored.mjs`显式生成绑定源/root/principal/host/Scope的私有五分钟启动配置，actual personal demo/workbench加载；未传flag不自动授读，业务/model/queue/target仍禁用。
- A199运行测试/build通过，但新fixture strict两错；C307/strict/build通过。真实Application/Broker→native_applied→同一快照第二根readonly/sourceHTTP成立，属于main controlled fixture，不是外部B崩溃恢复或厂商原生。
- B normal控制已过，新port是真实inspect/cancel wrapper，尚无业务流/fact-sink/Broker attach。foreign-source先cancel后报错、忽略登记inode与strict失败使新wrapper不准入；main原登记端点/认证cancel/barrier照常可用。
- E192PASS/16NT按精确b911普通personal同包scope成立。D新ee7fbd8闭包和child门、双版本读取通过，尚无E新包同subject最终结论。fixture readonly恢复不能外推personal，但本轮main现在已有真实入口可测。

## 六条整包

| Owner | 完整目标 | 早期实际出口 |
| --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | strict合格真实数据与personal恢复 | 修fixture类型，消费新CLI/真实personal进程 |
| [B](agent-b-runtime.zh-CN.md) | 精确控制适配与持久业务流恢复 | 身份/I-node/typing反例关闭，使用原A登记端点 |
| [C](agent-c-context.zh-CN.md) | personal只读数据与来源可用性 | 真项目403→显式consent→候选/history/原文可读 |
| [D](agent-d-delivery.zh-CN.md) | 当前只读入口的完整发行消费者 | 将已交参数传至真实personal entry并冻结必要字节 |
| [E](agent-e-acceptance.zh-CN.md) | 新准确包与个人恢复独立验收 | 动态双格式断言、同包个人只读前后结果 |
| [main](main.zh-CN.md) | 实际读取入口后接业务恢复和许可 | 已交773，继续原登记连接与可信消费者 |

## 连续工作规则

每人建立/沿用整包goal（无token预算），十阶段、早/中/最终三个可运行source checkpoint。提交/push不是等待点，继续独立阶段；接口未到仅对应NOT_REACHED，自己的类型/断言错误要先修，不能把partial当整个包完成。Goal不改变模型/执行预算。

先合并已提交origin/main；保留B两report差异和untracked real-begin、C lock、E所有runs及用户日志。只stage明确owned paths，推原origin分支（main origin/main），不upstream、不reset、不清历史。不以重复旧已关问题/无限轮询/低风险循环凑时长。

状态写owned路径`wave20-status.json`，精确source/producer/tuple、退出码、行为与资源；normal/recovered、source-fixture/installed/personal、pre-admission/native_applied、读取选择/源事实/启动许可都分开。每个真实进程/故障有限deadline、完整正对照和准确probe-owned清理。

共享contracts/config/root lock/HTTP/provider/UI归main；迁移/storage/workflows A；原execution/driver/runner/native-acceptance B；context/proposals/knowledge/routing C；launcher/distribution/portability D；product-acceptance断言E。跨owner交真实最小port/RFC，不另建ledger、确认权威或执行生命周期。

真实vendor model/native新增0，B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot继续BLOCKED，无reset/top-up/退款/补样/价格研究。fake只允许私有本机且失败不回退真实CLI/网关。无新Driver/CAC/桌面/自动接受/动态DAG。

十二组5180/8796至5191/8807及所有state/profile/tar/ledger保留。只对独立证明probe出生PID/start/UID/root/operation发信号，不扫描全局socket或借别的服务credential。普通安装/个人只读恢复独立于private许可/target/研究；实际变化字节先freeze再E最终验，docs-only不重冻。

分别转发[五段话术](forward-prompts.zh-CN.md)。`node agent-tasks/product-wave-20/verify.mjs`静态检查不授runtime/native/release权限。
