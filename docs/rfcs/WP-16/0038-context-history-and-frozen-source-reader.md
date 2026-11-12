# 上下文历史与冻结来源读取检查点

2026-11-12，继续wave12/M2–M3，不另起派工。本文对应提交包含实际后端消费者、公共schema和HTTP回归；工作台接线后续同轮完成。真实模型/native0，原九组服务不重启/迁移。

## 已实现的读取入口

- `GET /v1/context/history?projectId=...&conversationId=...&workId=...&limit=20&cursor=...`：单项目必选，可按会话/work过滤，单页1–50。返回`ContextHistory`的原消息摘要、原确认时间/到期时间、合同、来源计数和签名续页。不是新的发送或执行授权。
- `GET /v1/messages/:id/context/sources`：核对原binding/双键、principal、项目、user角色/原文摘要与chat receipt，然后有界读取原artifact。返回`ContextSources`，原正文只在`state=verified`时存在；missing/unverified/scope_changed不含正文、omitted或injectionFlags。
- 原`GET /v1/messages/:id/context`保留；原context prepare/send/provider/SSE不换实现，不为查看历史重新生成来源或调用模型。

公共schema在`packages/contracts/src/context-records.ts`，runtime消费者为`apps/coordinator/product/context-records.ts`。生成manifest增加独立context-records产物，冻结Runner/data协议hash不变。

## 权限和完整性

history public cursor由main私有HMAC签名，绑定principal、当前配置Scope集合、project/conversation/work/limit、原A cursor和5分钟期限；未来时间、篡改、外来/过期/换筛选cursor拒绝。读取历史允许原预览到期；到期历史不成为新请求授权。

main再核对A page返回的实际project/conversation/work和每条binding/原receipt，不因底层query存在就信任返回作用域。缺原消息显示missing且不开放body；存在但身份/文本变化则拒绝。Scope缩小到不再包含原bundle Scope时返回scope_changed，连artifact正文都不读取。

来源只从原内容地址读取，先验registry ID/digest/bytes，拒绝符号链接，最多1MiB；在固定fd读取并校验完整bytes与SHA256，再核对frozen bundle的项目/会话/work/Scope/selection/request/expiry/source digest及原binding。不会用当前重新检索的内容冒充原上下文，也不因缺原文自动发送模型。

## 准入和消费者

`createProductRuntime`增加`contextHistory?: AssistantContextHistory`显式组合输入；A port仍是`store.workflows.assistant.contextHistory`。在A3派生work列修复准入之前，生产默认history保持未连接；只有明确组合测试传入真实A port验证main额外guard。`contextHistoryAvailable`反映这个实际状态，不靠schema宣称已可用。

`contextSourcesAvailable`独立于模型provider和发送能力，来源读取可在provider不可用或recovery_readonly中使用；只要binding/当前配置Scope仍能核对。A/C可直接消费真实入口与13项新主线HTTP/SQLite负例，E应继续独立断言，不改其测试。

## 本检查点验证

新契约2项、新HTTP/SQLite13项和既有assistant/context/进程75项通过；contracts全包226项、生成校验及coordinator product strict通过。覆盖分页/签名/跨principal/筛选/Scope变化、真实SQLite重开、过期记录、readonly、缺失/损坏/超限/symlink artifact、缺原消息、raw work错页和错误HTTP投影。模型发送0；UI尚待本轮实现，当前用户5188仍原版本。

## 同轮产品完成更新

后端源码e97e65a之后，A发布7a8e099，旧probe4/4通过；main仅接入work_id一致性校验与历史测试，并启用真实生产history。随后3d342fc/eea5fa2完成工作台预览/使用记录双视图、冻结来源可读正文、消息审计、跨会话工作筛选、返回原会话和手机焦点。A恢复源扫描没有因此整体集成或授启动权。

最终新增历史网页8/8及原流程9/9通过，505项非浏览器回归、strict/build/生成检查通过；独立审阅三项修正均resolved，ship仅覆盖该修正清单。新个人预览5189/8805使用独立schema18 state，原九组根不迁移/重启。当前实际范围和命令见[本轮完整交付](../../../reports/releases/wave12-context/README.zh-CN.md)。
