# Wave25主线：实际接入状态与八路输入

source `fdb3f160b1d867f7167fb034d96a5c13bd16cdfb`，见 [0064](../../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md)。GET /v1/readiness、共享schema/生成产物、typed console consumer与四导航action已实现，可供F/H立即消费。G使用既有outcomes/timing/evidence/attention，不因新API等待。

真实配置观察包括模型配置、项目/profile计数、execution公开状态、fixture/unknown/readonly，不包含名称/路径/model/endpoint/credential，authorization none。原鉴权、Host/Origin、恢复只读配置投影保持，未知不绿、fixture不当native、错误不被optional缺失掩盖。没有新UI或启动/检查/模型调用。

28项干净source组合通过，其中新readiness合同/传输/HTTP10项，含真实A Store/Node HTTP事件/模型增量0；其余是原HTTP/恢复回归。contracts232、product/http/console strict与generated通过，Runner wire hash不变。独立窄review3/3无实质问题。两次新fixture输入补正保留为测试开发过程，不改产品守卫，最终组合全通过。

F/G/H独立Git工作树从该source建立，原A–E/用户日志/十二服务保持；没有用户聊天代发或新模型额度。F/G/H的组件/分析/预检尚未完成，后续按四结果长包真正实现。source与静态准备不是installed/native/release准入。

状态见 [status.json](status.json)，工作目录见 [workspaces.json](../../../agent-tasks/product-wave-25/workspaces.json)，分别转发 [八段话术](../../../agent-tasks/product-wave-25/forward-prompts.zh-CN.md)。main继续实际消费者接线，原B业务恢复/private/target与普通产品分别验收。

派工静态检查通过：八位外部开发者加main、144阶段、每人四里程碑、48依赖节点、175本地链接。显式trial子树转授无路径冲突、无循环依赖，旧预算保持；JSON和diff检查通过。静态结果不授产品/模型/发布准入。
