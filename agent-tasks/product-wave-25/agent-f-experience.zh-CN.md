# Agent F：真实试用入口与日常工作台体验整包

日期：2026-11-14。新目录 `/Users/hh/Desktop/joker/superagent-agent-f`，分支 `codex/g4-trial-experience`，由 main 创建后使用，不另建无关 checkout。
仅拥有 `apps/console/src/trial/`、`apps/console/test/trial/`、`apps/console/e2e/trial/`、`docs/user-guide/`、`reports/trial-experience/`。
先读 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0064](../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md)、[0065](../../docs/rfcs/WP-16/0065-wave-25-eight-agent-delivery.md)。
fetch 并合并最新 `origin/main`，实际 source/DTO 以当前 `AGENTS.md` 和 main 检查点为准。八位外部 Agent A–H 与 main 并行，F 是新增体验 owner。
main 保留 `App.tsx`、transport、根 CSS、HTTP、contracts 和集成；F 不编辑这些文件，先交可编译组件让 main 及早接入。
本包必须交实际体验组件和使用文档，不只写测试、报告或静态效果图。

建立整个结果包 goal，不设 token 预算。十六阶段连续实施，F4/F8/F12/F16 发布四个可运行完整结果里程碑，交后继续独立阶段。
main 正在提供真实 `GET /v1/readiness`、`TrialReadiness` 和 `ConsoleTransport.readiness`；其输出是 configuration-only、authorization none。
组件 `TrialWorkspace` 通过 props 消费 DTO/请求状态，通过 `onAction` 回调交给 main 原有动作，不自发发模型或执行命令。
回调动作仅 `configure_model`、`import_project`、`inspect_executor`、`open_conversation`；新需求先交 main 最小 RFC，不发明第二 authority。

## F1 理解现有工作台与设计规范

- 阅读实际 DESIGN 文件、现有 console 构成、状态展示和用户主对话流程，保持石墨导航/白色主区/克制青绿风格。
- 使用 `impeccable` skill：首次使用告知用户并读取实际 SKILL.md，按既有应用审计和交付流程执行。
- 明确首次试用和每日使用的用户目标：确认配置、进入项目/对话、识别阻断、处理下一步。
- 保持主对话为中心，不做营销 landing page、巨型 hero、装饰卡片或重复主线设置页。
- 验收：给出当前具体交互缺口与局部设计方向，能定位到真实组件和入口，不泛谈“高级感”。
- 交接物：自有路径内的设计说明、局部组件图和实现清单。

## F2 消费真实 readiness contract

- 从 main 公共出口使用 `TrialReadiness`，传输调用通过现有 `ConsoleTransport.readiness`，不得复制一个私有 DTO 或 HTTP client。
- DTO 未发布时先确定 props/状态和呈现结构，早给最小接口需求；临时样例准确标测试数据，不称真实 product PASS。
- configured、unconfigured、unavailable、fixture、unknown、readonly 与已测 native 能力必须按实际数据区分。
- configuration-only/authorization none 不能成为 native 就绪、可执行授权、费用许可或质量证明。
- 验收：组件消费实际公开类型可严格编译，未知/缺字段有明确状态，不补绿或填零。
- 交接物：组件 props、状态映射和 main 可直接接入的 typed 调用说明。

## F3 实现 TrialWorkspace 核心组件

- 在 `src/trial/` 实现可直接接入的 `TrialWorkspace`，包含紧凑状态、相关项目/对话入口和清晰下一动作。
- 通过 props 接收 readiness、loading、error 与可选观察数据，数据来源和页面状态保持单一。
- 命令只调用四个 `onAction` 回调，由 main 接原配置/导入/检查/对话动作；F 不自己创建业务生命周期。
- 分区采用有约束的布局和局部样式，避免根样式污染、嵌套卡片和内容动态改变工具尺寸。
- 验收：组件能在现有 React 环境实际渲染，动作可达且不重复触发请求，不包含隐含模型/执行调用。
- 交接物：可运行组件入口、exports 和最小接入片段。

## F4 第一里程碑：尽早交可编译体验

- 发布 core component 与 typed props/checkpoint，main 可在真实 App composition 中立即接入，不等整包视觉/文档完成。
- 不编辑 `App.tsx`、transport、根 CSS 或 contracts；提供精确 import、回调和布局接线需求。
- 本地隔离渲染覆盖空/加载/正常/阻断态，说明哪些数据仍是测试样例。
- 若 readiness 接口未到，继续视觉/状态/回调/可访问性，不把外部依赖当停工原因。
- 验收：相关 strict/build 或 main consumer 编译通过，四动作契约明确；提交早期源码后继续。
- 交接物：第一可运行结果、main 接线说明和真实未达项。

