# 主线：候选准入、日常闭环与恢复授权整包

primary checkout，继续codex/g2-execution-integration。先读本轮README、0023及wave05修订01。main拥有contracts/application/questions/coordinator/console/root配置锁与共享文档；不并发改A/B/C/D/E拥有源码。日常开发真实模型0，E原grant仅由E消费。用户五组服务保留。

当前已交有限检查点：[0024明确决定HTTP/网页与共享排序](../../docs/rfcs/WP-16/0024-wave-06-decisions-http-checkpoint.md)，生产源f638fe0，证据见 [主线限定交接](../../reports/releases/wave06-main-checkpoint/README.zh-CN.md)。M1-M3仍为IN_PROGRESS，不把记录/撤销决定当通用proposal/自动上下文已完成；M4恢复新授权、M5安装准入及M6价值决策仍未完成。新5185/8801预览与原五组服务同样保留，所有后续测试用隔离资源。

第二检查点 [0025](../../docs/rfcs/WP-16/0025-outcome-projection-and-recovery-preflight.md) 已完成A接受投影生产组合、工作证据HTTP、真实A/C port消费，以及恢复inspect/prepare；源码d8d0a03，后端61项通过。M2时间线网页展示仍待补，M4仅只读部分已交，commitAvailable=false；不能通过放开旧队列或删除marker补齐。D/E可先消费新接口与明确阻断，原服务不重启。

## M1 先交共享输入与最小准入检查点

独立复验A v13 port、C决定事务/重放、B精确profile resolver及D最小发行入口，分别先收可消费的源码检查点，再让A/C/D/E组合；不等五个整包全部结束才合入，也不让B的试点阻断卡住A/C产品接线。既有报告不代替当前源码，失败给owner受控复现，接受的commit/source/范围明确记录。root锁只由main再生成。

集中补齐必要的决定/提案、执行器诊断与恢复检查/计划/提交公共schema和真实HTTP/receipt/错误fixture，明确PLANNED/IMPLEMENTED，不在各包复制。attention公共来源继续0022，不重新设计一个排序器。

审核B/E的试点运行、计费/停止上界、冻结时序和隔离。若protocol.json与0023两阶段冻结不一致，在0调用前发布有版本/摘要的澄清并让E重封存；不改8例/对照/阈值/预算，不自行发送付费smoke。原pricing或硬上界无法确认则保留BLOCKED，继续产品接线。

## M2 已有注意力工作台接C/A

消费C直接符合AttentionRanker的导出；排序在真实项目范围、当前来源和显式now下运行，unknown/业务截止/过期/依赖方向正确，返回完整id排列和真实理由。A补必要索引，main保留分页覆盖声明、原工作重读、逐项导航和各target独立命令。

把A接受事件/Outcome/ReviewTiming接到交付详情和有界时间线。当前事件已有同事务observer，不重复产生接受；计时仍null/partial，不成为质量/权限。来源失效、同分/多项目、游标scope漂移和旧candidate均有主线反例；界面沿用既有设计，不重开视觉世界。

## M3 明确决定与提案的真实网页闭环

组合C只读prepare/同步commit/revoke与A持久port，认证用户在网页确认后才入同一receipt/event/效果事务。做到讨论、委托、补充、记决定和接受交付可分辨；模型文本不直接成为命令或可信actor。

验证未确认无效果、重复确认幂等、source/actor/grant/scope/版本变化拒绝、撤销后新上下文失效、事务失败无半写/排队、重开一致。复用现有reasoner，main不另建LLM loop。实际模型回复本轮不新增调用，受控数据与历史已测范围分列。

## M4 恢复检查、计划与明确新授权

先发布恢复方案与威胁/失败时序，再实现0023的inspect/prepare/commit语义。新计划绑定当前机器/路径/profile/环境/资源与来源指纹、期限和版本；prepare不启动native；commit稳定命令幂等，授权与receipt同事务、漂移/失败回滚可复验。

marker保留，旧业务队列不重放，旧机器session/writer/签名不成为新权限，未知writer屏障不被抹掉。仅允许显式授权的新工作/新合同；当前模型不能保证这一点时保持commit未开放。不得简单切startupMode、清空队列或删marker换取PASS。A提供必要迁移/事务port，B提供控制/资源事实，D只消费入口。

## M5 D/E同一来源的个人Alpha准入

集成D最小可用发行，冻结source/build/manifest/依赖闭包与测得平台。E在同一字节产物独立执行产品/安装/恢复/回滚门槛，main重跑关键反例，原生控制仅消费B精确来源且适用的实证；不能用旧版本/controlled替换native。

D源码整合和产物冻结是可提前交付的准备检查点，E拿到同一字节即可开始；M5最终准入才等待E结论。不能要求D/E先“整包通过”才发布它们需要的源码或安装物，形成循环等待。

分列当前预览、controlled-product、actual-native-control、installed-alpha及review-value，不给虚构完成百分比。个人Alpha不要求第二协议或正复核收益；缺R0/发行必需项仍不通过。自有主线故障和跨模块接口问题连续修复，避免逐个小修重新派工。

## M6 价值决策与统一交接

消费E真实pilot报告：promising只允许制定下一小试点；有效no-go暂停新Driver投入；inconclusive/BLOCKED不冒充负收益也不默认继续平台扩张。没有实际报告，不宣称“更聪明/更省钱”。

发布当前source的准入矩阵、剩余owner、用户可用入口、私有状态/迁移边界和下一消费说明。合并accepted commits到origin/main，生成共享docs/lock时保留历史证据。CAC、桌面壳、竞速、自动接受、远程多租户和新Driver都不在本包。

## 交付门槛与连续工作

先交M1可用检查点，然后连续推进M2-M6。等其他owner时做自有公共schema/HTTP负例、恢复设计/受控失败窗口、UI消费与独立准入，不更改他人代码抢进度。只在所有可独立项完成或有具体外部阻断时交接；预算不刷新、服务不擅自重启。

最终报告含branch/base/source、accepted/未准入candidate、实际命令及证据、真实模型任务0及外部pilot单独账、各tier结论和下一消费者动作。派工说明本身不算任何阶段已执行。
