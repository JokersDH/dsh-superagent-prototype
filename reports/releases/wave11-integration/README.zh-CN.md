# 第十一轮主线检查点

日期2026-11-12。实际源码`31ddd2658e96bfbe9084d8ffe6e16020dabca321`；任务/验收包`d6303b3`、共享接口`98a50ca`。推送仅origin/main，原五个分支/worktree保留。

已实现：主线完成回复artifact/result消费者、原effect重试补齐消息、精确请求model/config capture。代码与接入步骤见[0036](../../../docs/rfcs/WP-16/0036-completed-reply-consumer-checkpoint.md)。A结果数据port未实现/集成时不会虚构持久性；当前运行预览没有更新。

## 已执行检查

| 检查 | 结果与范围 |
| --- | --- |
| `node --test tests/integration/model-provider.case.mjs tests/integration/assistant-replies.case.mjs tests/integration/assistant-context-use.case.mjs tests/integration/assistant-context-product.case.mjs` | 71/71；本地SDK SSE、真实SQLite/HTTP/原context绑定、结果port fixture |
| `node_modules/.bin/tsc -p apps/coordinator/tsconfig.product.json --noEmit` | exit0，包含exactOptionalPropertyTypes |
| `git diff --check` | exit0 |
| 原API `/v1/health` | 8796–8804均200，只读检查 |

新增覆盖：保存结果后消息失败再补齐；仅请求记录不重发；坏artifact/foreign principal拒绝；结果事务失败回滚artifact引用；request digest绑定captured配置；更换配置后prepared请求仍用旧model/key/token上限且只发一次；真实context HTTP消费者重开SQLite后补齐并保留audit。

结果port fixture仅在进程内afterCommit Map保存，测试没有证明结果行的SQLite持久性或进程恢复。真实A新表/备份/reopen/SIGKILL和E独立当前source验收仍NOT_TESTED。native/真实模型turn0，无收费试点、Driver/CAC/桌面或自动接受；九组用户实例和所有账本保留。

## 下一消费者

- A继续既定A1–A10，A5–A8可直接使用上述入口；结果生产port到位后由main按路径集成。
- E继续当前main独立产品与安装工作；新结果消费者的持久性用真实A新表复测，不继承本报告的fixture结论。
- main继续M1恢复逻辑source绑定、M5上下文历史和完成结果真实持久组合；D的普通安装不等恢复或研究。

验收前缺陷与长任务不另起清单，继续[本轮固定验收](../wave11-admission/README.zh-CN.md)及[十阶段任务包](../../../agent-tasks/product-wave-11/README.zh-CN.md)。
