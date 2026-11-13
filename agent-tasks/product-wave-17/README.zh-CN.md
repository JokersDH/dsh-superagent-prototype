# 第十七轮：恢复源确认后的产品闭环长包

2026-11-13。继续原A–E五个工作树/分支及所有旧scope、ledger、tar、报告；不重开项目。wave16验收见[0049](../../docs/rfcs/WP-16/0049-wave-17-admission-and-continuous-packages.md)。主线已额外交付实际source确认`e32a3fc`，接口见[0048](../../docs/rfcs/WP-16/0048-actual-source-confirmation-checkpoint.md)，A/E不再等待只有schema的确认入口。

## 当前可用输入

当前main已有默认C factory、真实同次回复非空建议、候选GET/指针prepare/明确确认、上下文历史与原文。新`POST /v1/recovery/source/prepare`和`/confirm`在恢复只读实例记录真实A事实/回执，同UoW精确source重核；原请求可核对。它们始终not_granted/startupAvailable=false，没有私有启动许可、物理writer证明或target启动，旧十二组实例未自动更新。

A版本化v2/真实候选问答数据与C真实候选入口已证实进展；新版本混配/缺表和helper getter反例按范围处理。B真实spawn Runner收到begin=1成立，不能继续套用旧B14 begin0结论，但尚未加入Application/A Store/Broker或独立子writer。D97cace7准确包已含1169535建议版，E171PASS仍只认证旧8962d10。

## 六条大任务

| Owner | 完整交付目标 | 第一可运行出口 |
| --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 完整版本/required schema与真实恢复事务 | 版本配对和缺空表修复，消费新source确认 |
| [B](agent-b-runtime.zh-CN.md) | 准备协议→产品业务→独立恢复交付 | 使用原CodexProductDriver及fake executable真正发出policy.prepared |
| [C](agent-c-context.zh-CN.md) | 一致来源读验与恢复只读用户流程 | 当前候选/source审阅的真实readonly HTTP与拒绝变更 |
| [D](agent-d-delivery.zh-CN.md) | 每个资源独立归属与当前包交付 | 同UID child完整birth identity正负对照过门 |
| [E](agent-e-acceptance.zh-CN.md) | 终态/指针证据及同一包验收 | NO_OP/exit1、缺pointer两反例精确拒绝 |
| [main](main.zh-CN.md) | source确认后的私有许可及生产组合 | 已交e32a3fc，继续当前host/resources/target绑定 |

## 连续执行约定

每人十阶段，发布早期、中期、最终三个可运行source checkpoint；提交/push后继续独立阶段，不逐项等待用户或其他Agent。先合并已提交origin/main，保留B两份旧report差异及untracked real-begin、C lock diff、E全部runs，不reset/checkout覆盖、不全量stage。只推原origin分支，main推origin/main，绝不upstream。

每个阶段按实际入口/输入/动作/输出/退出码验收，写各自`wave17-status.json`；模块、主线组合、tar、运行实例、native/value分层。未知或缺依赖写NOT_REACHED并转本包独立队列，不能只修一个点就结束整包或用文档补PASS。不靠重复旧测试、无限等待或大量无风险循环凑工作时长；场景均有deadline、完整正对照及自有资源归还证据。

共享contracts/config/lock、HTTP/provider/UI/main消费者归main；迁移和storage/workflows归A；execution/catalog/policy/driver-kit/testing/drivers/runner/native-acceptance归B；context/proposals/knowledge/routing归C；launcher/distribution/portability归D；product-acceptance断言归E。其他人只提交最小port/RFC/consumer，不越界修改。

自动真实模型/native turn0；B旧cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot保持BLOCKED，无reset/top-up/未知退款/补样/新价格研究。fake只允许本机私有实现，不能落到真实Codex或网关。无新Driver/CAC/桌面壳/自动接受/动态Ticket DAG。

保留十二组5180/8796至5191/8807及全部state/profile/tar/账本。安全门前只mock；实际信号只能发给独立证明的probe出生PID/start/UID/root/operation，不能按同UID、祖先、路径或共享安装目录认领。普通安装不等激活或试点，冻结变化的准确运行字节后E再最终验，不因docs-only HEAD变化重复打包。

直接转发[五段开工话术](forward-prompts.zh-CN.md)。静态检查`node agent-tasks/product-wave-17/verify.mjs`不启动runtime、不构成release批准。
