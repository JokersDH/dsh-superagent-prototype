# 第十六轮：真实恢复与当前版本交付长包

2026-11-13。用户要求复验wave15后继续大颗粒并行开发。本轮保留原A–E五个工作目录、分支、所有历史结果及预算；不是重开项目。固定主线产品基线`a64a127`，已交M1–M3运行字节`1169535`。验收依据见[0047](../../docs/rfcs/WP-16/0047-wave-16-reviewed-deliveries-and-long-packages.md)和[固定输入报告](../../reports/releases/wave16-admission/README.zh-CN.md)。

## 已经可以直接消费的输入

- 实际默认C conversation/artifact factory、cutoff600、publication receipt与最终同步guard。
- 原SDK单次响应的非空suggestions、A18完成回复、候选GET/指针prepare与原提案确认/拒绝网页；默认关闭、无自动格式重试。
- 恢复source inspect/prepare的完整逻辑指纹；source confirm、私有许可、业务重连及target启动尚未交。
- 个人预览5191/8807与仅对话退化已有实现；普通安装可直接冻结当前准确源码，不等恢复激活或试点。

C旧报告“main缺factory/非空建议/UI”基于53b1598，不能当本轮阻断。E旧114b73c安装结果不认证D新8962d10或main1169535；分别保留原scope。

## 六条整包

| Owner | 本轮整包 | 必须交出的实际出口 |
| --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 完整备份证据与非空业务连续性 | 当前schema完整清单不可降格、实际候选/来源/问答/队列跨根恢复、原确认事务组合 |
| [B](agent-b-runtime.zh-CN.md) | 真实产品到独立Runner的恢复 | 实际begin/question/answer/cancel、独立受控writer、重开后业务feed、原身份交付 |
| [C](agent-c-context.zh-CN.md) | 当前主线来源与候选数据可靠性 | 消费真实GET/prepare而非手造verified wrapper、精确候选/来源诊断、跨根历史读验 |
| [D](agent-d-delivery.zh-CN.md) | 完整进程归属与当前源码个人交付 | 未知资源不漏、出生身份真实保存、安全多state/故障恢复、新建议UI准确冻结包 |
| [E](agent-e-acceptance.zh-CN.md) | 行为证据与同一包独立准入 | 可通过的完整正对照、逐项变异精确拒绝、当前包personal HTTP/UI/搬根/升级证据 |
| [main](main.zh-CN.md) | 实际确认、许可与跨模块接线 | 先交真实source确认消费者，后接获验B/D资源与本机许可；不以接口或材料冒充启动 |

## 连续执行方式

每个整包有十个阶段，按**早期可运行源码 → 中期组合 → 最终交付**三个检查点推进。提交和push不是等待点，完成一个阶段继续下一个。开始先同步已提交的`origin/main`，保留原脏文件及staging；不reset、不换工作树、不全量stage。已有模块成果沿用，新的验收针对本轮行为变化，不靠重复跑旧测试增加完成度。

任务量覆盖多个连续工作阶段，不规定靠等待凑时长。每项测试有明确风险、正负对照、deadline和精确自有资源清理。遇外部依赖，写NOT_REACHED及缺少的实际入口，立即转本包独立队列；禁止无限轮询、仅交计划或将模块fixture标成生产通过。不要修一个小点就结束整个包。

状态写各自拥有目录的`wave16-status.json`，逐项写实际source/消费者/命令/退出码/receiver/数据库或artifact证据/未到项。只有真实返回或实际动作能记完成；source、test、tar和运行实例身份分开。A保留全部迁移，B保留旧报告diff，C保留root lock diff，E保留所有untracked runs。

## 权属和停止条件

root contracts/config/lock、HTTP/provider/UI和共享docs只由main修改；storage/workflows及迁移只A；execution/catalog/policy-preparation/driver-kit/testing/drivers/runner/native-acceptance只B；context/proposals/knowledge/routing只C；launcher/distribution/portability只D；product-acceptance断言只E。

当前自动真实模型/native turns均为0。B历史cap4 UNKNOWN不可花；E原24turn/200000token/USD5/单在途pilot保持BLOCKED，无重置/补样/退款或新价格研究。fake provider/app-server必须是私有本机受控实现，不得落到用户网关或Codex账号。新增Driver/CAC/桌面壳/自动接受/动态Ticket DAG不在本轮。

保留十二组服务5180/8796至5191/8807、全部state/profile/历史tar。安全门前仅mock scanner/signals；任何实际清理只作用于独立证明的probe出生PID/start/UID/root/operation，不以路径、安装目录或记录自称作为归属。普通个人安装独立于激活和研究；docs-only提交不迫使重复冻结，实际运行字节变化才建立新subject。

## 转发与验证

分别转发[五段开工话术](forward-prompts.zh-CN.md)。本轮静态校验：`node agent-tasks/product-wave-16/verify.mjs`。静态PASS只证明分工、依赖、链接和预算一致，runtime/native/release准入始终分别看实际证据。
