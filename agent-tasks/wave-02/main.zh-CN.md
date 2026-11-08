# 主 Agent：问题中心、应用入口与纵向集成

继续主 checkout；本轮包为 WP-05、WP-10 确定性首版和 WP-16 增量。A/B 交整包，不再逐个小缺陷重新派工。主 Agent 保持契约/core/根锁/集成 owner，避免同时接管他们的源码。

## M1. 稳定接口与产品路径

- 维护 [集成约定](../../docs/rfcs/WP-16/0001-wave-02-integration-boundaries.md)，先提供主线 HTTP transport/公共 schema fixtures 和 A/B 导出适配；必要 wire 扩展由唯一 contracts 来源生成并验证兼容。
- 优先拉取 A backend-surface、B runtime-host 检查点，严格按提交复验后分段集成。不要求等 UI/native 整包结束才接公共基础。
- 根依赖与 lock 集成、跨模块测试和生产组合根由主线完成；B 的兼容 transport 提取例外期间，不同时编辑 `runner-link.ts` 和 RuntimeProducer 类型别名区域。

## M2. QuestionBroker

实现 `packages/questions/`：问题先持久、答案先持久再排 effect；完整 Question/NativeBinding/scope/version/connectionEpoch 验证；逐 target AnswerDelivery 与回执重放，未知不标 applied。

业务澄清只能在语义、scope、version 和有效期相符时复用；权限/认证逐请求。回答同事务失效旧 candidate，不重复 generic core Input。测试旧 RPC ID、不同整数/字符串 ID、停止后迟到、多 target 部分成功、平台与 native ACK 缺口。

使用 A 的产品仓储和既有 Answers，而非在 Broker 私建 SQL/第二个 writer。等待接口期间用相同 port 的 fixture 做模块测试，标明未集成部分。

## M3. ApplicationService 与 HTTP/SSE

实现 `packages/application/`、`apps/coordinator/http/` 和组合入口：

1. create/revise/stop/pause/resume/retry/continue/answer/accept 的确定性路径，commandId 幂等、可信 actor、project/anchor 归属、当前合同与物理屏障。
2. Work 只保留身份、版本、链接与投影；phase、可用动作、资源状态由 core/真实事实派生，不能让页面或新 Work engine 决定执行状态。
3. 持久主对话、问题中心、当前 Snapshot+cursor、SSE gap/重取、稳定错误、产物引用访问。
4. 使用原选型 Hono；本机认证、Origin/CSRF、body/response 限制和路径边界完整。浏览器不能提交 TrustedActor，Runner/fact 通道也不能伪装本地 human。
5. 组合 A 的验证交付和 B 的独立 Runner/Catalog/Driver。准备策略后才 begin；恢复不重派原业务；unknown writer 不放新写入。

先完成模型离线也可操作的路径。Reasoner 后续复用已有 runtime，首个闭环不自建推理循环，也不让一个 LLM 集成阻塞查询、回答、停止和验收。

## M4. 统一验收出口

运行 [整包排程](README.zh-CN.md) 的 G2-Demo-Fake 产品闭环。另设 native lane，仅在实际有配置、scratch 和预算时验证首个真实 Driver。统一记录 vendor/SDK/schema/config/policy/OS 身份、失败和 NOT_TESTED。

验收覆盖：主界面委托、原生问题回主入口、逐 target 答案、产物冻结、真实检查失败、当前候选接受、修订/停止、刷新/重开、coordinator SIGKILL、payload/receipt 恢复。UI fixture PASS 与产品 E2E/native PASS 分开。

本轮暂不把 CLI/发行、知识学习、第二协议或 CAC 加进关键路径。根状态只在证据通过时升级；不要把设计任务总数或测试数变成产品完成率。
