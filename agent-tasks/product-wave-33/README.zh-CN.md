# 完整工程：十路整块成果与持续集成

2026-11-16。承接wave32固定提交的[验收](../../reports/releases/wave33-admission/README.zh-CN.md)，主线已实际续交fc38。目标仍是完整方案B工程（不含CAC），在集成工程中打包使用；不再突击临时ZIP，不用更多微阶段凑任务粒度。

每位一个wholegoal覆盖三个完整工程成果，可持续多个工作日；每成果含生产实现、真正consumer、必要合法正向/独立负向和source交接。早中晚发布后继续同一目标和独立队列，不在一个fix/helper/test处停工，无token/工时/同日deadline。main持续接入，不等所有分支完成才联调。

## 分工

| Owner | 成果一 | 成果二 | 成果三 | 任务 |
| --- | --- | --- | --- | --- |
| A | 生产历史有界source continuation | 原main兼容的真实历史consumer | 非空恢复/原artifact bytes/原ID重开 | [A](agent-a-data.zh-CN.md) |
| B | 不可伪造出生与原应用三callback/feed | 同一原Work中断后到检查/接受 | 原2/4槽调度、取消、归还重开 | [B](agent-b-runtime.zh-CN.md) |
| C | strict/草稿/expiry完整生产治理 | 当前决定快照用于新Work原确认 | 来源失效/普通重开/真实上下文 | [C](agent-c-context.zh-CN.md) |
| D | 真实普通运行/配置生命周期 | 同版本非空业务搬根只读恢复 | 升级/回退/支持/唯一closure | [D](agent-d-delivery.zh-CN.md) |
| E | 两原project完整真实旅程 | 唯一cohort actual outerZIP独立验 | 非空恢复/升级重开/完整停止oracle | [E](agent-e-acceptance.zh-CN.md) |
| F | 完整日常多项目用户流程 | 实际事实驱动首用/错误恢复 | 历史/来源/支持可访问性与移动 | [F](agent-f-experience.zh-CN.md) |
| G | 默认产品支持报告consumer | source/row/快照/导出完整语义 | 一次实际问题反馈与独立消费 | [G](agent-g-insights.zh-CN.md) |
| H | 当前exact源/field operations | 原run故障/回执/物理资源独立证据 | 非空重开/迁移恢复/故障支持 | [H](agent-h-trial-operations.zh-CN.md) |
| I | 唯一通道实际三callback/typed采用 | detach/terminal与原业务继任 | 有限压力/诊断/真实多槽交接 | [I](agent-i-coordinator-channel.zh-CN.md) |
| J | 生产普通项目声明完整适用性 | 两原root实际执行交付consumer | 迁移重识别/当前配置/实际交接 | [J](agent-j-project-recipes.zh-CN.md) |
| main | 原port之后的原guard/持久恢复接线 | A/C/G/J默认HTTP/App消费者/配置 | 同一版本整链集成与独立验收交接 | [main](main.zh-CN.md) |

## 已有输入，别重复做

[0083主线fc38](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)已经提供原`RunningAttempt.attachPort`和B新caller/4realStore回归，F六源+实际App retry/support；干净模板9/观察13网页、后端13、trial20、strict/build过。内部端口在原register/ready/current之后clone，不存在RFC示例的this.handle，不自动attach，不扩大原guard。

旧numericPID/复制handle/payloadreference-body/Hlaunchcommand/terminal/Cunknown问题已关，下一轮只补真实新缺口。B假spawn对象仍待关；C新草稿/expiry/strict、Eparentdead/noSet与journey/ZIPoracle要修。H早于ready的accept失败不是已证产品缺功能；等actions.available再验证。

详细边界：[0084验收](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)、[0085完整程序](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。main在本轮代码层已有实交，不只记录报告；各owner用该source继续原工程consumer。

## 原目录、一次下发、连续推进

分别转发[十段完整话术](forward-prompts.zh-CN.md)，仍在[原目录分支](workspaces.json)fetch/merge origin/main；不建新checkout，不复制用户state。完整goal中出现main接口依赖时，早发最小可编译约定与实际positive，再推进owned其它成果/兼容/失败/操作队列，不无限等待、复制第二实现或重跑长soak填时长。

状态写[dispatch](dispatch.json)的wave33 evidencePath，给source/dirty、实际consumer/对象、命令exit、准确source/inner/outer、已进main与仅候选、原始失败和未达。SOURCE_READY不等于installed或wholeproduct完成。A迁移、Eoracle、I通信、B/main/F排除子树都沿原所有权；sharedroot/contracts/HTTP/App/transport仍main。

## 工程集成与发行

D已有W32准确inner88eb/outer0a46，静态闭包真实，E目前实测仍R1。E先修拒假材料的oracle，绑定明确cohort；mainfc38确有新runtime时D再选后继冻结，E一次锁一个，不追移动main或因docs/tests重复打包。工程继续推进，安装是完整工程中的验证/最终交付环节。

自动真实vendor/model/native0，B旧cap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED不reset/topup/refund/补样/价格研究。十二实例和全部state/profile/tar/ledger/dirty/runs保留；完整原spawn身份/资源先验，每signal fresh，UNKNOWNretain，不global发现/substringkill/借凭据/绕refusal清理。无新Driver/CAC/桌面/自动接受/竞速writer/dynamicDAG/第二生命周期。

静态计划33项不提供完成率/发行/native准入；研究受阻不停止其它工程，但未测收益/协议/native保持未达。推显式owned路径到原origin分支，main HEAD:main，不upstream/reset/清状态。
