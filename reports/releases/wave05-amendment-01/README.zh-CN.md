# 第五轮修订01交接与限定证据

实施提交`1b1a9ff`，基线`fbd0b79`，分支`codex/g2-execution-integration`。本目录只证明修订与计时采集；原生复核、收益和完整R0均未验收。精确命令及范围见 [integration.json](integration.json)，固定提交浏览器报告见 [browser-report.json](browser/browser-report.json)。模型调用0，四组用户服务保留。

已改 [任务修订](../../../agent-tasks/product-wave-05/AMENDMENT-01.zh-CN.md) 及A–E原任务包，并增加 [0021技术说明](../../../docs/rfcs/WP-16/0021-value-first-review-amendment.md)。当前Codex三组初筛与注意力能力提前，新Driver等价值闸门；密封副本默认，但副本不等于宿主沙箱；R0未准入的推荐/复核只允许显式实验、默认关闭。

实际新增ReviewTiming/schema、HTTP活动采集、成功接受同事务事件与UI hook。等待从可信持久验证回执起算；活动是页面可见/有焦点的区间代理，重叠取并集，漏报为unknown/partial。打开详情但停留未操作、阅读其他内容也可能计入，不能冒称实际人工耗时。采集传输失败不阻止接受。A的outcome/timeline投影还需消费新事件，不能把schema新增当投影已交付。

## 下一消费者

所有Agent保留原目录/分支及更改，在自己工作区合并最新origin/main，重读AMENDMENT-01及各自任务包。统一下发即可，无须逐条重派旧任务。

| 角色 | 立即继续 | 暂缓/依赖 |
| --- | --- | --- |
| main | R0独立准入、聚合读取/注意力工作台、公共接线 | 推荐/复核不得进入默认路径 |
| A | 必要持久来源与计时投影；关联application.candidate.accepted及reviewTiming | 不扩建证据分析仓库 |
| B | 现有控制/停止/恢复、真实session/checkpoint、有界预算与胶囊宿主约束 | 新Driver实现等pilot promising；旧grant不变 |
| C | 决定事务/重放闭环、纯rankAttention与合法排序fixture | 复杂推荐与学习后置 |
| D | 当前个人安装、诊断、完整备份/迁移/只读恢复 | 新Driver发行支持等价值与实际接口 |
| E | 冻结8例三组试点；先查运行前提，并行验R0/注意力/计时 | 限24原生turn/20万计费token/USD 5；无法有界核算就BLOCKED；无真实结果不能称收益成立 |

E独立预算协议见 [protocol.json](../../../tools/experiments/review-pilot-01/protocol.json)。当前仅固定公开协议要求，案例/隐藏oracle与运行身份还须冻结，不存在已执行的模型账或收益结论。新会话无收益只是当前recipe的初筛负证据，不逻辑排除其他模型/协议的可能收益；默认仍停止继续投入，另一个假设另提有界实验。

## 验证范围

共享契约204、后端/HTTP/计时38、前端16项通过；后端22项在增加重放/旧候选负例后复跑通过，是38项的子集，不能重复相加。四项实际HTTP/SQLite/受控进程浏览器场景在固定提交通过，覆盖验证受阻/重开/恢复、同候选交付与正活动代理、活动传输失败仍可接受。typecheck/build/generated/spec检查通过，frozen Runner/data hash未变。

截图为隔离fixture的桌面与手机验证受阻状态，不是新注意力工作台或原生复核截图。浏览器只启动临时端口与临时数据库，关闭后清理，未操作用户账号/session或原服务。
