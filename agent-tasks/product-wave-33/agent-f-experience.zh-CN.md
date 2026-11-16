# Agent F：可持续工作的多项目助手完整体验

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-f`。
原分支 `codex/g4-trial-experience`；保留全部 dirty、原状态、报告和历史。
先读 AGENTS、START-HERE、product-spec/README、现有 DESIGN、[本轮 README](README.zh-CN.md)。
再读 [0083 已交主线](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)、[0084 架构复审](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)、[0085 完整工程](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。
保留改动后同步 `origin/main`，固定真实 source；只推 owned 路径到原 origin 分支。

## 整块 Goal 与当前基线

建立或延续一个 goal：让同一个实际 App 中的日常工作、首次使用及历史/来源/支持体验完整可持续。
以下三项是三个真实用户结果，不按按钮/截图/微测试计为独立成果，也不等逐 fix 再派工。
早交稳定组件与 DTO、中期真实 App 消费者、后期完整体验 source，随后持续联调与独立队列。
无同日截止、工时或 token 承诺；不靠反复长矩阵填执行时长。

- 固定候选起点 `fae41f8c`；main `fc38bf65` 已实际合入六源、模板 retry 和支持摘要。
- 原7/30窗口、观察下载、server-fields 建议、原委托表单/人工接受都已实现，不再重做。
- main 已给原三 preview hook 同 scope reloadRevision，App 传 `onReloadRecipes`，不是仍缺 callback。
- readiness hook/trial-view 原字节保持；包/源码标识没有正式数据时仍显示未提供/未声明。
- 当前已有 source/受控真实 App 证据，不由此推安装/native/长期稳定或效率收益。
- 保持现有石墨/白色/克制点缀设计和局部组件，不另造 shell、营销页或第二导航产品。

## 成果一：完整日常多项目工作流

实施范围：

- 围绕实际 App 完成项目/会话/对话、模板/原表单、原 Work、问题、检查、候选、人工交付之间的连续体验。
- 保持当前项目、原 conversation/Work/contract、未发送草稿及回到原对象的稳定语义。
- 多工作并存时，待回答、待批准、检查失败、待审阅、已接受和 unknown 不混成一个完成状态。
- 原问题/批准入口保持逐请求身份，正常回答不被界面误画成工具权限或自动批准。
- 模板仍只传受限 selection，完整字段来自 main 原 server preview/apply/edit/revalidate/explicit create。
- 草稿编辑、取消、返回、原 commandId 核对与已记录后响应未知能够在连续操作中理解和恢复。
- 原主对话保留第一入口，项目、工作与交付在现有布局展开，不增加独立应用壳或重复目录。
- F 只交 owned 组件、状态/回调和可操作复现；App、transport、业务命令和原授权由 main 写。
- 后端实际缺口早交最小 DTO/consumer 需求，不能在本地伪造 delivered/accepted 来补页面。

实际 consumer：

- actual App 与原 HTTP/领域对象消费同批非空双项目数据，现有四导航和原 Work 表单继续可用。
- A/C/J 提供真实数据，F 不读私有 SQL、复制完成规则或重新拼全套创建 fields。
- 原模板到委托、问题/检查/候选/人工接受和回原对话是同一条用户链，不是孤立 harness 按钮。

必要正负：

- 两项目、多会话、多工作连续使用能回到正确草稿/问题/证据/交付，原 IDs 不串。
- 取消、机器 FAIL、旧合同/候选、缺能力、重复点击、迟到结果和未知响应都有准确界面结果。
- readonly 不导入/委托/批准，读和导航无隐式创建/模型调用/自动接受。
- 受控闭环与真实 native 分层，source App 通过不冒称已安装或原 Work 故障恢复。

Source 交接：

- 早交局部组件/API/状态契约、actual App 接线说明、原 IDs 和必要命令 exit 给 main。
- 明确哪些主线 callback 已有、哪些需新增，不复制 App/transport 或要求 main 重做0083。
- source 检查点后继续成果二和日常链联调，不在一次演示通过后结束 goal。

## 成果二：当前事实驱动的首次使用与错误恢复

实施范围：

- 把缺模型配置、模型不可用、执行器未安装/未认证/未准入、无项目/讨论项目和正常就绪分清。
- 配置存在不是执行准入，未知不是绿灯；当前运行模式、readonly 和真实能力按正式 DTO 呈现。
- 新用户能找到下一有效动作：原模型设置、原项目导入、执行器目录、原对话，而非看内部架构教程。
- 沿已合入空项目就地导入和 retry 继续完整错误返回，不重新实现同一组按钮或再造设置页。
- loading/不可用/缺字段/旧服务/503/认证变化/网络未知有一致状态与有限明确重试。
- 模板 retry 仍只重读当前项目三个原 readonly preview，导出 retry 仍经 main 当前 scope 下载。
- 用户输入、当前选择、焦点及可读旧内容保留政策明确，换 identity 不让旧成功覆盖新范围。
- 错误文案脱敏，不能把原路径、key、token、raw stack 或 backend 调试信息直接放入页面。
- 包/source 标签缺正式观察时诚实缺省，不把 Git HEAD、测试 fixture 或能力 badge 当实际安装证明。

实际 consumer：

- 当前 main hooks/typed props 为唯一数据与副作用入口，F 用真实配置/错误/旧后端消费者完成闭环。
- 模型、执行器、导入和原工作返回沿现有 App 操作，不出现另一套 session/授权或导航状态机。
- G/H 支持资料只作为明确有范围的输入，不以“下载成功”替代错误解决或执行准入。

必要正负：

- 全新无配置、部分配置、正常项目与 source unavailable 有真实可运行正例，下一动作可到原入口。
- readonly/未知/旧响应/缺 callback 不触发写入，模型或原生执行只随用户明确原操作发生。
- 错项目/窗口/config/auth、连续重试/取消和旧错误不污染当前选择或重复发业务命令。
- 不支持的能力显示准确，原手动表单/主对话保持可用，不静默回退固定流程冒充编码能力。

Source 交接：

- 中期交完整首用/故障消费者、typed props、原状态输入、有限正负及 main 最小补线清单。
- 给同事可执行的普通路径和错误返回指南，已实现入口与真实未达分别写清。
- 发布后继续成果三，不能以文案更新、一个 retry 测试或状态截图称整块完成。

## 成果三：历史、来源与支持的可访问日常体验

实施范围：

- 使用 A 的有界历史 continuation 和 C 的决定/来源 DTO，呈现原 Work/合同/attempt/当前关联。
- source/caller coverage、下一页、部分/未知、历史真实性与当前可接受资格都用真实数据说明。
- 原来源预览/明确选择/决定版本/撤销替代及冻结原文保持可追溯，不把历史可读画成执行授权。
- C 的新工作决定快照经 main 原表单确认；F 只呈现选择/失效/缺输入，不自动学习或替用户应用规则。
- 支持摘要/导出复用现有 main/G/H 接口，明确当前项目、窗口、时间、覆盖与缺失，不收集私有凭据。
- 桌面1440、手机390、键盘/焦点/读屏语义和长中文/项目名/错误信息沿现有 DESIGN 做完整适配。
- 控件和布局尺寸稳定，当前项目/窗口切换不抖动，窄屏内容能换行且不遮挡前后操作。
- 使用既有图标/tooltip/标准控件与局部 CSS，不全局换主题，不堆嵌套卡片或大标题抢占工作面。
- 缺历史/source/support callback 时原日常路径仍可用，清楚降级，不注入另一 collector 或原文旁路。

实际 consumer：

- 同一 actual App 能从原 Work 进入历史/来源/支持，再回原对象/草稿，使用真实非空 DTO。
- A/C/G/H 交正式输入，main 持 HTTP/body/identity gate，E 保留产品独立断言和准确版本验收。
- 视觉和交互验证必须操作实际组成页面；静态组件、旧截图、几何通过各自报告适用层级。

必要正负：

- 多页非空历史、原来源引用、当前决定版本和部分/未知支持信息可理解，原文权限保持。
- source 过期/撤销/被替代、正文 withheld、错项目/坏页游标与 late 数据不变成完整零值或当前批准。
- 桌面/手机无横溢/重叠，键盘进入/返回/重试/展开可达，长文案和200%缩放按实际风险核验。
- 缺正式版本不编造标签，输出无秘密；未测非 Chromium、真实长期 auth 或读屏范围准确标注。

Source 交接：

- 后期交完整局部 source/样式/typed API、实际页面旅程与视口、命令 exit 和真实剩余范围。
- 状态写 `reports/trial-experience/wave33-status.json`，区分 main 已合入、候选、受控、安装与 native。
- 文档/组件/消费者一起交接后持续主线联调，不把截图数量或 report DONE 当完成条件。

## 独立备选队列

- main 根接线未到：早交组件/props/真实输入与复现，继续局部错误/键盘/移动/指南，不抢 App。
- A/C 新 DTO 未齐：保留准确 unavailable/partial，继续现有真实日常流程，不伪造历史或学习来源。
- G/H 支持资料未齐：保留缺省标签，继续原窗口/观察/工作返回，不新建 collector 或导出 authority。
- B/private/研究受阻只阻对应层，当前普通体验持续；不以临时分享 ZIP 作为这轮完成代理。

## Whole Goal 完成条件与边界

- 三成果各有生产组件、actual App consumer、必要正负与 source 交接，并进入 main 集成版本。
- owned 仅 trial src/test/e2e、`docs/user-guide/`、`reports/trial-experience/`；其余根/HTTP/App/transport 属 main。
- A 唯一生产 SQL/迁移，E 唯一产品独立断言；不修改别的候选、根配置、lock 或现有用户状态。
- 自动真实 vendor/model/native0，旧 B cap4 UNKNOWN 与 E blocked pilot 不 reset/topup/refund/补样。
- 保留十二用户服务及全部 state/profile/tar/ledger/dirty/runs；无全局发现、借凭据或真实 CLI 回退。
- 无新 Driver/CAC/桌面壳/自动接受/动态 DAG/第二 ledger 或生命周期；不新建 checkout 或派工线程。
- 当前完整方案B工程不含CAC，发行后续按集成版本准确验收，source/视觉/安装/native/收益分别记录。
