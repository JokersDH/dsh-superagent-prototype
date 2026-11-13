# 0050：兼容现有v1备份的schema完整性检查

2026-11-13，基于main d494212/6050b4b与A6dc4bc5的独立验收。主线只接入已验证的readonly schema inventory/helper和快照create/verify检查，不整包替换A的v2 evidence或legacy兼容逻辑，不改迁移/schema18。

## 实际变化

`packages/storage/src/schema-inventory.ts`从既有迁移注册读取当前声明版本所需表和命名索引，readonly打开数据库。`target-inventory.ts`仅导出必要helper和既有精确FTS shadow集合，原target reader行为不变。

`WorkflowSnapshots.create/verify`检查真实required table/index、未知表、有效schema和未来版本，缺失空表也不能被解释成空族后通过。即使重记数据库hash，缺assistant_reply_results、required index或冒充FTS前缀的未知表都拒绝；缺schema_meta/无效schema安全阻断。v1 verifier明确只接受已准入evidence/1。

仍生产`workflow-snapshot/1`和`workflow-evidence/1`，保留现有完整digest比较及13族旧摘要配方。特别是非空assistant_context_bindings族没有突然加入derived work_id，旧主线真实v1备份的摘要保持可核对。没有宣称支持A的新21族v2格式；未改变的历史兼容缺口仍归对应owner收口。

## 为何只接此范围

本轮A的旧混版本/缺空表反例已经关闭，但主线真实v1 producer产生的非空binding备份，在A新verifier中仍被拒绝：旧族digest51d53c57...，新含work_id配方7022d0a2...。A原legacy单测是重标v2清单并截两族，未覆盖这一真实历史producer。

完整迁移到v2之前必须按真实旧producer recipe验证，不能为接入新族而破坏现存备份。本次安全检查切片独立于该兼容路径，保留原主线v1语义；A/C分支、旧tar和用户数据均不修改。

## 验证范围

- 新7项实际SQLite/snapshot测试：真实v1非空binding、固定旧族digest、readonly验证、缺空required表/索引/metadata、未知FTS-like表、无效schema创建及不支持evidence版本拒绝。
- 新7与原source确认14/逻辑source8组合29PASS；其中source确认仍覆盖原两个独立进程SIGKILL窗口，无新启动权限。
- 主线storage87/workflows93、两包typecheck/build及coordinator product strict通过。这是主线已集成范围，不把A分支196项说成主线全量集成。
- 没有模型/native发送、SQL迁移、旧queue消费或服务重启，十二组服务/state/profile/ledger/tar保留。新schema检查不授writer quiescence或target启动权。

代码入口：`packages/workflows/src/snapshot.ts`、`packages/storage/src/schema-inventory.ts`及`tests/integration/snapshot-schema-admission.case.mjs`。D下一次变更运行字节时合并本检查点再冻结；E按实际tuple验证，不能将此后来源码的检查借给旧包。
