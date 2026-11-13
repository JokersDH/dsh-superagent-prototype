# Agent C：可信参数化审阅驱动与完整双版本用户流程

继续 `/Users/hh/Desktop/joker/superagent-agent-c`，原分支 `codex/g3-assistant-context`。
仅拥有 `packages/context/`、`packages/proposals/`、`packages/knowledge/`、`packages/routing/`；原 `pnpm-lock.yaml` 差异保持。
先读根 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0058](../../docs/rfcs/WP-16/0058-optional-frozen-source-scope-diagnostics.md)、[0060](../../docs/rfcs/WP-16/0060-main-ordinary-distribution-source-integration.md) 与 [0061](../../docs/rfcs/WP-16/0061-wave-23-admission-and-end-to-end-packages.md)。

主线 `8c8fdefa12ff04d524eec8424efe3a90bc09a6fd` 已发布 launcher、portability 与构建的完整源码集成，可直接 fetch 并合并 `origin/main`。
保留 C `b00a790` 实际 scopeReview 与双版本标准 start 的正向结果，及已通过的窄路径、排除、validity、缺 artifact 和原回执拒绝。
本包把新 driver 变成可被 D/E 复用的精确用户流程工具，再完成同 Store 数据在 source 与 package 两种入口中的可验证审阅。

建立或延续覆盖整个结果包的 goal，不设 token 预算。十阶段连续实施，不在第一次小修或源码检查点停工。
三个可运行里程碑：早期交严格结果、身份和 deadline 的驱动；中期交 source/package 两种明确 dialect；最终交同数据双版本流程与界面输入。
外部包或 B 未到，只把相应范围标 `NOT_REACHED`，继续独立阶段，不回退另一个来源制造 PASS。

## C1 固定真实成功路径与工具语义

- 合并当前 main，保留原锁文件差异和所有历史证据；当前诊断 endpoint 已实现，不重新列缺失或修改已有 Scope 放行规则。
- 明确 driver 输出是经过断言的用户流程结果还是仅观察数据；观察模式不得返回容易被当作验收通过的 `status:ok`。
- 把已有真实 v1/v2 standard-start、scopeReview 和失效测试作为正对照，新增风险按独立变量校准，不机械重跑所有旧修补。
- 验收：形成明确输出协议和兼容说明，source/package/observation/verified-flow 的范围可被机器区分，但不授发布或执行权限。
- 交接物：输出 schema、原正向样例和状态迁移说明，E 不必猜测 exit 0 是观察完成还是行为验证通过。

## C2 严格断言请求结果

- 默认流程验证所请求的 chat/candidate prepare 拒绝状态、candidate 非执行态、Work 阶段和 delivery；指定原 ID 时缺数据必须拒绝。
- 检查 HTTP status 与 schema 后再解释 JSON，避免错误响应或空 history 被当成成功；原 ID 与原数据清单逐项对回。
- 保留 sourceOnly 与包来源字段的真实含义；摘要和 package subject 由实际输入核验，不能仅回显调用者字符串就自称 installed。
- 验收：真实正向流程通过；只把 chat 422 改为 200、改变 Work 阶段、移除 delivery 或候选时分别准确失败，退出码非零且原因明确。
- 交接物：每项用户结果的预期值与实际值，失败定位到原请求和数据 ID，不输出敏感正文或凭据。

## C3 每请求与总流程 deadline

- 所有 readiness、health、history、sources 和 POST 都使用可中断的单请求时限，并受整个流程剩余 deadline 约束。
- readiness 等待检查子进程 error/exit，避免入口已经失败仍继续等端口；日志按 bytes 限制，不无限累积 stdout/stderr。
- 失败后的关闭有界，只处理可证明本次创建的子进程/资源；复用实例不能因测试退出或端口相同而停止。
- 验收：连接已建立但不响应、半个 JSON、入口早退、启动超时与关闭超时各有私有正对照；操作在承诺时限内退出且不留自有资源。
- 交接物：单请求/总流程时限与取消传播记录，以及自有资源的出生、停止和归还证据。

## C4 绑定实际 consumer 和读取选择

- 从当前包可信入口取得实际进程、状态根、启动标识与 review identity，核对 prepared selection 和 actual health 的同一性。
- 不以端口上任何 personal/recovery_readonly health 当作本次启动成功；requested entry 文件 hash 不能替代 serving consumer 身份。
- 合法相同选择复用准确记录 `REUSED` 与原 PID/health；无选择、不同选择、不同根或入口失败后的旧服务必须拒绝。
- 验收：本次实际服务和合法复用均通过；独立自有 mock ready 服务、唯一不同 digest、不同 state/consumer 各准确拒绝。交早期源码后继续。
- 交接物：请求 consumer、实际 consumer、review identity、复用结果与原 PID 的一致性摘要；缺身份保持不可验证。

## C5 唯一参数化 source/package dialect

