# 0042：实际恢复预检消费逻辑source

2026-11-12。主线基于`6d24519`，最小接入A固定`3121ec46126a8579b45c7d128ee1700df4c82978`的source reader/strict fact mapper与source测试。没有接入A所有历史helpers/报告、改写迁移或开放恢复启动。

## 已实施

生产`store.workflows.recoverySource`使用同一Store连接。`ProductRecovery.inspect()`在现有UoW的只读savepoint内读取状态与A完整逻辑快照；公开`logicalSource`只含coverage/fingerprint，不暴露数据库内容、路径或原始异常。完整摘要加入原`inspectionFingerprint`，不再只依靠事件cursor、队列计数和work ID判断source未变。

实际runtime的`GET /v1/recovery/inspect`及`POST /v1/recovery/prepare`已消费它。逻辑内容变化即使没有新event也会使原指纹失效；bounded/unsupported/读取失败明确显示`source_checkpoint_unavailable`并拒绝绑定预检。项目、Git、executor与artifact预检后的最终检查仍会再次核对source。只有固定heartbeat字段可以忽略，writer身份与业务/队列/资源变化仍可见。

`recovery-inspection/1`和`recovery-plan/1`增添可选logicalSource及准确阻断项，旧省略字段的只读投影仍可解析。新生产者总是提供该项；旧指纹不能用于新预检，需重新读取。冻结Runner/data wire hash仍为`74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。

## 实际验证

- 新`tests/integration/recovery-logical-source.case.mjs`8项：实际runtime/HTTP/A18读取，未记录event的业务变化，heartbeat稳定与writer身份变化，未知表/缺表/未来schema，真实10001队列行触发bounded，准备期间未记event的数据变化。
- 上述新场景和现有preflight/activation audit/target service/target HTTP/restored-startup共66项PASS。
- 主线contracts228、storage87、workflows93及coordinator product strict PASS。A候选自身storage87/workflows105是另一范围，不能把其所有测试说成已整包集成。
- 预检不修改marker/原队列/绑定，不开始模型任务或旧业务工作。所有测试使用临时数据与本地进程，真实模型/native turn0。

## 尚未实现

这是实际source baseline的**inspect/prepare消费者**，不是完整confirm/许可消费者。A精确ignoreCommitted及现有RecoveryIntentCommitter的模块测试仍不等于公开确认流程。恢复确认、私有许可、target activation及真实物理writer核对尚需主线接线；所有输出继续`not_granted/commitAvailable=false`，逻辑complete从不证明物理writer停止。

旧十一组服务及其数据库没有重启、迁移或清理。D已经存在的M1包可继续按其固定运行字节独立验收，本次后端预检改动不能被冒充已经包含在旧tar中。下一阶段由A/E直接消费这里的实际HTTP入口，main继续确认/候选/授权产品组合。
