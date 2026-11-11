# A：完整验库与上下文审计持久化整包

继续原`/Users/hh/Desktop/joker/superagent-agent-a`、`codex/g2-workspaces-verification`。只改storage/workflows；先读本轮README/0033并合并最新main。7f7e83e的三个库存反例仍FAIL，不能只重交10项旧PASS。真实模型0，迁移唯一归你。

## A1 关闭完整schema与快照反例，早交reader

复跑main `probe-wave09-target-inventory.mjs <checkout> --output <owned-report>`。按schema版本核对完整预期表/必要结构，缺业务表拒绝；FTS仅承认确切主表/shadow集合，任意前缀表unknown。摘要必须绑定实际检验的同一DB/WAL一致快照，任一竞态报告busy_or_changed，不可先hash后另copy称complete。

保留旧schema只读、不迁移、缺库/损坏/unknown/private/link/writer语义。针对真正DB/WAL改变、WAL新生/消失、hardlink和rename窗口给负例与当前空库正对照。三反例及类型/构建通过后立即push源码checkpoint，main无需等A6才能接reader。

## A2 实际新目标初始化与只读验库消费者

消费D固定Materializer和main consumer；main在已绑定全新私有root用公开ProductStore创建空schema，你提供真实Store初始化/关闭/重开/完整inventory对照。不复制历史DB/queue/session/凭据，不在reader里修库。覆盖manifest-only缺库、初始化半写、schema不完整、遗留业务行、准确schema版本和source不变；材料已准备不等于可激活。

## A3 实现唯一上下文绑定持久化port

按main已发布`AssistantContextBindingSchema`/`AssistantContextBindings`，在`store.workflows.assistant.contextBindings`暴露forMessage/forCommand/put。唯一append-only迁移，和既有chat/receipt同UoW；同identity同body重放、任一identity换body冲突，reopen保持。bundle仅存既有artifact引用/摘要；schema字段不私改，缺共享语义给main RFC。

测试原消息项目/会话/用户来源、文本摘要、两种唯一键、外层receipt失败全回滚与重放；不另开连接、另起生命周期或写模型发送账本。早交此port第二checkpoint供main接线，别等恢复激活。

## A4 备份、再恢复与证据投影

把新binding及bundle引用纳入一致snapshot family与恢复验证；新表必须进目标inventory分类。旧schema到新schema路径可重开，丢表/改行/缺artifact/未知未来schema准确拒绝。恢复后的binding仅审计，不让旧请求自动发送或赋予target启动权。现有Outcome/partial timing/evidencePage范围完整保留。

## A5 生产组合失败窗与有界读取

消费main实际context-use及source/target入口，覆盖消息/绑定/receipt/artifact之间失败、读回/丢响应原命令、来源缺失与新合同；source记录重放不复制工作。复验证据分页、storage_cap/source_missing、接受Outcome唯一性与新表备份。性能只测有限真实SQLite窗口，报告数据量及上限，不建泛化索引平台。

## A6 完整交接与独立队列

运行owned storage/workflows typecheck/build/tests、上述main probes及实际consumer。维护`packages/workflows/reports/wave10-status.json`，列reader、migration/schema、port导出、备份family、命令和真实限制。main/D未交入口则保留明确NOT_TESTED并完成可独立阶段，不用fake activation填PASS。只push原分支；八组用户实例与旧ledger不动。
