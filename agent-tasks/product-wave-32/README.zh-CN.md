# 完整工程推进：十条完整产品责任线

2026-11-16。用户最新澄清：**加速完整方案B工程，之后在完整工程中打包、在本机使用并分享同事**。不是本轮先突击一个功能收窄的临时包。CAC移出当前完整B，后续独立试验；首个支持平台仍是macOS Apple Silicon。

这一轮不再把所有远期能力当同一版的前置。每位拿一整块产品结果，连续做到可集成、能演示、能排障；交source后继续本块联调/修复和独立队列，不在小测试或一次小修后等用户再派工。不以更多编号或运行更久表示任务更大。

## 整体工程出口

1. 主对话、项目/会话、明确委托、合同修订、原问题/审批、检查/patch/人工接受在原产品链闭合，正常错误和版本退化可理解。
2. 同一原Work的故障接管到候选/检查/接受、准确资源停止、原两/四槽归还与持久重开有真实消费者；未知保留，不用新Work/fixture registry补恢复缺口。
3. 历史/上下文/来源/明确决定/提案/观察/项目模板形成日常可用助理，跨项目、覆盖和失效语义真实，不只是模块接口和孤立helper。
4. 发行子系统并行完成可重复build/install、私有配置、生命周期、升级/回滚、非空备份/恢复和支持。集成版本达到相应工程出口后，再冻结准确包、独立验收并交付使用，不让临时封装取代整体建设。
5. 多协议及创新方向按完整B既定接口/实验门槛推进，实际原生/研究收益单独验收，不能为追速度刷新预算或拿mock结论补齐。

CAC及CAC专属subteam暂不做，桌面壳仍后置。研究受预算门槛约束时，已有工程独立队列继续，不等实验才开发；同时不能把未达创新、多协议或恢复标成完整B已完成。当前范围见[进度](../../docs/product/STATUS.zh-CN.md)。

## 并行分工

| Owner | 整块结果 | 任务 |
| --- | --- | --- |
| A | 普通双项目工作/原ID/历史/产物重开数据闭包 | [A](agent-a-data.zh-CN.md) |
| B | 原产品正常执行/问题/控制与同原Work恢复到交付、真实槽归还 | [B](agent-b-runtime.zh-CN.md) |
| C | 项目上下文、明确决定、提案和来源的普通完整体验 | [C](agent-c-context.zh-CN.md) |
| D | build/install/启停/升级/回滚/非空迁移恢复的完整发行子系统 | [D](agent-d-delivery.zh-CN.md) |
| E | 整体产品真实用户旅程、运行控制、恢复与准确安装的独立验收 | [E](agent-e-acceptance.zh-CN.md) |
| F | 首次使用、委托到交付、错误/移动/焦点的工作台体验 | [F](agent-f-experience.zh-CN.md) |
| G | 脱敏支持摘要、可信观察/导出和可复现反馈 | [G](agent-g-insights.zh-CN.md) |
| H | 有界新同事试用/排障/现场保留工具和指南 | [H](agent-h-trial-operations.zh-CN.md) |
| I | 唯一通信在原B/main中的完整consumer与terminal语义 | [I](agent-i-coordinator-channel.zh-CN.md) |
| J | 常见Node/npm/pnpm项目的实际可应用委托模板 | [J](agent-j-project-recipes.zh-CN.md) |
| main | 架构、公共契约、应用/runtime/HTTP/UI和十路真实消费者持续集成 | 当前主线，不以临时封装为主任务 |

## 怎么减少交互

各人建立wholegoal覆盖整条责任线，无token/工时/同日承诺。早发可运行source/公开接口，main逐块合入；接到反馈继续同一个goal，不新开重复实现。已有稳定接口直接消费，缺口早发最小约定并继续owned独立队列。

只在完整功能段交接或出现真实需要用户决定的阻断时汇报。报告source/dirty、实际consumer、合法positive/独立negative、命令exit、已进main/安装与未达；PARTIAL不叫完整交付。外部依赖只阻相应项，不无限轮询，也不用长soak填时间。

main持续接入已验源码和真正产品consumer：先合有用接口/正常正向，随后同一目标补完整错误/故障/兼容，不等待所有枝一起交完。D同步维护构建和发行能力；选定集成版本后E绑定准确字节验，不让E追移动main。文档/test变化不机械重冻。此前临时封装工具及试验产物保留作工程资产，当前不继续安装冲刺、不称正式交付。

十路围绕完整产品各自持续推进。B/I恢复、第二协议或创新pilot受阻只阻对应出口，不能停止F/J/数据与发行；main负责拉通共同依赖和真实纵链，未达不假装已支持。减少交互的办法是整块责任+稳定接口+持续集成，不是暂时缩掉难点。

## 原目录与边界

原A–J十目录/分支保留，fetch/merge origin/main，不另建checkout或复制state。分别转发[完整开工话术](forward-prompts.zh-CN.md)，机器目录/owned paths/预算见[dispatch](dispatch.json)。早于本轮的未达项保留历史，本轮按完整工程的能力依赖重新排序，不伪称旧12项已全完成。

main唯一共享root/contracts/config/lock/HTTP/provider/App/transport/globalCSS与tools/bootstrap集成，F trial/I channel子树仍明确排除；D复用main外层封装接口，不复制安装器。A唯一生产migration，E唯一产品acceptanceassertions，其余所有权不变。

自动真实vendor/model/native0；Bcap4UNKNOWN不可花、E原24turn/200000token/USD5/oneflightpilotBLOCKED，不reset/topup/refund/补样/借账号或价格研究。所有十二用户实例与全部state/profile/tar/ledger/dirty/runs保留。独立原spawn完整birth/UID/start/fullargv/root/config/op/fullresources先验，每signal fresh，UNKNOWNretain；不global发现/substringkill/绕产品拒绝强清理。

最终使用形态是本机产品与可分享的安装交付；组织共享云/桌面/CAC/自动接受/全平台仍不自动纳入。外部Agent话术由用户转发，本次不声称十个用户chat已自动启动。
