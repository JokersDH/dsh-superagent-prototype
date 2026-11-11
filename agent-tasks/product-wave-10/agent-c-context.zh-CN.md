# C：来源闭环与对话上下文投影整包

继续原`/Users/hh/Desktop/joker/superagent-agent-c`、`codex/g3-assistant-context`，仅context/proposals/knowledge/routing。合并最新main，读本轮README/0033。当前main已有真实context HTTP/UI及14项后端检查，不再沿用旧“入口未发布”阻断。模型0，不自建LLM loop/SQL/HTTP/签名授权。

## C1 清理未消费helper与危险recipe

复跑main `probe-wave10-context.mjs <checkout> --helper-only`验证动态helper。相同effect ID异plan不得返回新可执行命令；优先移除尚未入main的confirmWithCommand helper/误导导出并迁移测试到main已用plan+commit路径，或完整绑定原receipt，不增加第二确认权威。修复推荐recipe的跨项目会话/permission display与全artifact registry纳入问题。

不带helper-only的两项recipe为固定旧实现的历史复现，不能要求它们随新adapter自动转绿；main拿到新导出后追加真实消费者准入。不要改composer来让旧坏recipe虚假安全，也不要降低旧历史断言。

既有composer provider预授权边界保留，不要求它从全局registry猜权限。旧grant/group-kind/预算/scan_incomplete探针继续通过。

## C2 交受限消息与已发布artifact adapter

复用现有ComposedConversationProvider/ComposedArtifactProvider。selection由main提供projectId/conversationId/可选workId及已验published artifact ID集合；adapter内部有界分页，筛project/provenance/问题锚点/其他work，返回清楚的scan不完整状态。artifact仅按已验ID get metadata，不全局枚举、不读文件字节/绝对路径。

将main当前实现行为作为兼容基线，早交可运行source checkpoint和类型，main再按路径替换重复adapter。无需等A绑定表或恢复模块。

沿用现有provider类型；factory可返回伴随只读coverage信息供main标记bounded scan，无需另改composer的预授权provider边界。

## C3 可复验manifest与变化比较

扩展现有buildSourceManifest，分别保留whole-source和visible-preview摘要，含截断/预算/遗漏及selection/合同身份。提供纯比较函数给main在重新授权、重读后比较，区分changed/missing/incomplete；不得让相同sourceId掩盖内容/预算或来源替换。未知扫描不得降为空知识。

它仅报告数据变化，不签grant、不保存确认、不宣称5分钟内来源保证不变。先交稳定接口，保持现有调用兼容。

## C4 有界prompt数据投影

从实际composition/manifest产出受预算限制的纯数据文本及引用，全部untrusted data。注入式文本只作数据；不生成system角色、执行工具、确认命令或权限。保留中文token估算与bytes/items总上限，截断后摘要准确。main将其交现有AssistantModelPort，不新增provider请求循环。

## C5 消费当前main实际HTTP与mock provider

复跑main ContextPreview和proposal/decision真实消费者；新增选来源→预览→重读变化/撤销/过期/合同切换的实际SQLite测试。main context-use到达后以mock AssistantModelPort核对准确文本/来源引用、旧命令重放不多发与并发隔离；未到达则清楚NOT_TESTED该接口，继续C6，不能自写替代HTTP或A表。

## C6 整包回归、文档与使用边界

运行四owned包typecheck/build/tests、旧两组probe、新adapter/manifest反例和main消费者；维护`packages/context/reports/wave10-status.json`。替换过期“main没context”的结论，列源码/导出/性能窗口/限制，明确项目决定共享范围和单条消息scope。只push原分支；不扩Driver/自动学习/自动接受，不触碰八组服务。
