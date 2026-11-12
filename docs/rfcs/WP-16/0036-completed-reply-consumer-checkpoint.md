# 完成回复消费者与请求配置固定检查点

日期2026-11-12。源码`31ddd2658e96bfbe9084d8ffe6e16020dabca321`，前置接口`98a50ca`、本轮整包`0035`。这是主线M6的实际消费者检查点，A的持久结果port尚未集成；不宣称新表、跨进程恢复或新安装已准入。十阶段派工继续，不另开一轮。

## 实际行为

原链路先登记`assistant-request`，模型返回后直接写消息；若写消息失败，重试只知道请求已发送，无法恢复已经返回的答案。现在[CompletedAssistantReplies](../../../apps/coordinator/product/assistant-reply-results.ts)消费唯一A port，按以下顺序组合：

1. 原before-send command receipt仍先提交，原效果队列保持唯一发送入口。
2. provider真正完成返回后，将受限`AssistantReplyBody`写为内容寻址artifact；同一UoW登记artifact及`AssistantReplyResults.put`。
3. 上一步成功后才发布原`reasoner_reply`消息和事件。消息失败不会回滚已经保存的完成数据。
4. 同一effect重试先按原request读取结果，校验后补齐原稳定replyId；不调用provider。只有before-send receipt而没有完成结果时仍显示unknown，绝不自动重发。

校验包括原request digest、源消息的role/provenance/anchor、项目/会话、principal、model、reply双键、artifact/text摘要。只读取已登记的64位内容地址，最大512KiB，拒绝符号链接、大小/摘要变化和无关来源。恢复历史回复不重新申请执行权限，也不使过期上下文重新可发送。当前保存的`suggestions=[]`；结构化候选仍由C/main后续完成，不能把该检查点当候选功能完成。

`PrivateModelProvider.prepareReply()`同步捕获本次配置，公开model和配置SHA256，私钥只留在闭包；后续SDK调用使用同一份配置且每个prepared对象只发送一次。推理receipt摘要包含该配置digest。用户期间切换模型不会使旧请求记录与实际发送模型错配。原SDK流式、超时、取消、脱敏、禁自动重试保留；普通`reply()`兼容入口也走capture。

## A如何接入

生产端实现`store.workflows.assistant.replyResults: AssistantReplyResults`即可由`createProductRuntime`自动消费，无需新增HTTP/队列/数据库连接。`assistantReplyResults`显式参数仅为组合注入入口；没有生产port时当前个人版沿用既有unknown保护，不构造内存替代持久结果。

建议在A5–A8直接运行下面四组主线测试，再用真正A port关闭现有fixture：

```sh
node --test tests/integration/model-provider.case.mjs tests/integration/assistant-replies.case.mjs tests/integration/assistant-context-use.case.mjs tests/integration/assistant-context-product.case.mjs
node_modules/.bin/tsc -p apps/coordinator/tsconfig.product.json --noEmit
```

A仍需独立证明：结果写入与artifact登记同事务；put/replay的双identity不变；真实close/reopen与独立进程SIGKILL后可读；备份/库存包含新族与artifact；损坏结果精确拒绝。不能把本次afterCommit Map fixture当这些证据，也不要求添加第二发送生命周期。

## E如何验收

main已发布实际`createProductRuntime`消费者，E不用等待另一个HTTP接口。用真实A store、当前source和mock provider，制造模型返回后消息事务失败，关闭并重开进程：原reply只出现一次，provider总调用一次，selected-context audit保持原绑定。再分别注入结果登记前崩溃、无完成结果、坏artifact、foreign principal、旧source/错receipt、并发原请求与服务关闭。真实模型/native仍0。

## 本次证据与范围

四文件71/71通过，含现有上下文HTTP/SQLite/SSE回归；coordinator product strict typecheck和diff检查通过。新增HTTP用例确实重开SQLite，但完成结果port是明确的进程内fixture，因此仅证明消费者/原receipt/artifact组合，不证明A结果持久化。SDK测试只发到本次临时loopback SSE server，无真实模型请求。

来源与命令记录见[wave11主线报告](../../../reports/releases/wave11-integration/README.zh-CN.md)。原九组服务未重启/迁移，8796–8804健康检查均200；当前用户预览5188仍原4140cac/schema16。A端口到位并经过独立准入后再更新运行预览，不能把源码检查点说成在线功能已更新。恢复授权/target启动、普通安装、native及价值试点继续分别测量。
