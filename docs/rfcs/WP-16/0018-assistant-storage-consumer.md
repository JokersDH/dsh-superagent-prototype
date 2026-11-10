# 主线：A/C持久状态联调与会话索引准入

日期2026-11-10；在版本化项目设置之后继续消费A `68852c0/a1748c1/1dddee9`、C `ed9d553/a59fcef/928d55f/45bf9de`。源码已集成；包内通过与真实存储联调分别判断，助理HTTP/provider/UI尚未开启。

## 已完成接线

A增加v11决定来源元数据/持久提案、v12会话成员索引。主线ApplicationConversations已改为向公开list/search传实际授权项目集合，并通过索引projectIds逐项检查混合项目。空数组不再用于发现全部，删除原每页扫描最多一万消息的成员缓存；加密且绑定查询的公共cursor、归档attention和跨项目拒绝保留。

旧主线测试人为将conversation.project_id置空，是为复现旧纯聊天目录缺失。新索引仍能正确找到该会话，预期更新为可见；后续混合项目/缩权/空授权/来源检查仍保持严格原断言，不以改期望掩盖权限回归。

C原三个独立失败现均通过：失效来源排除、confirmed重放仍校验actor、grant独立不可变快照。新模块包内context34/proposals18/knowledge26项通过；storage75、workflows15与application16范围分别测量。

## 实际SQLite消费者

运行`node tools/bootstrap/review-persisted-assistant.mjs`，使用真实ProductStore、createWorkflowPorts(store).assistant、AssistantProposalService、AssistantDecisionStore/DecisionGovernance和索引来源元数据；不创建第二writer、不启动HTTP/模型/编码任务。

| 场景 | 结果 |
| --- | --- |
| async prepare不写库，事务内pending落盘 | PASS |
| confirmation后receipt写入失败，提案与回执一起回滚 | PASS |
| confirmation+fixture command receipt原子提交，关闭DB重开，同操作重放 | PASS |
| 明确来源决定持久化并有效读取 | PASS |
| 同一决定通过governance重复record | FAIL，C adapter的expectedVersion映射不兼容A |
| 撤销并关闭DB重开，决定不再有效 | PASS |
| 来源missing后排除有效决定、保留审计行 | PASS |

失败信息为`WorkflowConflict: A decision update must advance exactly one version`。这说明C在in-memory实现上通过的重放没有覆盖A实际port。主线不改C拥有源码或削弱存储CAS，交 [C接线补充](../../../agent-tasks/product-wave-04/c-integration-followup.zh-CN.md) 修复与真实消费者回归。

决定仍需可用于同步UnitOfWork的prepare/commit入口：提案已经有该接口，async governance决定写入不能直接在main事务里await，也不能事务外先写后补receipt。该点是产品接线依赖，非虚构的已通过功能。

## 证据与范围

证据位于`reports/releases/assistant-storage/`，独立领域probe保存3/3 PASS，实际SQL消费者保存6 PASS/1 FAIL并非零退出；会话网页4项及项目设置5项在集成A/C后复验。旧发布证据保持原sourceCommit，不覆盖旧报告冒充新版本。

本批模型调用0，产品Assistant功能保持关闭，B/D/E候选与完整个人Alpha/发行准入仍按各自任务。用户5183个人预览运行的是已实测项目设置后端；A/C最新接口在其下一次正常重启后载入，不为集成测试停止用户实例。
