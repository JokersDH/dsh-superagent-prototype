# 第八轮实际网页与生产恢复事实检查点

日期2026-11-11。主线实现`b436fde158a8dd14015c3705550bd3ff0d0fd307`；A生产源码检查点`fcf2563`已按拥有路径集成。此批完成明确提案网页及source审计查询，不构成上下文自动注入、恢复target启动、安装Alpha或新原生兼容准入。

## 1. 用户入口与实际行为

隔离开发预览：[http://127.0.0.1:5186/](http://127.0.0.1:5186/)，API 8802。使用新的`.local-state/wave08-proposal-preview`，原5180–5185和历史未重启/迁移。启动是personal模式、使用已有已测Codex版本配置；本轮只做健康/config/snapshot读取，预览初始工作/消息均0，没有发送模型或启动原生编码任务。它不是发行物或独立安装验收。

用户消息旁“转为提案”或顶栏“创建提案”打开明确操作：创建工作、修订工作、记录决定。预览显示来源消息、范围、执行器、检查和期限；修订显示原目标工作身份与合同版本。没有原消息/有效项目/必要机器检查时不能提交，不从普通助手文本猜执行命令。

配置新增可选proposalsAvailable，实际normal runtime发布true，recovery_readonly强制false；旧后端缺该字段时入口隐藏。新增transport仍使用公共schema与服务器actor，不接受浏览器注入权限。

## 2. 命令身份和错误恢复

预览只读，确认/拒绝调用0028真实HTTP及A/C事务。发送前将原完整command和preview保存在当前tab会话存储；网络/回执身份未知时保留原请求，刷新后“核对原请求”重放同commandId/body，不换ID创建第二次效果。

schema有效且身份匹配的rejected receipt即使HTTP409/422也会结束当前请求；来源变化拒绝不会陷入永远重试的unknown状态。没有可信回执或浏览器存储损坏时继续阻断，不清掉未知历史后允许新提交。

UI显式选择已配置scope/profile/criteria，服务端仍重验授权与合同；客户端状态不是权限或质量证明。创建/修订结果可导航到当前工作，拒绝和记录决定不新增工作。普通对话模型仍非结构化自动提案，本批入口来自用户明确操作。

## 3. A生产port和schema15

按顺序集成A `0c9ca71`、`9f1833d`、`fcf2563`，对应main `1ccffb7`、`fe2d101`、`e4402d3`。只消费A拥有路径，不改其迁移；schema14保留旧plan intent审计，schema15新增共享RecoveryActivationFacts。

旧envelope读回问题已修。实际port为`store.workflows.recoveryActivations`，get/forCommand/put同步加入source UOW；精确重放与冲突、main RecoveryIntentCommitter的原receipt/event、失败回滚及reopen已测。旧plan行不变成activation权限。

生产storage75、workflows43、build/typecheck通过。source持久事实已可消费，但A后续完整快照/发行组合仍以其最终证据为准，不能从此扩成所有恢复路径通过。

## 4. 实际只读source记录接口

```text
GET /v1/recovery/activations/:activationId
```

认证后读取A生产fact并核对原main确认receipt、完整内容摘要、command/activation身份及本地principal。缺receipt、普通业务receipt、摘要变化或错actor均拒绝。返回`recovery-activation-record/1`，内含原commit/sourceReceipt，但固定authorization=not_granted、startupAvailable=false。

读取不新增event、queue或授权，可在restore readonly模式查询审计；备份重开后读到旧事实也不意味着当前机器可以启动target。没有新增恢复commit/activate POST，原marker、旧业务queue与未知writer屏障继续保留。D不得拿这份客户端JSON作为可携带启动token。

## 5. 实测与设计审查

| 范围 | 结果 |
| --- | --- |
| 新提案真实HTTP/SQLite/browser | 8/8 PASS，clean source b436fde，1440×900与390×844 |
| console transport/fixture | 22 PASS，含来源/原命令/拒绝回执和actor注入 |
| storage/workflows | 75/43 PASS，含生产activation port与main source事务消费者 |
| 新source audit HTTP/存储 | 4 PASS，重开、无授权提升、错receipt、readonly鉴权 |
| proposal+source audit+恢复预检 | 20 PASS；另有相关HTTP/config/决定组39 PASS及A集成后33 PASS，范围有重叠不相加 |
| contracts / console / coordinator | 构建、生成一致性和相关typecheck通过；冻结Runner/data hash不变 |

浏览器8场景含：确认前无写入、创建一次并导航、多工作中选择原合同修订、记决定与拒绝无新工作、丢响应刷新原请求重放一次、source漂移拒绝结束unknown、跨项目/缺输入、过期项目解释禁用。所有执行effects未启动，模型0。

另在空personal预览用有界Playwright探针验证Enter打开、Tab不进入外部页面控件、Escape关闭/焦点回原按钮、320px顶栏无重叠及文档无横向溢出。原生浏览器chrome焦点边界保留；不将此扩为辅助技术或全应用审计。

使用impeccable skill沿用原视觉体系。独立review第一轮给两项P2，已补目标身份/版本和禁用原因；verdict pass为ship、两项resolved，仅评分该两项，不扩大为整产品。设计一致性记录保留原DESIGN/sidecar，未新增素材或视觉世界。Vite仍有既有约555KB主chunk的体积提示，本批未做无关打包重构。

## 6. 下一消费者与范围

A可基于已集成生产facts继续快照/最终恢复消费者；C可消费已实际发布的提案网页/HTTP，不再列“main没有proposal入口”；D可对source记录做审计查询，目标描述/准备/activate仍等main实际实现；E可在同源main独立执行新网页与source查询反例，main没有修改E断言。

M2明确提案网页已交。M1/M4仍欠实际target描述、准备和激活重入，M3还需准入C授权修复后接context/evidence网页，M5仍需同源安装物独立准入。第二Driver/CAC/自动接受/复核收益均未扩张；预算账未重置。
