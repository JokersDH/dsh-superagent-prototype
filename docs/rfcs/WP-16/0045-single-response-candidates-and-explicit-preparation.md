# 0045：单次SDK回复的非空候选与原提案链

2026-11-13，继续wave15 M2/M3。主线在0044实际factory后实现本检查点，消费C2e1c095的纯`reviewReplyCandidates`及原proposal parser/planner，不公开未准入的unknown-input verified wrapper。A表/迁移/执行生命周期不变。

## 同一个模型响应

PrivateModelProvider默认仍plain。私有配置/认证设置可显式启用`suggestionsEnabled`；准备请求时固定model、配置、数据schema及模式。现有一次`chat.completions.create({stream:true})`可以返回普通content或一个`assistant_reply`数据函数的{text,suggestions}。没有执行回调、tool result或第二个模型请求。

普通content继续原分段脱敏流式；tool-only正文在完整验证后一次显示。function name/arguments分块收集且有界，最多一call、8个共享ReasonerProposal、262144 argument bytes。未知函数、坏JSON/字段/绑定、多call、超限/length不给候选；已有普通文字继续保存，不扫描普通JSON/Markdown找指令，也不自动修格式重试。不支持tools的网关只失败一次，用户可显式关闭该模式后另行发送。

建议模式只附加当前source/project/有界Scope元数据，不读仓库文件；Scope超过16KiB时整份Scope省略，不把缩短版当授权。模型派生content和JSON字符串值在显示/保存前均进行密钥脱敏。模式、原始source文字SHA256与配置/schema digest进入原请求身份；后续切换不改变在途请求。

## 持久结果与候选

合法非空suggestions加入原AssistantReplyBody artifact，整体artifact digest覆盖正文与建议。原请求/结果/原始正文/metadata/principal/model核对保持；旧记录字段可省略。新的source文字SHA256与A source metadata算法一致，结果读取再次检查原请求/结果，source漂移不能重贴为新提案。

实际runtime新增：

- `GET /v1/messages/:id/candidates`：只读原普通用户消息的已完成结果，返回index/kind/summary/digest/缺输入；永远untrusted_data/authorization=none/executable=false。
- `POST /v1/assistant/candidates/prepare`：严格只接messageId/index/payloadDigest，服务端重读原body，以原index取payload并核对C审阅结果。不能由客户端提交payload、actor或verifiedBy。
- 原`ProductProposals.prepare/confirm/reject`继续唯一确认权威。签名token内部带原request/artifact/index/source digest；准备后原文或artifact变化会拒绝新的确认，确认前后所有原grant/source/work守卫仍有效。旧已记录确认回执仍按原身份重放，不再执行。
- `POST /v1/assistant/suggestions`：认证、严格JSON的bool设置；不返回key。restore-readonly保留读取、拒绝新准备/设置/确认。

`replyCandidatesAvailable`是公开配置的可选能力字段。未完成/旧缺来源证据的结果不提供可执行候选入口；C的reply-only项不变业务提案。work/revision仍要求用户明确scope/criteria/profile/goal等原输入，模型不能补权限。

## 验证和限制

新增SDK14项验证单请求、普通/工具正文、8类无效数据、特殊字符密钥、在途模式固定与不支持工具不重试。实际SDK→本地mock→真实HTTP/SQLite/artifact/C→原proposal事务的11项验证非空候选、确认/拒绝、明确work输入、严格DTO、权限/漂移与保存后发布失败恢复；另新增真实产品SIGKILL非空body恢复，模型重开调用0。

原回复/模型/提案/context product回归与上述组合85项通过，contracts原228加新2 schema测试、proposals26及coordinator strict通过。全部自动真实模型/native turn0；本地mock请求不代表用户网关的tools能力已认证。首次实现网页入口后将另作浏览器验收。

API依据：[official OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling/)，本次实际GET200并读取streaming/parallel/strict章节；已安装openai7.53.0声明也已核对。共享ReasonerProposal含strict Structured Outputs不支持的uniqueItems语义，因此数据函数采用strict=false并在本机完整共享schema验证，不引入另一套授权schema。
