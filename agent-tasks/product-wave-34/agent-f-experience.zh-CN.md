# Agent F：完整日常助手体验的两个连续工程包

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-f`。
原分支 `codex/g4-trial-experience`，保留全部 dirty、原状态、报告与历史。
先读 AGENTS、START-HERE、product-spec/README、现有 DESIGN、[本轮 README](README.zh-CN.md)。
再读 [0086 主线实际消费者](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087 架构复审](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088 两包工程](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。
保留改动后同步 `origin/main`，固定真实 source；不要按旧截图或中间报告重做主线已交功能。

## 一个 Whole Goal，两个连续工程包

建立或延续一个 goal：把多项目工作、模型连接、错误恢复、历史来源与支持做成同一 actual App 的完整体验。
工程包一交日常/首用/身份草稿；工程包二交真实历史来源/支持反馈及跨视口质量。
每包三个完整生产成果，共六个，不把六个按钮、修补或测试套件当六块产品。
early/intermediate/final source 后继续两个包与独立队列，不逐项等派工，不在包一结束 goal。
无同日截止、工时、持续时长或 token 承诺，有限必要验收即可，不靠重复矩阵或长 soak 凑时长。

- 固定起点 `69e14a08`；fc38 已有六源、空项目导入、原 scope retry/support 和7/30/导出/原表单。
- 本轮两行 history/source availability 是能力入口提示，不等完整非空历史/原文浏览界面。
- main `23d5a98e` 已交支持 GET/严格 DTO、原 scope hook/digest 下载按钮及 G 元数据消费者，不再复制 pipeline。
- 保持石墨/白色/克制点缀和现有布局，按现有 DESIGN/相关前端 skill 做真实界面，不另造 shell/navigation。
- 仅拥有 trial src/test/e2e、`docs/user-guide/`、`reports/trial-experience/`；RootHTTP/App/transport 属 main。

## 工程包一：日常工作、首次连接与错误返回

### 成果 F1：两个项目多个原工作的完整日常流程

实施范围：

- 在现有主对话和侧边工作区完成多项目/多会话/多 Work、问题、检查、当前候选与人工交付的连续体验。
- 同时存在待回答、原批准、机器 FAIL、待审阅、已接受和 unknown 时，状态与下一动作各自准确。
- 模板/选择仍进 main 原表单 preview/apply/edit/revalidate/explicit create，不本地重构完整创建 fields。
- 原 Work/contract/conversation/问题/产物 IDs 保持，返回原对象与未发送草稿不串项目。
- 不用新 Work、模拟 delivered 或第二导航目录掩盖原问题/验收/回执缺口，缺 DTO 早交 main。

实际 consumer：

- actual App 与原 HTTP/应用对象使用同批非空双项目数据，四导航、原问题与原人工接受继续唯一。
- F 用 owned 组件和 typed callbacks，main 做原 App/transport/授权接线，不另起静态 demo 产品。

必要正负：

- 两项目多工作中正常交付、pending question 和机器 FAIL 可并存，回到原对话/证据/草稿仍准确。
- 错项目/旧合同/候选、取消、重复点击和未知结果不触发隐式创建、批准或自动接受。

Source 交接：

- 早交完整日常组件/实际 consumer/原 IDs 与 main 最小补线，发布后继续 F2，不以已有9场景重跑收工。

### 成果 F2：首次使用与安全的模型连接表单

实施范围：

- 完成缺模型、连接错误、执行器未安装/未认证/未准入、无项目与 readonly 的准确首用路径。
- 基于现有原模型设置入口交受控连接表单，字段/状态/校验通过 typed props/callback 交 main。
- key 仅放组件瞬时内存/请求引用，使用密码输入；提交完成/失败、卸载或身份切换清理逻辑状态。
- key 不进 storage、URL、console、遥测、错误回显、DOM 文本、截图/支持材料、配置快照或普通 DTO。
- 不声称 JS 字符串可物理清零；连接配置的服务端私有保存、RootHTTP/auth/origin 和脱敏响应均由 main。
- F 不直接 fetch、不调用 native/模型、不自行写文件；新 callback 未到或旧 API 时沿原安全设置方式降级。

实际 consumer：

- actual App 的原设置表面消费 F 表单与 typed callbacks，用户明确保存/连接操作才交 main 原处理。
- 模型和执行器事实各自呈现，配置存在不画成 native 准入，普通入口不被可选连接功能阻断。

必要正负：

- 合法配置/缺字段/连接反馈/清理后返回原操作有受控正例；测试使用固定本地响应，不花模型预算。
- old API/缺 callback/失败/身份变化时 key 不留存或回显，readonly/未知不自动改配置或发模型任务。

Source 交接：

- 交受控表单、秘密生命周期约定、实际 callback contract 与旧 API fallback，main 拥有最终 wire。

### 成果 F3：错误、身份与草稿保持的完整恢复体验

实施范围：

- 把加载、认证变化、旧服务、缺输入、503/网络未知、明确拒绝和已记录后响应未知区分清楚。
- 同 identity 下可读旧内容与换 identity 后隐藏策略一致，旧成功/错误不能覆盖当前项目/窗口/config。
- 用户输入、原选择、原 commandId 与焦点能保留或明确失效，重试沿原 main 幂等/核对流程。
- 沿现有 readiness/模板/导出/支持 retry 完成返回路径，不再新增相同按钮或另一请求状态机。
- 错误脱敏、长文案和缺 callback 可理解，不能把 raw path/key/token/stack 或内部 owner 名称放到产品里。

实际 consumer：

- 实际 App hooks/typed props 是数据与副作用唯一入口，F 的恢复操作始终回到原对象/表单。
- C/A 的错误/partial/unknown DTO 用于解释，不能由本地乐观状态覆盖已拒绝的后端事实。

必要正负：

- 用户遇错后能继续原普通流程；两项目切换、重开、取消和明确重试保持原 ID/草稿关系。
- late response、旧权限、过期选择和重试双击不重复创建/发送/接受，不把 unknown 变成功。

Source 交接：

- 发布包一完整 source、actual App 旅程和错误/身份不变量，立即进入工程包二，不等再次派工。

## 工程包二：真实历史来源、支持反馈与访问质量

### 成果 F4：A/C 历史与来源的实际浏览体验

实施范围：

- 消费 A 正式 history continuation/C 当前决定 snapshot 和原来源 DTO，做非空真实浏览，不止 availability badge。
- 原 Work/contract/attempt/currentLink、source/caller coverage、下一页、unknown/truncated/blocked 分清。
- 活 keyset 不画成冻结多页 snapshot；无 progress/过大 entry/withheld 正文明确说明，不伪造完整零值。
- C data-only valid 不画成执行 grant，决定版本/撤销替代/expiry 与原冻结内容、当前资格分别呈现。
- 原文、artifact/patch、验证/人工审阅和下载沿 main 原 body/Scope/current gate，F 不直接读取本机路径。

实际 consumer：

- 同一 actual App 从原 Work 进入多页历史/来源/证据，再回原对象/草稿，读取同批真实原 IDs。
- main 提供严格公开 DTO/HTTP，F交组件/回调；A/C provider 缺口早回最小例子，不复制 SQL 或 authority。

必要正负：

- 多页非空、当前/历史候选、合法原文与明确省略可用，原版本/来源摘要可定位。
- foreign project、旧 cursor/权限、source撤销/变化、坏摘要和失效 snapshot 不借导航/展示复活批准。

Source 交接：

- 中期交实际历史/来源组件、DTO契约、原对象旅程与 main 最小接线，继续 F5，不交静态截图顶替。

### 成果 F5：真实支持数据与可复现反馈

实施范围：

- 消费0086主线支持下载按钮、原 scope hook 和 G 元数据，形成用户可理解的支持/反馈闭环。
- project/window/timezone/config/auth/observedAt 与显示/下载范围一致，snapshot 新读取和旧观察分开。
- 来源已知/未知、partial/truncated、能力可用性和实际版本标签诚实，没正式身份就不编造包/源码。
- 支持文件只含准入元数据与脱敏原因，不把原文、key/token、私有路径或用户状态一起导出。
- 反馈默认由用户取得材料并主动使用，不自动上传、发消息或发送到外部服务，不另造 collector/pipeline。

实际 consumer：

- actual App 的现有支持/下载回调取得正式 G/main 文件，用户能核范围、理解缺失并回原工作。
- main 保留 HTTP、下载副作用与文件校验，F 不复制 serialization/hash/auth 或 Node 分析模块到浏览器。

必要正负：

- 正常、partial、unknown 和错误支持材料可取得/重试，范围和实际 bytes/文件状态由原消费者核验。
- 身份/窗口变化、late/legacy/坏 schema、缺 callback 不串范围或自动下载；秘密与 raw 内容不泄漏。

Source 交接：

- 交支持/反馈完整组件、实际 DTO/回调/用户操作材料，main 已交下载机制不重做，继续 F6。

### 成果 F6：无障碍、移动、WebKit 与实际 App 性能

实施范围：

- 在同一实际组成页面完成桌面1440/手机390、长中文/项目名/错误、稳定尺寸与完整操作返回。
- 键盘/焦点/读屏语义、200%缩放、禁用/加载/展开/错误提示清楚，控件不重叠或遮挡文本。
- 按现有 DESIGN/前端 skill 局部优化，保留熟悉导航与克制工作台，不全局换主题或堆嵌套卡片。
- Chromium 与可用 WebKit 做真实有限兼容，未安装/未测范围准确说明，不靠旧截图或模拟viewport声称通过。
- 大量可见工作/历史行、重试/切换和长会话交互有界，不把 source/页面性能通过称 native/48h稳定或效率收益。

实际 consumer：

- actual App 用两个包的全部新组件/真实 DTO 完成普通用户旅程，模块/harness/浏览器/安装证据分别记录。
- E 独立判断最终集成版本，F 交完整局部 source/样式/指南，不 self-admit installed/native/release。

必要正负：

- 真实页可读、可操作、可返回，长数据与有限压力下无布局跳动/无界请求/状态泄漏。
- 手机/键盘/错误/身份切换及旧 API 都有必要对照，未测读屏/平台/长期 auth 不补 PASS。

Source 交接：

- 后期写 `reports/trial-experience/wave34-status.json`，交两个包六成果 source/实际对象/视口/命令/余项。

## 独立备选队列与持续执行

- RootHTTP/App 新 callback 未到：早交 typed组件和真实 DTO，继续布局/状态/安全清理/旧 API 兼容。
- A/C body/history 未到：诚实 unavailable/partial，继续当前日常流，不在本地伪造历史/规则权限。
- G 支持资料未齐：保留现有主线下载与缺省标签，继续操作/错误/访问性，不造替代 pipeline。
- 包一 source 后继续包二；外部依赖只阻相关项，B/private/研究未达不停止普通体验工程。

## Whole Goal 完成条件与边界

- 六成果均有生产组件、actual App consumer、必要正负与 source handoff，并进入 main 实际集成版本。
- owned 仅 trial src/test/e2e、`docs/user-guide/`、`reports/trial-experience/`；根/HTTP/App/transport/授权属 main。
- A 唯一生产 SQL/迁移，E 唯一产品独立断言；不改候选外文件、root lock、用户状态或公共 wire。
- 自动真实 vendor/model/native0，B cap4 UNKNOWN/E 原 blocked pilot 不 reset/topup/refund/补样或价格研究。
- 保留十二用户服务及全部 state/profile/tar/ledger/dirty/runs；仅独立 birth/full 资源且每次 fresh 可受信号。
- 无 global discovery、借凭据、真实 CLI 回退、新 Driver/CAC/桌面/自动接受/第二 ledger 或生命周期。
- CAC排除，不新建 checkout/线程，不做 first-ZIP 冲刺；所有层级诚实，不以更多测试/图片改完成率。
