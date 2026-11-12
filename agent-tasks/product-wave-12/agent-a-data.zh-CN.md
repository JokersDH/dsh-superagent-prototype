# A：逻辑源完整性与持久数据交付

原目录`/Users/hh/Desktop/joker/superagent-agent-a`，分支`codex/g2-workspaces-verification`，只改storage/workflows。读本轮README/0037，合并最新main；530085c已按路径接入你的reply/schema18，不能再报主线无生产结果port。真实模型/native0。

## A1 关闭排除后的扫描尾部遗漏并早交

运行`node tools/bootstrap/probe-wave12-storage.mjs "$PWD"`。perFamily=5，精确排除本笔activation后，第6条真实行不能因SQL LIMIT先于过滤而消失。lookahead必须在排除之后成立；超限返回bounded/null fingerprint，不能complete/旧摘要。覆盖排除位于首/中/尾、零/一个/多个排除和total/perFamily边界。

## A2 只排除原来那一条事件

当前按topic/entity/payload排除会抹掉后续同body事件。绑定确切原intent event seq，核对原fact、原receipt及command event内容；重复/后来事件仍改变摘要。核对、schema inventory和逻辑扫描在同一SQLite读事务内，坏字段/伪造ignore精确拒绝。交首个source，随后继续。

## A3 关闭work派生索引一致性缺口

`contextBindingFromRow`必须核对work_id与不可变body.contract.workId（含null），page不能把actual-work展示成foreign-work。覆盖put/read/page/reopen、错误work/null/跨项目/同timestamp，按需把派生字段纳入快照一致性检查。不要重写v17/v18迁移体；必要变化仅append-only。

## A4 完成快照完整性与故障窗口

补缺event_log/schema_meta、未知表/未来schema、损坏原确认字段、读取前后另一真实连接提交、读事务期间一致性。完整逻辑摘要仍不证明物理writer停止；只忽略固定heartbeat字段。边界和错误不转成complete空集合，不另造恢复授权。

## A5 消费已发布的真实产品恢复

运行main `assistant-reply-process.case.mjs`及context-product四组测试，实际A port/schema18下不允许Map fallback。补回执/结果登记/消息提交前后与坏artifact、foreign principal/错request、跨进程原请求重放。补齐的必须是原body，不是测试中的固定`re-covered`文本。

## A6 非空backup/restore跨模块闭环

源里同时放work、context binding、完成结果、原request和artifact，A快照搬到第二临时根并由main消费者读验。丢bundle/result table、改正文/派生work列、未来schema给明确拒绝；恢复副本不继承启动权。阶段4–6交第二个可运行source/recipe。

## A7 有界历史分页与查询计划

5000/10000条绑定、多项目/多会话/work与重复时间；确认稳定keyset、页间新增不漏旧项、所有返回列/body一致。记录EXPLAIN、读行/次数与耗时，不能扫全部正文做第一页。低层cursor仅续数据，公共principal签名由main负责。

## A8 真实source消费者组合

source修复后消费main实际baseline/prepare/confirm检查点。测本笔确认前后摘要一致，另一业务/资源/确认变化必失效；独立source进程SIGKILL不产生假完整或可执行权。main入口未到仅此项NOT_TESTED，继续已有port/备份工作。

## A9 迁移与当前安装输入

覆盖旧v15/v16、现v18到最终schema，保留消息、回执、结果和FTS；reader只读不修库。给D当前schema、必需族、public snapshot recipe及exact source，给E坏库/缺artifact复现；不亲自构建或修改安装断言。

## A10 回归与交接

storage/workflows全套typecheck/build/test，main真实回复/target消费者；维护`packages/workflows/reports/wave12-status.json`，区分source/history/reply/backup/activation。保留旧scope，explicit owned paths提交并push原分支。

## 独立备选队列

- A1–A4的精确排除、单快照与派生一致性不依赖HTTP。
- 已发布main进程用例、非空备份与损坏负例不依赖激活或安装。
- 历史索引、分页规模、旧版本迁移和公开recipe不依赖C网页。
