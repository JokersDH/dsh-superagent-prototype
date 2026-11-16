# 安装预览交付：十条完整产品责任线

2026-11-16。用户当前首要目标是**在自己的M系列Mac使用，能把安装包发给同事试用**。首版先可用，再迭代体验和高级功能；CAC移出当前完整B，后续独立试验。

这一轮不再把所有远期能力当同一版的前置。每位拿一整块产品结果，连续做到可集成、能演示、能排障；交source后继续本块联调/修复和独立队列，不在小测试或一次小修后等用户再派工。不以更多编号或运行更久表示任务更大。

## 首版出口

1. 一个确切source/build对应的Apple Silicon ZIP，附Node和许可证，不要求同事具备开发仓/pnpm/全局Node；启动、停止、模型配置入口清楚。
2. 本机原CLI正常启动/准确复用/停止/重开，私有数据在用户自己的目录；未知状态保留，不触旧十二实例。
3. 主对话配置可理解；执行器已准入时，原项目明确委托→问题→检查/patch→人工接受走原产品链。缺执行器明确退化，不把固定fixture叫通用编码。
4. 首包身份与安装/界面/原项目/数据保留的必要独立验收对应；非关键体验可后续修，安全与虚假交付不放宽。

多协议、研究收益、CAC、完整活动故障恢复、桌面壳不阻首个普通预览；这些也不能因不阻首包就被记为完整方案已完成。完整B当前范围仍见[进度](../../docs/product/STATUS.zh-CN.md)，首包发布单独写范围。

## 并行分工

| Owner | 整块结果 | 任务 |
| --- | --- | --- |
| A | 普通双项目工作/原ID/历史/产物重开数据闭包 | [A](agent-a-data.zh-CN.md) |
| B | 原产品正常开发执行与问题控制、必要caller/工具修复 | [B](agent-b-runtime.zh-CN.md) |
| C | 项目上下文、明确决定、提案和来源的普通完整体验 | [C](agent-c-context.zh-CN.md) |
| D | 原stage/freeze到可分享ZIP的可重复生产线 | [D](agent-d-delivery.zh-CN.md) |
| E | 准确ZIP/原项目语义的独立新同事验收 | [E](agent-e-acceptance.zh-CN.md) |
| F | 首次使用、委托到交付、错误/移动/焦点的工作台体验 | [F](agent-f-experience.zh-CN.md) |
| G | 脱敏支持摘要、可信观察/导出和可复现反馈 | [G](agent-g-insights.zh-CN.md) |
| H | 有界新同事试用/排障/现场保留工具和指南 | [H](agent-h-trial-operations.zh-CN.md) |
| I | 唯一通信在原B/main中的完整consumer与terminal语义 | [I](agent-i-coordinator-channel.zh-CN.md) |
| J | 常见Node/npm/pnpm项目的实际可应用委托模板 | [J](agent-j-project-recipes.zh-CN.md) |
| main | terminal阻断、原共享接线、外层封装/Node、准确构建、实际启动集成 | 当前主线，不等待全部远期任务 |

## 怎么减少交互

各人建立wholegoal覆盖整条责任线，无token/工时/同日承诺。早发可运行source/公开接口，main逐块合入；接到反馈继续同一个goal，不新开重复实现。已有稳定接口直接消费，缺口早发最小约定并继续owned独立队列。

只在完整功能段交接或出现真实需要用户决定的阻断时汇报。报告source/dirty、实际consumer、合法positive/独立negative、命令exit、已进main/安装与未达；PARTIAL不叫完整交付。外部依赖只阻相应项，不无限轮询，也不用长soak填时间。

main先发布终态修复与可启动封装，原D构建流水线生成准确inner tar，外层portable packager只加运行时与入口、不改inner bytes。E绑定一个固定候选验，不追移动main；后续真有运行修复才出后继，文档/test修正不机械重冻。

同一轮所有人围绕一个版本的普通用户出口交付。原Work崩溃恢复、第二协议或创新pilot受阻不能停止F/J/普通数据与安装；但未达就从该版本声明中排除，不能假装已支持。

## 原目录与边界

原A–J十目录/分支保留，fetch/merge origin/main，不另建checkout或复制state。分别转发[完整开工话术](forward-prompts.zh-CN.md)，机器目录/owned paths/预算见[dispatch](dispatch.json)。早于本轮的未达项保留历史，本轮以当前首包结果重新排序，不伪称旧12项已全完成。

main唯一共享root/contracts/config/lock/HTTP/provider/App/transport/globalCSS与tools/bootstrap集成，F trial/I channel子树仍明确排除；D复用main外层封装接口，不复制安装器。A唯一生产migration，E唯一产品acceptanceassertions，其余所有权不变。

自动真实vendor/model/native0；Bcap4UNKNOWN不可花、E原24turn/200000token/USD5/oneflightpilotBLOCKED，不reset/topup/refund/补样/借账号或价格研究。所有十二用户实例与全部state/profile/tar/ledger/dirty/runs保留。独立原spawn完整birth/UID/start/fullargv/root/config/op/fullresources先验，每signal fresh，UNKNOWNretain；不global发现/substringkill/绕产品拒绝强清理。

范围是可分享个人预览，不是组织共享云/桌面/CAC/自动接受/全平台认证。外部Agent话术由用户转发，本次不声称十个用户chat已自动启动。
