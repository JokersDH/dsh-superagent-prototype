# 接受结果投影与恢复预检检查点

日期2026-11-11。输入main `6f6edde`与A `3b43728`/`aec24b7`，新增代码全部为main组合/公共companion及集成测试；未修改B运行时、C领域规则、D发行或E断言。模型任务0，旧预览5180–5185不重启。状态：有限接口检查点，M4授权提交与个人Alpha仍未完成。

## 1. A接受投影的生产组合

已合入A的AcceptanceOutcomeProjection。在一次新attempt的begin之前，main记录私有`attempt-profile-snapshot/1`回执，绑定完整AttemptSpec、准备后的政策、可执行文件当前字节摘要、平台/架构/运行时。profileRef的digest可解析到该次审计快照；它不是Catalog的可调度准入引用，也不用于跨attempt质量排名。

控制fixture标controlled；native目前仅标operator_note，不因为厂商名字或本次元数据采集就授予actual_native层/新的兼容认证。可执行摘要是begin前所观察路径的字节，不能独自证明已启动进程加载的二进制或原生全部配置；真正native准入/资源证明仍分别由原链路/B实证负责。快照保留在私有命令回执，不将启动参数/配置/凭据引用回显给网页。

成功accept_candidate的同一事务中：core确认→唯一application.candidate.accepted事件→核对该事件/候选/已归档attempt身份→A acceptance.consume→原命令receipt。确定性Outcome只写一次；同事件重放返回replayed，错candidate/事件冲突不能写入。receipt失败时core/接受事件/Outcome全部回滚。

旧版本未归档身份时，正常的可信接受仍可完成，但不从当前默认执行器补造旧身份；证据读取明确source_missing。ReviewTiming保持原null/partial语义，usage继续unknown，不填0费用或“实际人工思考时间”。该投影不是新接受命令，也不发native任务。

## 2. 工作证据读取

`GET /v1/works/:id/evidence`使用既有鉴权和配置项目范围，返回WorkEvidenceSchema（contracts/work-evidence.ts）：

| 字段 | 意义 |
| --- | --- |
| entries / truncated | A按精确work读取的最多500条时间线，以及是否截断 |
| outcomes | 本窗口中同work/同project的持久Outcome；不包含私有profile快照 |
| projection=recorded | 当前合同/verification对应的接受结果在本窗口可核对 |
| projection=source_missing | 当前工作已交付、未截断，但未取得该接受结果的足够来源 |
| projection=not_in_window | 已交付工作尚未在有界窗口取得结果，不能当成已确认丢失 |
| projection=not_accepted | 当前合同未接受；历史记录不冒充当前完成 |

不存在/越项目的源拒绝；回执与投影不新增任意客户端写证据入口。当前实现为HTTP消费者，工作台的进一步时间线展示仍需单列；A/C/D/E可直接用该入口复验。

## 3. 恢复检查与只读重绑定预检：已实现

唯一类型/parser：contracts/recovery-state.ts，生成物recovery.schema.json/manifest；frozen Runner/data hash不变。

| 入口 | 实际行为 |
| --- | --- |
| GET /v1/recovery/inspect | 返回正常/恢复只读状态、恢复标记摘要、当前schema/事件游标、保留队列计数、配置项目、至多200工作及历史attempt观测；不授予权限 |
| POST /v1/recovery/prepare | 只允许恢复只读启动下的认证调用，绑定expectedFingerprint、明确的sourceProjectId与新项目设置；重新检查本机Git根/干净状态/HEAD、固定检查/环境、可执行身份及最多1000个artifact字节；返回5分钟计划与阻断 |

请求示意（只包含公开输入；用实际inspect指纹替换示意值）：

```json
{
  "expectedFingerprint": "<inspect.inspectionFingerprint>",
  "bindings": [{
    "sourceProjectId": "<inspect.projects[0].id>",
    "project": { "path": "/absolute/current/git-root", "check": "node_test" }
  }]
}
```

恢复标记需是当前用户私有的普通文件，大小受限、结构可解析且targetPath属于当前state；这只是本地标记/来源检查，不把其文字宣称当作完整bundle真实性或新的运行权限。旧ended记录/旧quiescence回执同样返回needs_fresh_revalidation，不当作本机新资源证明。

项目预检复用NativeProjectRegistry但不save，不改原绑定；sourceProjectId与proposedProjectId分别返回，不静默替换旧身份。Git只读检查关闭fsmonitor/hooks和可选index写入，不执行项目测试、native任务、模型或安装。准备过程不写DB、事件、命令回执、native-projects.json或恢复标记，旧队列不变。

唯一只读POST例外是精确`/v1/recovery/prepare`；同样需要原Host/Origin/用户身份、JSON与严格schema。`/v1/commands`、决定写入及`/v1/recovery/commit`仍被只读守卫拒绝。正常实例不能调用恢复prepare。

返回固定`authorization=not_granted`、`commitAvailable=false`；计划未持久化，也不是可执行签名token。inspectionFingerprint只是本次有界观测的指纹，不是完整物理证明或可用于未来commit的授权凭证。当前原生可执行版本诊断也不是认证、sandbox、费用或真实控制准入。

## 4. 授权commit：仍未实现

本批没有切换startupMode、删除marker、清空队列、恢复旧session或放开业务POST。缺口明确为main的授权消费者/旧队列隔离时序，以及当前物理资源证明；D/E不得把预检200或计划生成当作恢复已可执行。

下一授权实现必须先固定原库/新业务的隔离方式，证明所有旧execute/answer/assistant/verify/reconcile队列不被误消费；对当前机器、项目、执行器、环境与资源重新核对，明确用户确认后只允许新工作/新合同。授权、receipt与必要状态要能同事务提交或有可重放的确定性激活边界；过期/漂移/重复/崩溃窗口均有负例。不能简单将恢复库切为normal来完成这一项。

## 5. 跨模块实际消费与证据

主线新增真实A port＋C adviser/review规则的SQLite组合：建议持久/同体重放/改体冲突/事务回滚/重开，协议层报告不提升为controlled或完成权限，candidate/输入变化有明确失效原因。没有运行reviewer或价值试点，也没有启用路由/复核产品入口。

本批命令、精确source与限制见 [限定证据](../../../reports/releases/wave06-outcome-recovery/README.zh-CN.md)。A包内、实际SQLite、HTTP、受控进程分层报告；这些结果不等于真实native兼容、完整恢复授权或installed-alpha。
