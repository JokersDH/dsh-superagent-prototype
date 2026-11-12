# 真实回复持久化与进程恢复检查点

日期2026-11-12，代码source `530085c`，A输入`121ab84818b9cb8204a67c4d639e69cbf5040ef2`。production schema18。仅origin/main推送，原五个worktree/分支及全部用户数据保留。

按路径集成A完成结果、context依赖、append-only v17/v18迁移、backup族与target库存。main原CompletedAssistantReplies/runtime现在自动消费生产replyResults；context-product测试已完全移除Map bindings/result，明确断言已完成结果必须恢复原正文，unknown必须不重发。

新[真实产品进程测试](../../../tests/integration/assistant-reply-process.case.mjs)经原ProductApplication/effect队列/A SQL：

- provider请求中SIGKILL：新进程仅显示unknown，provider调用0。
- 完成结果已提交、消息事务失败后SIGKILL：新进程读取原artifact，补一次原reply，provider调用0。
- 消息提交后SIGKILL：原结果和原reply不重复。
- 持久body损坏：拒绝补回且不再次请求provider。

主线执行：storage87、workflows71、assistant/context71、独立进程4、recovery-target/intent55，合计288PASS；storage/workflows build、storage typecheck、coordinator product strict与diff检查通过。模型provider均fixture或loopback mock，真实模型/native turn0。

网页补验：测试source`939a6fe`，[最终报告](context-browser-final/browser-report.json)9/9，真实A18 binding/replyResults、HTTP/React/SSE、desktop/mobile、丢响应重开与失效拒绝均通过；桌面/手机截图已检查。命令：`node tests/integration/assistant-context-workbench-browser.mjs --output reports/releases/wave12-integration/context-browser-final`。首次`deb3599`有一处测试旧变量引用，已在939a6fe修复；首次失败报告单独保留于`context-browser/browser-report.json`，不混作产品失败或覆盖最终结果。

没有接入A的RecoverySourceStore，也没有target启动授权。raw contextHistory因AssistantState构造依赖已带入，但work索引一致性反例未关闭，尚无公开历史HTTP/UI准入。C新检索/候选/B新helper/D全launcher都没有整包准入，现用main guard保留。

原九组5180/8796至5188/8804不重启/迁移。5188仍原4140cac/schema16；本source不能说成在线预览已升级。D需以本source及其所有权修复后新commit构建新tar，E按准确新tuple独立验收；ordinary install不等待恢复激活或研究。