## F5 状态与 next actions 的清晰层次

- 实现配置缺失、项目未导入、执行器不可用、fixture/unknown 与只读恢复的简洁状态展示。
- next actions 依据 DTO 和 main 允许动作派生，不根据文字相似、badge 颜色或 localStorage 自建权限。
- 主动作与次动作清楚，工具按钮优先现有图标并有 tooltip/accessible name，不堆满文本胶囊。
- 使用真实状态标签和短命令文案，不在应用内写架构、技术特点或操作教程式营销说明。
- 验收：各状态只出现适用动作，未知不变绿色就绪；点击仍走原 main authority。
- 交接物：完整状态/动作矩阵及真实样例。

## F6 项目与对话入口

- 让用户能识别当前项目、相关对话和可用入口，延续现有导航习惯与主对话焦点。
- 导入项目/打开对话只触发对应回调，不直接改 root、配置、数据库或 history 的授权绑定。
- 处理没有项目、多个项目、长项目名、已归档/不可读项目与无当前对话的布局。
- 不新建平行 conversation catalog 或把测试 fixture 显示为用户真实项目。
- 验收：入口、返回、选择状态与 main 路由一致，长文本/小屏不重叠，动作不会跳到错误项目。
- 交接物：项目/对话相关呈现组件和准确回调输入。

## F7 阻断和只读体验

- 将 readonly、缺配置、未知执行器和暂时错误呈现为可理解状态，不以一个笼统红色错误覆盖所有内容。
- 已读历史/来源可以继续审阅时保留内容，阻断动作与可读动作分别明确。
- 只读提示不得包含新的批准、恢复授权、重发或自动接受入口；来源诊断由 main 已有组件负责。
- 重试只刷新实际 readiness/read 数据，不能隐式发送模型请求、启动 agent 或消费旧队列。
- 验收：readonly/unknown 下可读内容和正确动作保留，错误不会清空已有有效数据或误解锁执行。
- 交接物：阻断/只读/错误组件及适用场景。

## F8 第二里程碑：真实接入与主要流程

- main 接入检查点后，消费真实 HTTP readiness 和现有配置/项目/对话状态，不以静态演示代替产品。
- 从项目/配置状态进入已有 main 动作，再回到工作台，状态更新准确且不会触发重复操作。
- 记录实际 API、DTO、回调与渲染范围，fixture/unknown/readonly 不能当 native ready。
- 用受控环境核验用户主要流程，保留生产执行器和真实模型未测标签。
- 验收：第二可运行结果在真实 app composition 中成立，交后继续手机/键盘/错误/文档。
- 交接物：main 集成 source、实际用户 journey 与有限请求记录。

## F9 桌面与手机布局

- 按现有设计约束完善桌面/窄屏的稳定布局，状态、项目、动作和对话入口都可扫描。
- 卡片圆角不超过既有设计规范；不以套嵌卡片或全屏大字制造层级。
- 文本可自然换行，按钮/图标有稳定尺寸，长中英文、错误信息和计数不溢出或覆盖相邻内容。
- 样式只在自有组件范围，复用现有 token，不修改根 CSS 或引入另一套全局主题。
- 验收：实际 desktop/mobile 截图无重叠/横向溢出，核心动作可点击，布局不因状态切换跳动。
- 交接物：有界视口记录、实际截图与局部样式。

## F10 键盘与可访问性

- 使用原生按钮/链接和合理 heading/landmark，所有图标动作有 accessible name 和必要 tooltip。
- 焦点顺序、可见焦点、回调后的焦点保持和异步状态通知符合现有工作台行为。
- 禁止仅靠颜色区分 configured/blocked/unknown；加载和禁用状态应有正确语义。
- 不在可见页面堆砌快捷键说明；功能可通过熟悉控件和键盘直接操作。
- 验收：主要流程纯键盘可达，状态更新不抢焦点，reader 能识别动作和阻断原因。
- 交接物：键盘路径、可访问性检查结果和必要代码。

## F11 加载、重试与过期响应

- 覆盖首次加载、慢响应、网络错误、重试、项目切换和旧请求晚到，避免旧 readiness 覆盖新身份状态。
- 刷新时保持已有有效信息，不能凭空清空对话/项目或让用户重复已经完成的动作。
- 重试、重复点击和卸载后的状态更新有界，依赖现有 transport 的错误语义，不增加 private HTTP loop。
- 错误文案简短可执行，不向用户泄露 token、根路径、原始栈或内部 authority 细节。
- 验收：有限故障/乱序返回测试通过，当前项目和动作正确，重试无模型/执行调用。
- 交接物：加载/错误/空态组件和真实响应顺序记录。

