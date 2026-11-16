# 0089：真实网页模型配置与原私有 Provider

2026-11-16，基线main6b306514。此检查点消费F固定d03a7872的表单/helper和model CSS片段，接到原设置面板与PrivateModelProvider；不新建设置中心或模型循环。source SHA及干净实际App证据见后续 `reports/releases/wave35-integration/`。

## 产品行为

原“偏好设置”里填写端点、模型名、API key，明确保存后写入当前实例已选择的私有配置路径。目录0700、文件0600、原原子写/rename/fsync；现有不合权限/链接/格式的文件拒绝覆盖，路径不能由网页输入。保存只校验和持久化，不调用模型，也不把 configured 写成连接验证成功。

主对话的后续发送继续原SDK streaming/no-retry和受限对话流程。网页配置不提供Codex原生账号、执行能力或额外模型预算，不自动生成回复/运行委托。原恢复只读middleware拒绝该POST。

HTTP需要用户显式勾选未加密传输；HTTPS默认。URL中的账号/密码/query/hash、key混入公开端点或模型标签被拒。输入只在当前提交中携带，响应仅现有AssistantProviderStatus；不能请求任意本机文件或回显key。

## 原接口与接线

- 加法 `AssistantConnectionInputSchema`：baseURL/model/apiKey/allowInsecureHttp，strict且有界。独立生成resource，不改冻结Runner v1 hash。
- `PrivateModelProvider.configure` 复用原配置验证与私有write。回复中拒修改；同端点保留允许模型/输出限制，换端点重新形成该端点模型列表。既有配置、提案设置仍遵原入口。
- 原认证 `POST /v1/assistant/connection` → 原read.configureAssistant→provider，无新业务command/ledger。safeParse错误使用固定文案，保留旧服务unsupported。
- `HttpTransport.configureAssistant` 检查当前端点/模型/已配置状态与无key回显，App只将同transport/auth identity的结果应用于当前界面。
- F组件在原ModelPanel呈现，表单字段不写浏览器storage；typed callback只调用上述入口，原切模型/提案开关/关闭与刷新继续可用。

## 对F候选的必要整合修复

独立复验发现原候选effect cleanup把mounted永久false，实际StrictMode effect replay后提交不结束；identity A→B清了transient key后，旧结果可覆B且失去原key的遮蔽参照。这两个候选问题不能随组件导入。

main整合时增加effect setup重设mounted、generation/currentIdentity隔离、独立submittedSecret遮蔽与同步重复提交守卫。当前身份/unmount失效后不应用旧promise；不承诺JavaScript字符串物理擦除。

新增saved结果与准确“已保存到本机；尚未发送验证请求。”文案。既有connected兼容但无message时不再显示失败；初始端点/模型status刷新不重置同次已完成结果。显式HTTP选项由main加到表单契约，不静默放开不安全传输。

## 验证与限制

新5 HTTP/private provider用例与原10 provider回归共15PASS，含认证/origin/恢复只读/严格输入/HTTP明示/私有权限/链接/原字段/重开/无自动网络。原contracts241、生成可重复性、coordinator与Console strict、Console build另记准确结果。真实App在原StrictMode入口验证保存、secret清空、重开、HTTP勾选、失败/旧服务、迟到unmount和桌面手机，必须有干净source。

该功能是当前实例配置，不升级用户旧十二实例，不修改他人配置/凭据，不触发真实vendor/model/native。真实连接/供应商能力、安装包、原Work恢复与收益单独保持未达。没有新依赖/迁移/新tar/第二lifecycle；B/I候选控制或信号工具未合入。
