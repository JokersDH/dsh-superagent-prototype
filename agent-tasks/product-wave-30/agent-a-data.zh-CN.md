# Agent A：历史完成事实与可恢复产品数据整包

日期：2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-a`，原分支 `codex/g2-workspaces-verification`。
仅拥有 `packages/storage/`、`packages/workflows/`；A 唯一拥有生产 SQL 和追加迁移。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0077](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md)。
保留改动后同步最新 `origin/main`，实际 source/接口以 AGENTS 和 main 已发布检查点为准。
保留 `c80ec34c` 已修 strict canonical 分类、完整 shape/subject、坏 artifact 拒绝及历史截断；这些不是本轮重派修补。
本轮新增问题是旧原 review 被 ticket 的新 current epoch/binding 错分成 foreign；历史真实性与当前执行资格必须分开。
旧 proof 三反例、准确 1cd 双格式、C 原 ProductCompletion 与 main J 普通流的已测范围均继续保留。
main 本轮接真实 J server-preview 映射到 trial 建议/受限选择/原表单，不信不一致展示数据；A 不接管 UI/API。
建立或延续覆盖下面四项完整交付的 whole goal，无当天 deadline、无 token 预算。
每项先交可运行 source checkpoint 给 main/C，再继续其余独立工作；四项均真实完成才结束 goal。
本包不新增候选表、ledger、grant 或执行生命周期，数据 reader 永远不是 current/accept authority。

## A1 历史真实性与当前资格清楚分离的完成 reader

实现范围：

- 对每条 canonical review 使用其原 `attemptId` 的历史 binding 核验完整 subject，不能统一套 ticket 当前/最高 epoch binding。
- 原 review、verification、acceptance 是历史事实；当前可接受性仍通过原 ProductCompletion/current/preflight/Application 判断。
- 用明确字段/名称区分历史有效、当前关联、unclassified 与未知，不能因新 attempt 合法启动就抹掉旧审阅证据。
- 保留已过 strict shape、canonical key、work/contract/candidate/verification 与 artifact ID 校验，不为找回历史放宽来源。
- coverage 对真实截断、缺原 binding、不可分类和未观察保持准确，不将 `reviews:[]` 自动解释为从未有过完成。
- 现有表/历史 binding 足以表达时直接复用；必要 schema 变化先给真实缺口，只由 A 追加迁移。

实际 consumer：

- 让当前 `WorkflowIndex.work` 的真实 main/C caller 读取原/新 attempt 并列结果，不只测试私有 helper。
- 原 main current/accept 不移动执行指针；新数据分类不创建可执行批准，不把历史通过标成当前可接受。
- 对原 verification/acceptance 的 subject 和修订给足公开信息，避免下游拼 ticketId 猜当前关系。

验收正负：

- 真实 Product/Broker/check/人工接受产生 canonical review，注册同 ticket 的 epoch+1/current attempt 后原历史仍有效可读。
- 原 attempt 的 foreign binding、错误合同/候选/verification 或非 canonical receipt 仍拒绝或 unclassified。
- 两个历史候选、同 artifact 不同 generation、缺历史 binding、截断历史分别保持准确语义。
- 相同读取重放不增加事件、接受、结果或调度；正确旧 6/6 分类范围继续通过。

交接证据：

- 交实际公开入口、原 ID/epoch 对照、coverage、source、精确命令/exit 和真实 main/C consumer 编译结果。
- 第一个 runnable 结果发布后继续 A2，不在修好历史反例后将整个 goal 标完成。

## A2 main/C 唯一稳定数据与旧消费者兼容闭包

实现范围：

- 收口 Completion Facts、expectation/manifest/content/restore/result 的唯一公开消费入口，避免消费者引用旧 wave 文件或固定工作树。
- 当前和历史 reader 都有有界集合、分页/hasMore 或 coverage、版本/错误定义，不藏 LIMIT 造成完整性误报。
- 原 content v2/inventory/事件精确核验复用已准入算法，legacy content v1 只保留历史 recipe，snapshot v1/v2 另列。
- 将已有 public consumers 的输入/返回兼容性写清；新增字段不暗中改变原 WorkIndex/只读消费和 Application 语义。
- 不新建 schema writer、registry、批准层或“方便 probe”的空方法，不以包装器制造重复数据权威。
- 根 exports/contracts/依赖 lock 的真实共享变化由 main 处理，A 提供最小源码闭包和 consumer 示例。

实际 consumer：

- main 原 ProductCompletion、WorkEvidence/来源审计和 C 单 driver 用同一正式数据 contract，可在各自模块实际严格编译。
- 原消费者无需学习另一份 canonical 算法或直接查询 SQL；raw/unclassified 信息不能进入 current/accept gate。
- 数据 API 可作为正确安装包闭包输入，而不要求内部同事拥有另一个 Agent checkout 或其私有 profile。

验收正负：

- 一个旧调用和一个当前真实 caller 能读取同批原事实，类型/运行输出和 unknown/coverage 一致。
- 过期/错项目/错 root、未知版本、缺 family 和不可读 payload 有明确有限错误，不降到空值成功。
- 相关 strict/exactOptional/build 与消费者编译通过，只扩大新接口影响的验证，不重跑全部旧长矩阵。
- 查询成本、总集合/bytes 与分页有实际边界，不能因加入完成事实让每次 Work 读取无限扫 receipt JSON。

交接证据：

- 交稳定类型/API、版本兼容表、准确 source/dependency 闭包、真实 main/C 命令和可搬运例子。
- 第二个完整结果早交给集成后继续 A3，source checkpoint 不等待整包报告或 E 最终 verdict。

## A3 原 Work 产品流、回执与当前包双格式数据闭环

实现范围：

- 使用 main 已实现的 J preview→apply→原字段/可编辑 goal→创建前重验→原 Application create/check/current/人工接受流程。
- 普通非迁移流程产生真实原 Work/合同/问答/verification/acceptance，预览/取消/失败不能创建任务。
- post-record lost response 沿原 commandId/body 重试；明确新委托使用其真实新 ID，不能为消除 unknown 另造替代 Work。
- 同批真实数据分别 create/verify 默认 v1 与显式 v2，正式 restore 到独立新根，绑定原主体、content/inventory/冻结原文。
- 与 C/D 固定真正包含当前 J/window/相关数据闭包的准确包；旧 1cd/1ba/ce64 scope 不混贴。
- 仅在 main 准入 B/I 后消费原回调/result sink；无准入时 live 原恢复结果准确未达，不拿 data-only 代替。

实际 consumer：

- main 原模板/创建/接受路径仍是唯一命令 authority，A 通过公开数据记录和 reader 支持实际用户流程。
- C 单 driver 在同一准确包消费两个 restore 的原 Q/A/native_applied、Work、完成历史、context/来源与只读状态。
- 当前 package/模式由 D/E 独立验证，A 不改其工具/断言或因具体 mode bug 泛称所有包不可用。

验收正负：

- 两个项目的普通模板委托/完成与原 ID 读回可追溯，取消零业务写，未知响应不重复创建或接受。
- 两格式各自真实 restore/consumer 独立成功，source/target drift、错 snapshot/root 和 artifact 变化准确拒绝。
- restore 只读业务仍拒绝、provider 无增、旧 queue 不消费；历史完成可读不等于恢复执行获权。
- B/I 已准入时原结果重复幂等、foreign/迟到/unknown 分离；未准入只阻该范围，其余完整数据结果继续交。

交接证据：

- 交普通流和恢复流的原 ID/receipt/manifest/proof、精确 package tuple、source/consumer 字节与真实命令/exit。
- 第三个 runnable 结果发布后继续 A4，独立 E verdict、native/private/target 层准确保留未测。

## A4 高风险故障、限额与可操作支持完整交付

实现范围：

- 面向实际新增消费者覆盖有价值的 crash/重开/缺结果/陈旧身份/截断/损坏/容量场景，不以重复旧反例凑阶段。
- 原 command intent、written、observed/result 与 unknown 持久分层，新 Node reader 不重发或清掉原 ledger/marker。
- 相关 indexes 同步 UoW、bytes 异步读取与前后复核保持，不跨 await 持事务，不无限扫描正文/receipt。
- 对 tables/rows/payload/artifact/累计 bytes、操作时长与 reader 生命周期明确有界，错误保留准确 partial/unknown。
- 形成同事可用的读取/恢复/历史/失败定位文档和明确版本支持，不把数据证明、配置或 UI 代理当质量/工时/权限。
- 只处理 fresh 独立证明本轮出生的精确资源，unknown 保留状态/material，禁止先删仍可能活动的根。

实际 consumer：

- main/C/H/E 通过稳定数据接口获得可审计原始材料，E 仍唯一拥有 required assertions/发布判断。
- 支持说明区分 ordinary、readonly、controlled/native、历史/当前和恢复目标，不要求手工改表或复制 profile。
- 新运行字节冻结后再独立验收，docs-only 不重复要求打包；source-only 不能认证另一包。

验收正负：

- 正常退出/受控 crash 后新进程原 ID 和事实可读，unknown 不被换 ID/补样/退款洗掉，重复接受和 ReviewTiming 不增。
- 新历史 reader 与当前 caller 在限额/错误模式下有限退出，正确旧消费保持，坏来源不能变成完整零值。
- 相关 strict/build/有限实际数据 consumer 通过，无用户实例操作、真实模型/native 或无关 credential 读取。
- 所有支持结论对应 source/命令/exit/原 IDs/coverage 和资源终态，不以报告 DONE 或阶段数代替。

交接证据：

- 写 `packages/workflows/reports/wave30-status.json`，按四项完整结果列 source、consumer、命令/exit、能力及真实未达依赖。
- 显式 stage 自有路径并推原 origin 分支，不 upstream/reset/清历史；四项整包真实完成后才结束 goal。

## 独立备选队列

- main/C 接线未到：早交历史/当前稳定接口和真实原 ID，继续旧消费者兼容、双格式准备与故障，不造替代 API。
- B/I 未准入：live 恢复准确未达，普通模板/完成历史/来源/支持继续，不新增候选表或 ledger。
- 新包未到：保留准确旧范围，准备当前数据与 consumer tuple；D/E 具体模式问题只阻对应输入。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E 原 pilot BLOCKED 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807 与全部 state/profile/tar/ledger/dirty，A 唯一迁移、E 独占断言。

## 整包完成条件

- 四项交付都由实际 consumer 跑通，原历史真实性与当前 authority 分离，普通模板/准确包数据和支持能力可用。
- 缺外部准入项仍未达，不能把 data-only、source-only 或旧包结果补成 live/native/installed/release。
- main 保留 root/contracts/API/UI/授权；无新 Driver/CAC/桌面壳/autoaccept/动态 DAG/第二 lifecycle。