- 继续扩展现有单一 driver，不创建第二套 consumer 或私有生命周期。明确 source 标准入口与 package 实际 CLI 的参数/输出差异。
- package dialect 直接使用同包 review/start/status 入口与依赖，不能无声切回 checkout demo、工具或 helper。
- 确需主线公共 identity/port 时提交最小 RFC 和实际调用需求；C 不改 launcher、HTTP、SQL、根配置或 shared contracts。
- 验收：同一调用模型能驱动 source 与准确安装根，缺入口/不支持参数/不含诊断能力给准确失败或 `NOT_REACHED`，不冒充整包通过。
- 交接物：两种 dialect 的输入/退出码/输出适配表和实际入口字节清单，固定调用路径而非寻找任意可运行脚本。

## C6 原始同 Store 数据用户流程

- 与 A 使用一个 producer 和数据清单，将 Broker 问答、native_applied、Work、SDK 候选、确认回执、context binding 和冻结正文保持在同 Store。
- 不将手造业务行、另一份 snapshot、当前 live source 或权限显示文本拼成已冻结的普通模型上下文。
- 显式选择前后、候选拒绝与原文读取走实际入口；只读授权不刷新旧业务批准，也不解锁队列、模型或执行。
- 验收：原 ID 可核对，实际候选/history/Work/delivery/正文结果符合数据清单，业务 422、provider 无新增、原队列保持。
- 交接物：A 原数据清单到 HTTP 返回字段的消费映射和单链命令，区分受控生产者与真实厂商执行器。

## C7 双版本第二根与中期里程碑

- 同一批真实数据分别走默认 workflow v1 与显式 v2，使用各自真实摘要和校验路径，不混用 personal-evidence/bundle 协议。
- 每份快照恢复到独立新根，生成新的明确读取选择；source 和 package consumer 按实际字节分别绑定，不能相互补证。
- 若旧包不含可选诊断，保留其实际只读能力范围；只有含该功能的准确字节才能验 scopeReview，不把晚功能缺失当旧包回归。
- 验收：source 双格式及已到达 package dialect 的真实用户流程可运行；提交中期源码、准确 subject/hash 与未达范围后继续。
- 交接物：两格式各自 producer、恢复根、consumer、实际字节与结果；同一 subject 的 scope 不横贴到另一份包。

## C8 独立失效与成本边界

- 保持原正文和 main Scope guard 为唯一放行规则，诊断只解释。独立 fresh 正对照后分别改变签名、marker、source、路径、排除或 artifact。
- 原 proposal/context receipt 重放和权限问答边界保持；unknown count 不填零，不为可读数量遍历全项目或所有正文。
- 限制原因条数、遮蔽数、数据清单大小、response bytes 和分页；同步索引读取与异步正文读取分开，不跨 await 持事务。
- 验收：各失效原因可准确归因，合法新签窄范围仍成功启动但原文按 scope_changed 隐藏，无额外 provider/native 请求或全库扫描。
- 交接物：fresh 正对照与每个唯一变异的结果矩阵，注明未实测的长期撤权和并发写入边界。

## C9 精确界面输入与主线交接

- 更新现有 UI 输入契约，给 main 四种 source state、七种 reason、partial 和 withheldSourceCount 的准确显示映射与真实返回样本。
- 不向 UI 提供原始路径、principal、token、未公开 readable count，`authorization:none` 不能被显示成执行许可。
- 给 main 可运行数据/测试输入，真实 UI 由 main 实施；不得修改 console、HTTP、SQL、E 的独立验收断言或根 lock。
- 验收：输入样本来自真实已核验流程，verified 但 validity 不同、scope_changed、missing、unverified 的文案与状态一致，不把数据未知写成零。
- 交接物：更新的只读 UI 数据 contract 与实际响应样例，主线可直接消费，不以静态演示替代产品接口。

## C10 完整源码与最终证据

- 第三个可运行里程碑交单一严格 driver、两种入口 dialect、同数据双版本用户流程和可消费 UI 输入；不是只交三条小修。
- 状态写 `packages/context/reports/wave23-status.json`，列每阶段 source、命令、exit、原 ID、入口/字节摘要、数据清单和实际能力。
- 新增相关 strict/exactOptional/build 和有意义负例，已通过旧范围引用来源；未到包、B recovery、private/target、长期稳定性都准确分层。
- 显式 stage 自有路径，push 原 `origin` 分支，不推 upstream；交检查点后继续 goal 与独立队列，不凭更多测试或 sourceOnly 输出宣布发布。
- 最终交接列出 driver 本身已验证的结果和必须由 D/E 独立认证的来源/安装/发布结论，不增设第二个确认权威。

## 独立备选队列

- D/E 新包未到：先完成严格结果、身份拒绝、网络中断与 source 双版本；为实际 package dialect 提供精确接口需求和受控协议对照。
- A 分进程清单未到：保留现有真实同 Store producer，先定义可消费的数据 contract；不新建 SQL writer、签名权威或第二驱动。
- B/private/target 未到：只阻相关业务恢复结论，不阻冻结来源审阅、driver、输入协议和普通包使用流程。
- 全程真实 vendor/model/native 调用 0；B 原 cap4 UNKNOWN 不可花，E 原 BLOCKED 试点不重置、不补样、不退款。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger、原 lock 差异与所有历史 runs；不扫描全局 socket 或读取无关凭据。
- 不新增 Driver、CAC、桌面壳、自动接受、动态 DAG、私有 LLM loop、SQL 或 HTTP writer；只清理独立证明本轮 probe 出生的精确资源。
