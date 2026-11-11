# 主线：接受Outcome、证据读取与恢复预检

日期2026-11-11。分支codex/g2-execution-integration，输入6f6edde；消费A的3b43728/aec24b7。精确实现提交、最终命令和范围见 [integration.json](integration.json)。本批是M2接受投影与M4只读检查的有限检查点，非恢复新授权或installed-alpha准入。

## 本批实际行为

- 在新attempt begin前归档私有运行输入快照；接受后从唯一accepted事件调用A acceptance.consume，Outcome与接受/receipt同事务提交。同事件重放不重复，receipt失败整体回滚。
- GET /v1/works/:id/evidence提供有界时间线、精确work/project的Outcome和ReviewTiming。旧记录缺运行快照时仍可正常可信接受，但证据保持source_missing；窗口未覆盖时用not_in_window区分。
- GET /v1/recovery/inspect和POST /v1/recovery/prepare已实现：标记/项目/队列观测、当前Git重绑定预检、可执行版本/字节诊断、artifact字节检查及具体阻断。不改DB、标记、项目注册或旧队列，也不运行模型/项目测试/安装。
- 精确的只读prepare是恢复模式唯一新POST例外；commit、普通业务和决定写仍拒绝。所有计划明确not_granted/commitAvailable=false。

公共schema、字段与D/E消费见 [0025](../../../docs/rfcs/WP-16/0025-outcome-projection-and-recovery-preflight.md)。frozen Runner/data hash不变，A v13之后没有新增生产迁移，root依赖/锁未变化，A/B/C/D/E拥有代码未被主线改写；A源码由原提交分段集成。

## 分层验证

最终集成命令覆盖应用/HTTP/执行/计时/决定/attention、恢复预检、实际恢复demo子进程及真实A/C SQLite消费者。关键新负例包括：接受回执失败无phantom Outcome；旧快照缺失不猜当前profile；错误事件/candidate不能投影；读证据需要鉴权；readonly预检保持旧queue与marker；旧ended不成为新物理证明；脏Git/旧指纹/另actor/project、损坏artifact、危险marker拒绝；Git fsmonitor不执行。

固定实现提交d8d0a03：后端61项（含恢复6、真实demo子进程1、真实A/C port消费2）全部PASS，无跳过或失败，原始结果见 [backend.junit.xml](backend.junit.xml)。契约211、storage75、workflows23及相关typecheck/build/generated通过；这些层次不重复相加为产品完成率。没有修改UI，本批没有重跑或重标旧浏览器证据。

A/C真实SQLite消费者证明建议不可变、幂等、回滚和重开；协议样例报告保持evidence_missing，并保留candidate_changed/input_mutated原因，不提升为controlled review、机器PASS或humanAcceptance。本测试没有启动reviewer或验证收益。

实际demo恢复子进程测试使用合成恢复标记与临时DB/项目/端口，验证真实HTTP inspect/prepare可读且旧execute不消费；它不是D真实bundle安装/迁移验收。没有重启用户5180–5185，也没有迁移或合并其历史。

## 身份与指标限制

profileRef解析到私有的该次attempt审计快照，非Catalog可调度准入或跨任务质量标识。受控fixture标controlled；native本批只标operator_note，未取得新的native兼容认证。可执行摘要只是begin前观察到的路径字节，不是所启动进程完整二进制/配置的证明。

ReviewTiming是墙钟等待与部分UI活动代理，不能相加或当真实思考耗时；usage仍unknown，不造0费用。最多500条timeline、200个source work和1000个artifact的范围均显式返回，未取得不冒称全库缺失或全量验证。

## 下一步与消费者

| 消费者 | 现在可做 | 仍需等待 |
| --- | --- | --- |
| A/C | 使用已进main的真实acceptance/routingEvidence与领域规则复跑组合 | 完整reasoner/proposal产品接线仍单列 |
| D | 消费inspect/prepare的实际schema、owner阻断、当前项目预检和证据读入口 | 新授权commit与激活/旧队列隔离机制仍main未实现 |
| E | 独立验证接受事务/缺证据、两条恢复接口与readonly负例 | 不把预检200当授权通过；installed-alpha/native/pilot仍分开 |
| main | 接受投影与只读预检已交 | 定义并证明新业务隔离、当前物理资源复验、显式commit的原子/激活边界，随后才交D消费 |

本批没有授权新恢复业务，没有清空旧队列、删除marker或切normal。真实模型/native任务0；不刷新或认证外部B/E预算账，不宣称复核收益。
