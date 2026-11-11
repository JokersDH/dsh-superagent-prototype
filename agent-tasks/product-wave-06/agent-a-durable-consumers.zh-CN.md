# Agent A：持久消费者、接受观测与迁移整包

继续`/Users/hh/Desktop/joker/superagent-agent-a`、`codex/g2-workspaces-verification`。先读本轮README、0023、0021/0022；保留`99a192b`及已有修改，合并最新origin/main。只拥有storage/workflows及相应自有文档/证据，仍是唯一生产迁移owner；不改公共contracts、coordinator、console、C/D代码或E断言。真实模型预算0。

## 交付目标

已有v13证据实现被当前main/C/D真实消费；接受等待/活动代理能沿正确候选持久追溯；重放、撤销、回滚、重开及备份恢复均保持原语义。范围是当前必要持久闭环，不扩大为分析仓库或质量评分平台。

## A1 当前基线与可消费接口检查点

复核自己的wave05源码与新main companion parser兼容，尤其ReviewEvidence的sealed_copy/native_read_only互斥，以及ReviewTiming的null/partial。列出实际新增导出、schema版本、迁移来源、root依赖请求和已知consumer缺口。

提交可直接运行的`createWorkflowPorts(store)`消费例：assistant/routingEvidence/工作索引/快照所需port。使用真正ProductStore、同步UnitOfWork、shared schema与临时DB，覆盖同体重放、改体冲突、事务失败无残留。先push稳定源码检查点，main可以立即独立准入，不等整包结束。

## A2 接受事件到Outcome/时间线的幂等消费

消费main已有application.candidate.accepted，绑定精确candidate/合同/attempt/profile、产物、验证及接受出处。提供同步可组合入口或有稳定消费身份的投影；main选择接线时机。不能另发一份接受事件，也不能因观察到UI活动就生成接受事实。

重复事件、消费中断、事务回滚、重开重扫、缺少旧字段、同work新candidate以及不同project均有证据。若完整Outcome缺少可靠profile/attempt等来源，保留可审计缺口，不能猜字段或把operator_note升级actual_native。

readyToAcceptanceMs保持墙钟等待；activeReviewMs保持UI代理。未知为null、部分为partial，不把两个数字相加，不从缺失usage推导0费用。生产迁移仅在现有receipt/index无法表达实际需求时追加，不为接口预建整套表。

## A3 可操作的来源与有界读取

为main现有attention/交付详情消费提供必要的出处/时间线读入口，按project/work/完整subject约束，cursor稳定且有界。候选失效、合同换版、另actor/project、已撤销来源不能进入有效视图；历史审计仍可读取，但不能授权新业务。

证明两个项目、多个会话、旧工作不被其他项目的大量新问题挤掉；空页与未读取更多明确区分。索引不创建第二Work生命周期，也不从普通运行观察推断物理writer已停。现有main GET /v1/attention不由A重写。

## A4 与C真实持久消费者联调

main发布已准入C源码后，运行同一决定prepare/commit/revoke及routing evidence消费者，替换旧in-memory依赖；固定双方source commit。验证同版本/旧版本重放、撤销/替代后重放、来源改变、actor/grant变化及失败回滚。

禁止为了通过修改C规则或E断言。发现跨模块缺口时，在自己的测试/文档里留最小复现及owner；继续A3/A5，依赖到达后回补。没有真实消费者时该项NOT_TESTED，不能将同shape fixture称为C联调通过。

## A5 快照、schema升级与D消费

使用包含决定、项目设置、候选patch、verification、Outcome/ReviewTiming的真实数据集，提供D通过公开port备份/复验的recipe。已存在且被引用的研究证据应纳入校验；尚未生产的review数据保持unavailable，不制造样本冒充实际结果。

验证v12到v13及任何必要后续迁移、旧记录保持、同版重开、第二Node进程读取；损坏/缺少artifact、摘要不符、IO中断与不兼容schema均不能PASS。不要修改既有迁移或替D实现恢复授权。新增migration只由A提交，main决定整合。

## A6 有界可靠性、消费文档与最终交付

对新增实际查询做有界fixture测量，写明数据量/平台/命令，不推断生产吞吐。交查询上限、cursor/幂等身份、事务归属、错误分类与source证据格式。提供main/C/D可重跑的消费命令和缺口owner。

最终更新`packages/workflows/reports/wave06-status.json`及`report-wave06.md`，六阶段分别给状态。包内测试、真实SQLite组合、main产品接线与D恢复层分开；未运行原生或收益实验保持NOT_TESTED。

## 验收出口

- 当前shared parser下的storage/workflows test/typecheck/build通过，原数据与旧测试不回归。
- 接受事件重复/失败回滚/重开不产生重复Outcome或假接受；未知计时/费用不补0。
- 真实C决定消费者与A port的事务证明可被main复跑。
- D能通过公共port核对完整引用字节，坏/缺证据明确失败。
- 只有独立可执行阶段全部结束或留下具体外部阻断后统一交接。

## 遇阻继续

等C/main接线时做投影幂等、迁移、快照损坏与索引边界；等D产物时交自己的公开快照recipe；不为维持运行新增分析平台。root lock临时解析diff不提交，仅报main。

```text
继续第六轮Agent A整包。保留当前目录/分支与修改，合并最新origin/main，读取agent-tasks/product-wave-06/README.zh-CN.md和agent-a-durable-consumers.zh-CN.md、WP-16/0023。
完成A1-A6：真实持久消费、接受事件/计时投影、来源索引、C真实SQL联调、D快照与迁移、最终有界验证。先push稳定接口检查点，再连续做完整包。仅修改storage/workflows拥有路径，真实模型0，迁移append-only；不改contracts/root lock或其他Agent代码。
```