## F12 第三里程碑：日常工作台可用

- 将真实接入、桌面/手机、键盘与错误恢复整成同一日常入口，不只分散交演示。
- 用户能识别当前可用能力、进入正确项目/对话并完成适用动作，不误认为 fixture/unknown 是原生准入。
- 验证 main composition 的真实状态，不用自建静态页面替代 app 截图。
- 实际前端修改按 skill 做有限 Playwright 视觉/交互验证，保留已测视口和未测范围。
- 验收：第三可运行完整体验可独立演示，发布源码后继续可选报告和用户文档。
- 交接物：核心流程、视觉/交互证据和准确 integration scope。

## F13 可选观察性效率报告

- G 后续提供纯 observation/insights 时，可用可选 props 增加紧凑报告入口或展示，不阻核心 readiness 流程。
- 不自行估算模型花费、用户节省时间、质量或审批效率；缺数据用 unavailable/unknown，不填零或编百分比。
- 显示窗口、样本数、观察范围和已知限制，观察不成为授权、质量证明或自动接受条件。
- G 接口未到先交可选输入需求和空态，不能为展示去读私有 SQL 或扫描所有正文。
- 验收：有/无观察数据均正常，核心操作完全可用，报告不会扩大读写权限。
- 交接物：可选呈现组件和 main/G 可消费的 typed 需求。

## F14 用户简介与实际使用文档

- 在 `docs/user-guide/` 写面向内部试用者的简介、首次配置、项目/对话、问题处理、交付审阅与常见状态说明。
- 明确哪些能力已实现、哪些需要配置/真实准入、哪些仅受控测试，不把架构愿景当当前功能。
- 文档引用实际界面和命令；新本机部署沿 D/main 指南，不另造安装命令、默认 key 或共享多用户服务承诺。
- 技术实现、调试细节和测试步骤留在文档，应用主屏只放真实状态/动作。
- 验收：新同事按文档能完成实际入口和一个受控 journey，误用/阻断有清晰处理。
- 交接物：完整用户指南、实际图示和版本/范围说明。

## F15 真实 HTTP 用户 journey 与交接

- 自有 `test/trial/` 和 `e2e/trial/` 覆盖真实 readiness→main 回调→项目/对话入口，必要时用 main 的隔离受控配置。
- 测试只证明当前实际产品流程，受控后端/fixture 标明，不冒充 vendor/native 或 E 全产品发布验收。
- 不修改 E product-acceptance 断言、main App/transport/根 CSS 或其他 owner 路径；缺集成给最小源码/复现。
- 使用私有新根/端口，不扫描或重启十二用户服务，不向旧实例发变更命令。
- 验收：实际 HTTP 数据和 UI journey 对应、错误/小屏/键盘有限覆盖通过，浏览器错误可归因。
- 交接物：可运行测试、main 接线清单和 E 可独立使用的交付说明。

## F16 第四里程碑与最终体验包

- 状态写 `reports/trial-experience/wave25-status.json`，列 source、真实 endpoints、DTO/回调、视口、命令/exit 和未测范围。
- 第四可运行结果包括 `TrialWorkspace` 实际组件、日常状态/动作、响应式/键盘/错误、文档与真实 HTTP journey。
- 可选 G 报告未到不阻核心体验，main wire 未到准确记依赖并交可编译源码，不标静态页面为产品通过。
- 显式 stage 自有路径，push `origin` 的 `codex/g4-trial-experience`，不推 upstream/reset/清历史。
- 验收：组件可被 main 直接消费且用户流程实际可用，goal 仅在完整结果包实际完成后结束。
- 检查点交后继续独立队列，不等新的小修派工才完成文档/状态/可访问性。

## 独立备选队列

- readiness/根 wire 未到：先交可编译组件、状态矩阵、四回调、响应式/键盘/错误和用户指南，样例准确标测试范围。
- main 集成未到：提供最小 import/props/onAction 接线，不编辑 App/transport/根 CSS；继续自有组件与有限测试。
- G insights 未到：可选入口保留 unknown/空态，不阻核心工作台；H 模板未到不造替代任务 authority。
- 全程真实 vendor/model/native 调用 0，禁止组件挂载、重试或演示隐式触发；B UNKNOWN/E BLOCKED 账本不刷新。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger、旧 dirty；仅清理独立证明本轮出生的资源。
- 不新增 Driver/CAC/桌面壳/自动接受/动态 DAG，不改其他 owner 源码；main 保留 authority、E 保留独立验收。
