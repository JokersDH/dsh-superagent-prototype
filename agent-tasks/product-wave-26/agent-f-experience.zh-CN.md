# F：真实试用工作台与完整日常流程

2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-f`、原分支 `codex/g4-trial-experience`，保留历史后同步最新 `origin/main`，记录实际 source。
先读根 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0066](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)、[0067](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md) 和本包。
仅拥有 `apps/console/src/trial/`、`apps/console/test/trial/`、`apps/console/e2e/trial/`、`docs/user-guide/`、`reports/trial-experience/` 五个路径。
main 保留 App.tsx、transport、根 CSS、其他组件、API、contracts、配置/授权和组合；F 提供自有组件/测试与最小接线需求，不越界修改。
八位外部 A–H 加 main 并行；F 消费 G 可信摘要，H 在独立 operational-soak 路径做运维/合法消费者帮助，不取得 F UI 或产品授权所有权。

固定候选 `fad070fb1d0a7586ac1059dd7aacba0d869e9658`，实际组件源 `2684773`。六源文件、纯状态 10/10 与严格编译已通过，不重新交一个静态 TrialWorkspace。
main 本轮导入六源和一测试，在实际 App 加试用准备导航、可见/auth 条件下读取和四既有动作；实际最终范围以 0066/主线源码为准，不把合入当全产品发布。
四回调仍为 configure_model/import_project/inspect_executor/open_conversation，仅导航不授权。导入动作由 main 先 openView 再打开工作区，F 不重新实现根组合顺序。
使用现有精密浅色设计与 impeccable skill 做局部改进；不另建营销首页、平行配置或新全局主题。G 当前完整指标尚未准入，核心体验不等待它。
建立或沿用 whole-package goal，无 token 预算；16 阶段在 F4/F8/F12/F16 发布四个完整可运行结果，发布后继续，不在小修或检查点停工。

## F1 消费真实 App 与使用反馈

同步 main 的实际挂载、readiness/配置状态、导航目标和新测试，逐项确认组件已在真实 App 中出现；不继续把 main 入口列为缺失。
以首次试用和每日返回为目标，记录真实用户能否判断当前项目、配置、阻断与下一动作；区分候选 harness 与实际 App 证据。
保留 main 已测的 HTTP/desktop/mobile/failure/readonly/四回调范围，仅在本次改动影响它们时回归，不机械重跑旧截图数。
给 main 自有组件最小源码、事件输入/输出与接线需求，不碰 App/transport/根 CSS/API，也不根据截图想象未执行的交互。
允许的配置事实、未知、fixture 和恢复只读分别说明；徽章颜色、可点击导航或配置已具备都不是执行准入。
验收：一份指向实际源和可复现 App 操作的反馈/修正清单，后续阶段直接实现，不只交设计建议。

## F2 transport 身份变化与异步正确性

修正 hook 仅依赖 capability available 布尔值的边界：同为可用的 transport A 换成 B 时，应取消 A 的结果并读取 B，或提供明确可用的 remount/身份契约。
保持现有稳定客户端不被 inline props 每次 render 触发无限请求；与 main 约定稳定 identity/key，不能靠定时重试维持表面新鲜。
覆盖旧请求晚到、reload、启用/禁用、auth 变化、transport 替换和卸载；错误/unsupported 时保留上次有效观察并标明时间，不能悄悄显示新服务的假状态。
readiness 仍只经原 ConsoleTransport，一次显式加载/刷新一请求；不私造 HTTP loop、自动发模型/任务或在 mount 时消费旧队列。
正常导航不抢焦点，刷新控件保持可操作语义与有限 disabled/loading；old response 不能覆盖新身份或在卸载后更新状态。
验收：实际 React hook 的独立延迟正反例通过，A/B 身份与请求数明确，重试和隐藏视图不会产生请求风暴。

## F3 readonly、unknown 与安全文案

核对真实 readiness 各状态和旧服务接口缺失，页面不把 unknown/fixture/configuration-only 变成 native 已测、可批准或可恢复执行。
readonly 保留历史/来源/会话等适用读取入口，不新增导入写入、批准、恢复 grant、自动接受或重发按钮；根动作最终仍由 main 原守卫决定。
错误使用有限用户文案，不显示 token、模型 key、绝对根路径、原始 stack、provider endpoint 或内部 authority；服务错误不清空旧对话/项目。
四回调都只交导航名称，重复点击不会发两次命令；模型配置、项目导入、执行器检查由 main 既有面板承担。
长中文/英文、零项目、多个项目、缺当前会话和部分配置均有完整状态，不以空白、默认 0 或绿色默认值掩盖未观察。
验收：真实 App/组件合法正对照与 readonly/unknown/error/unsupported 独立负例，原文案与状态一致，无模型/native 调用。

## F4 第一结果：实际挂载后的可靠入口

将 F1–F3 修正纳入已挂载的同一入口，用户从试用准备能判断状态并到正确既有页面，来回后仍保持当前项目与既有内容。
对齐 main 的 auth/可见加载和四回调测试，准确说明本次新增与旧已验范围，不把一份独立 harness 通过称 main App 已通过。
提交自有源码、hook/状态测试和 main 最小 consumer 片段；共享动作/DTO 需求交 main 决定，不添加第五种任意字符串动作。
实际新 UI 按 skill 做有限视觉/交互验证并保留桌面/手机结果；主线已有截图无需为了新报告重复全部拍摄。
第一完整可运行结果包括真实 App 接入反馈、transport 身份/错误正确性、readonly/unknown 与主动作闭环，不只修一个 hook。
发布 F4 runnable checkpoint 后继续 F5–F8，whole goal 未齐保持进行，不等下一次小修派工。

## F5 两项目与旧稿保持

在私有受控数据中使用两个真实导入项目，覆盖不同名称/同名 Work、开发/讨论范围和不同当前会话，不操作十二用户项目/实例。
通过 main 现有选择器和导航进入正确项目/会话，组件只呈现 props；不在 F 私建 conversation catalog、项目授权或执行生命周期。
切试用准备、项目、执行器和回到会话后保留用户未发送旧稿、当前回复锚点及已有历史，不自动提交文本或创建同名新会话替代。
使用准确 projectId/conversationId/消息身份，而非标题或数组位置匹配；错误项目和不可读项目拒绝/明确缺失。
缺 main 接线时给自有 e2e 的最小实际行为复现，不跨界改 App；可继续组件/consumer 的身份、布局和文档。
验收：两个项目的正向往返及错身份/长名负例可复现，输入旧稿不丢失、不向其他项目发送或触发模型。

## F6 配置、导入与回到主对话

从实际缺模型/缺项目/执行器未知状态进入既有配置、导入、检查面板，再返回试用准备和主对话；这些是现有产品流程，不建平行设置页。
导入顺序消费 main 最终实现，先导航再打开导入面板，避免后一次 openView 把刚打开的工作区关掉；F 不改根顺序。
可在私有测试装置使用明确受控配置/项目输入，但无真实 vendor、旧 key 或用户根修改；导航自身不应发模型或执行命令。
配置/导入成功与失败、取消、返回都保留当前草稿与正确面板焦点，刷新显示最新合法 DTO，拒绝旧请求覆盖。
操作失败时给准确下一动作，不承诺“修复一切”或“已可开发”；配置完成不等于真实执行器/环境已通过。
验收：主线实际面板目标和来回流程有有限 HTTP/回调计数，用户无须重建会话或重复填已完成的配置。

## F7 日常审阅与问题入口

让用户从工作台进入已有问题、交付、来源历史和主对话入口，保持主线原 question/version/candidate 和 source body 守卫。
只读/未知执行状态下，合法历史审阅仍可用；不得因为 readiness 不绿就遮掉原已读内容，也不得借阅览解除写入阻断。
当前与历史项目/会话长内容保持可辨认，返回位置与选中项不丢失；主体仍是主对话，不以状态卡填满整个页面。
测试只消费已有明确入口/props；新导航需求交 main 最小 RFC，不自发执行接受、批准、恢复授权或模型请求。
实际原生执行/恢复未准入时明确限制，受控问题和候选可以展示但不得写成真实厂商交付成功。
验收：一条真实受控用户审阅路径与 readonly/旧版本拒绝，记录实际可读范围、回调和零自动发送。

## F8 第二结果：两项目日常旅程

将 F5–F7 组成真实 App 的同一旅程：进入试用准备、两个项目往返、配置/导入或检查、回到原对话/旧稿，再审阅已有合法内容。
记录真实 API/DTO/source、导航和最终项目/会话/草稿身份；fixture/actual main/installed/native 分层，不拿不同 demo 拼整条通过。
覆盖取消、错误和重开，使用有限 deadline、自己的新端口/根和受控数据；不扫描或重启十二用户实例。
尚需 main 组合的步骤准确记对应 NOT_REACHED，先交 self-owned consumer/测试；不以未到的 G 指标阻断主要流程。
第二完整可运行结果为实际两项目日常路径和状态/身份/旧稿保持，而非多张孤立截图或静态组件。
发布 F8 中期 checkpoint 后继续 F9，后续 G、手机、文档和包内交接继续实施。

## F9 G 未准入时的观察空态

本轮 G 有已复现 scope/window、坏来源 complete zero 和 collector byte bound 阻断，默认指标尚未准入；不要把 main 暂未挂指标当缺入口。
未传/不可用/insufficient 的 insights 都是可选附录，核心 readiness、项目、四动作与会话继续可用，不展示错误完整数、编造节省工时或百分比。
保留 typed props 与 null 显示未知，不在 F 另算 metrics 或私读 SQL/全项目正文；参考 G 的稳定结构但不自行宣告其数据可信。
错误观察数据不覆盖原 readiness/配置，不触发额外网络采集、模型或执行；缺 summary 不能造成整页失败。
给 main/G 精确 consumer 要求：project/window/layer/coverage、已知/未知样本、来源与限制如何显示，交真实 fixtures。
验收：未准入/缺失/失败/全 unknown 与部分合法数据的独立呈现，主动作在所有分支保持正常。

## F10 修复后的精确范围展示

G 修复获准后消费 main 提供的实际可信 summary，按准确项目/观察窗/合同或明确聚合范围展示；不靠 UI 自己过滤错误统计来代替 G 修复。
区分 current attention snapshot 与历史事件窗口，区分观测记录、controlled/native/operator 与未知来源；配置 readiness 不成为效率样本。
候选等待、observed UI 审阅代理、人工介入和已知 usage 用真实名称，partial/null/unknown 不渲染成完整零或真实人类工时。
多币种不合计、不同层不合并，baseline 是明确 operator 观察性输入；少样本或不同任务不能写“效率提升”因果结论。
稳定类型/fixture 由 G 输出、根依赖/实际输入由 main 接入；F 仅改 owned UI，不新建分析器/endpoint/ledger。
验收：有完整正对照且错 project/window/coverage、unknown、不同币种/层在展示上明确拒绝或保留限制。

## F11 观察报告的可读性与隐私

采用适合扫描的紧凑 rows/状态，不加大型图表英雄区或嵌套卡；展示窗口、已知样本、未知数与有限来源引用。
核心摘要旁呈现 coverage/限制；不能只显示一个绿色 ready 导致用户误认为全项目统计完整或 native 已被证实。
不把原 prompt/payload、绝对路径、token、原始 authority 或错误栈塞进细节；不可信字符串安全文本渲染，不产生 HTML/命令入口。
大数量、长指标名、多语言/空窗口布局稳定；展示行数有界，隐藏项与 partial 明确，不静默截断成另一份完整报告。
问题反馈给 G/main 原始 subject/输出 shape 的最小复现，不为了 UI 通过改 E required 断言或改变统计口径。
验收：桌面/手机/键盘可理解观察范围，错误/脱敏/长文和 partial 情况不会覆盖内容或误导用户。

## F12 第三结果：可选观察的安全接入

将 F9–F11 与主工作台合成一个可运行结果：G 未准入/不可用时完全可用，G 准入后的真实 scoped summary 能稳定展示且不扩权。
保留当前 raw body/source 等主线组件的独立授权和不可核对内容隐藏，观察项不成为派工、批准或自动接受条件。
如果 G 真数据仍未准入，交完整 typed consumer、合法/错误 fixtures 和实际 unavailable 路径，准确保留只阻真实指标展示的依赖。
main 拥有产品集成和输入选择；F 提供自有组件、精确 props 和有限验证，不为了结果包自行绕过主线。
第三结果要求可选输入/错误、合法范围、隐私与用户理解同时成立；仅 types 结构兼容不是实际数据准入。
发布 F12 checkpoint 后继续 F13–F16，用户指南与真实 App 交付不等待额外派工。

## F13 当前版本用户指南

更新五个 owned user-guide 入口和简介，以本轮真实主线界面/命令为准；不再教用户去测试 harness，也不把未来架构写成已可用能力。
说明首次准备、配置/项目/主对话、问题/候选/来源审阅、readonly/unknown、可选观察和失败恢复的实际路径。
引用 main/D 的真实发行命令与 H 的适用只读 preflight，不另造安装/升级/停止命令、默认 key 或多用户共享权限承诺。
应用内只留真实状态和命令，架构/测试/教程细节放文档；继续专业浅色、主对话中心的既有设计。
明确 configured 不等于 native_test_passed，观察不证明收益、授权或质量；原生恢复/target 的未达范围如实保留。
验收：新使用者按当前文档可完成一条受控日常旅程，所有引用/命令和能力状态能回到准确 source。

## F14 手机、键盘与长内容

对本包新增 UI 按 impeccable 做有限 desktop/mobile 实测，核对稳定尺寸、长中英文、计数、错误/项目名和状态变化无重叠/横向溢出。
原生按钮/链接、可访问名称、heading/landmark、加载/结果通知和焦点返回一致；不靠颜色表达 unknown/readonly/partial。
重试、返回、打开配置/导入后焦点符合用户下一动作，异步结果不抢输入焦点，旧稿和未发送内容保持。
复用局部 trial-* CSS 与根 token，不改根主题，不加营销 hero、装饰背景、重复设置或无用途动效。
无需机械重拍旧 24 截图；只验证本次风险和新视口，记录准确数据/屏幕而非把静态 marker 当用户流程。
验收：实际新增用户路径的键盘/窄屏/长文及错误正反例，未测浏览器和屏幕阅读器边界明确。

## F15 实际错误边界与包内交接

将主线实际 App、组件、候选源码、冻结安装包区分，D/E 新字节未到不能把 checkout 的通过贴给旧 tar。
给 D/main 精确 runtime imports、局部 CSS、build/资源依赖与入口清单；不把 e2e harness/fixtures/test-only key 塞进产品包证明组件存在。
对真实 HTTP auth/网络/旧接口/schema/迟到响应和 G 错误做有限验证，页面保持原内容/当前身份，报告不含秘密。
测试只用私有明确新根/端口和已授权受控数据，所有 waits 有 deadline；H 运维观测/E 独立 required 仍各自所有权。
验收：实际 app/CLI/source/package consumer 的对应范围能说明，包内新体验最终由 E 同一 artifact 独立验，不自授 release。

## F16 第四结果与完整交接

写 `reports/trial-experience/wave26-status.json`，列 F1–F16、四结果、source/App/DTO/consumer、命令/exit/视口/原身份和未达项。
第四结果覆盖当前指南、键盘手机长文、真实错误边界和完整包内交接；不能只统计 screenshot 数、组件数量或 static PASS。
4/8/12/16 检查点提交后继续完整 goal，尚缺外部数据时列精确依赖并推进独立队列，不把 PARTIAL 报成整产品完成。
显式 owned paths 推原 `origin` 的 `codex/g4-trial-experience`，不 upstream/reset/清历史，不改其他 owner 源和 shared root。
真实 vendor/model/native 0，B cap4 UNKNOWN 不可花，E 原 24turn/200000token/USD5/单在途 pilot BLOCKED，不 reset/top-up/refund/补样。
十二组 5180/8796 至 5191/8807 与全部 state/profile/tar/ledger/dirty 保留；不新 Driver/CAC/桌面/autoaccept/动态 DAG/授权生命周期。

## 独立备选队列

main 新接线未同步先完成真实 hook 身份/错误、局部状态/键盘/手机/用户指南与可编译 consumer，提交准确最小需求，不跨界改 App。
G 未准入先完成安全 unavailable/unknown、稳定 props/fixtures 和核心用户旅程；不补造指标或把 main 未展示错误数据当阻断。
安装包未到继续 checkout 实际 App 数据/流程并准确标 source scope，交 D/E 精确字节需求，不拿旧包静态元素替新体验验收。
所有验证有限、只清理独立证明本次出生资源，禁止 global 发现/其他 credential/旧用户实例操作，checkpoint 不是等待点。
