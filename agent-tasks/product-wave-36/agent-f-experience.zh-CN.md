# Agent F：同一实际助手的完整体验子系统

日期：2026-11-17。继续 `/Users/hh/Desktop/joker/superagent-agent-f`。
原分支 `codex/g4-trial-experience`，保留六张未跟踪截图、全部dirty、状态/报告和历史。
先读 AGENTS、START-HERE、product-spec/README、现有DESIGN、[本轮 README](README.zh-CN.md)。
再读 [0092 主线完成历史消费者](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[0093 架构复审](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)、[0094 子系统闭环](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。
保留改动后同步 `origin/main`，继承真实集成修复；只推owned路径到原origin分支。

## Whole-Subsystem Goal 与历史延续

建立或延续一个goal：让原日常工作、证据历史/决定确认、模型配置和访问支持成为同一actual App的连续体验。
四个更大的端到端闭环合并旧九，不是9→12堆阶段，不以更多按钮/测试/截图算完成。
旧F1/F3到闭环一，F4/F5/F6到二，F2到三，F7/F8/F9到四；历史验收点保留不清零。
每闭环包含生产实现→默认实际consumer→必要正负→同版本/维护交接。
源码早交后连续四闭环、主线联调与独立队列，不在小fix或source检查点停工。
无同日、工时、持续时长或token承诺，有限必要验收，不靠重复矩阵或长soak填时间。

- 固定起点 `d515a9d4`，已继承main模型保存/StrictMode/identity/HTTP opt-in/saved修复，不重做。
- main原ModelPanel→认证POST→PrivateModelProvider私有保存是已实际可用surface，不再写waiting backend。
- 本轮main用A exact source接独立work-completion-history严格三kind metadata/签名cursor到原WorkEvidencePanel。
- F现WorkHistoryPanel吃旧WorkEvidenceHistory事件timeline，不是新协议；别重贴DTO、复制reader或新App。
- 现有ContextHistory/DecisionWorkspace/WorkEvidence实际viewer保留，有价值的候选组件按实际需要局部整合。
- 保持现有精密浅色工作台和原导航，按DESIGN/前端skill局部完善，不造营销页/第二shell。

## 产品闭环一：多项目多原工作到错误与草稿恢复

生产实现：

- 在原主对话/侧边工作区完成多个项目、会话、Work、原问题/批准、检查、当前候选与人工接受的连续使用。
- pending question/permission、机器FAIL、待审阅、delivered、accepted和unknown各自准确，原IDs不串。
- 模板和编辑沿main原preview/apply/edit/revalidate/explicit create，不本地拼全套授权字段。
- 返回原Work/对话/问题/证据与未发送草稿稳定，不用替代Work或乐观终态掩盖缺口。
- 加载、未配置/安装/认证/准入、明确拒绝、网络未知和已记录丢响应分开。
- 当前identity/config/project/window变化清理或隐藏旧结果，旧成功/错误不能覆盖新范围。
- 原commandId/body核对、取消/重试/焦点/输入保持一致，不默认换ID重发或增加另一请求状态机。

默认实际 consumer：

- actual App使用同批非空双项目/多工作原HTTP/Application/Broker数据，F仅交owned组件/typed callbacks。
- 主对话仍主入口，原四导航/目录/表单与真实工作返回统一，不另起demo或shell。
- main掌RootHTTP/App/transport/授权/副作用；后端缺口早交最小DTO与可操作复现。

必要正负：

- 正常交付、pending/FAIL/待审并存、两个会话/草稿/重开和原IDs返回有连续实际对照。
- 旧主体/合同/候选、重复/late、冲突/unknown/取消不隐式创建、批准、接受或发模型任务。
- readonly/缺callback/旧API保持可解释退化，原手动表单/对话仍可用。
- 错误脱敏，不把key/path/token/raw stack或内部owner教程放到页面。

同版本/维护交接：

- 早交实际日常组件/API/原对象/必要正负/命令exit，让main及时消费，继续其它闭环。
- 新生产行为、旧App回归、harness和实际浏览器证据分开，不靠重跑既有10场景冒新增能力。
- 旧九中的日常/错误/草稿矩阵合并保留，source发布不是whole goal停止点。

## 产品闭环二：原证据与主线新完成历史到决定确认

生产实现：

- 在原WorkEvidence表面消费0092实际三kind completion metadata/状态/外部cursor，完成非空工作历史浏览。
- 不把F旧event timeline或ContextHistory当新A协议，不在组件里转换并丢掉blocked/available/omitted语义。
- 初始已准入三kind做实，扩reviews/attempts须等正式授权投影，不能透传raw binding/resources/argv。
- 物理扫描数与真实review、source/caller/unknown/truncated/blocked、活keyset与冻结历史分清。
- 原artifact/check/patch/验证/当前候选/接受与历史证据可查、可返回，正文沿main原Scope/body/current gate。
- C当前决定/版本/来源/preparation用正式DTO呈现，data-only current不画成执行批准。
- 选择在main原表单明确确认，新Work前失效要求重预览；历史冻结版本不被当前撤销/替代改写。
- 候选review摘要不替代原机器FAIL与人工接受guard，不因metadata可读就自动授原文或执行权。

默认实际 consumer：

- 同一actual App从原Work读新完成历史、旧timeline、真实证据和原来源，再回原对象/草稿。
- main负责独立协议/签名cursor/hook/RootHTTP，F给局部展示/回调，不复制新reader或新App。
- C决定绑定未准入只阻对应确认项，已有历史/证据消费者继续；不要再次宣称缺另一个DTO。
- 主线原viewer好用时保留，有意替换才验证完整功能，不为挂候选组件而重复功能。

必要正负：

- 非空多页、历史/当前并列、合法内容/下载、显式决定选择和原接受流程真实可操作。
- wrong Work/contract/project、旧scope/cursor、坏摘要/缺正文、blocked和无进度准确显示或拒绝。
- source/version撤销/替代/过期、机器FAIL、旧候选与readonly不能借导航或绿色badge复活批准。
- 新metadata当前contract与历史row版本不混淆，未知不默认当前，读/preview/取消无业务写。

同版本/维护交接：

- 交实际默认页面、严格DTO/callback、原IDs/视口/必要正负及source，继续余下闭环。
- 清楚列原组件已挂、新候选未挂、主线消费者和安装层，不用raw cast或协议改名补完成。
- 旧F4/F5/F6证据保留并合入此用户闭环，不拆成更多页面小任务。

## 产品闭环三：已接模型配置到完整保存生命周期

生产实现：

- 沿已交原ModelPanel/typedtransport/认证POST/PrivateModelProvider，完善当前配置、编辑、保存、失败与旧API退化。
- 保存结果是saved，不冒供应商连接验证/native准入；保存本身不发模型/命令/事件。
- key仅组件瞬时state/请求引用，清理提交/失败/identity/unmount状态，不进storage/URL/log/普通DTO/反馈截图。
- server按原0700/0600私有原子方式保存，网页不回显key，别把合法server持久化误写成禁止。
- 保留StrictMode effect setup、generation/currentIdentity、独立redaction值、重复提交和初始props变化政策。
- HTTP需显式opt-in，URL credentials/query/hash和把key放到label/endpoint等非法输入沿正式校验拒绝。
- 原model/执行器/项目/讨论与开发能力分清，已配置不是已验证或可自动执行。
- main保留保存/auth/origin/RootHTTP与私有文件副作用，F不fetch、另建设置中心或读凭据。

默认实际 consumer：

- actual App普通用户在原设置中保存并回原操作，当前metadata和瞬时编辑值/秘密的边界明确。
- 原配置与model选择兼容，缺新API/callback时沿原安全设置方式退化，不阻普通对话/委托入口。
- 有用增量先交main，继承已修source，不再把旧候选bug或waiting backend当新成果。

必要正负：

- 正常保存、无message saved、显式HTTP与旧API、状态刷新和返回有实际StrictMode HTTP对照。
- 旧identity回包/echo、失败/双击/卸载、坏URL/非法字段不泄秘密、不重复副作用或误报连接成功。
- 保存0真实vendor/model/native；未真实验证的provider/账号行为准确说明。
- 浏览器秘密字段只有密码输入，不由错误、支持、URL或持久草稿回显。

同版本/维护交接：

- 交实际设置组件/contract/兼容政策和必要测试，source/Main/安装层分别记。
- 不改root配置/lock/privatewriter或候选外文件，服务端新增需求交main原模块。
- 将旧F2合成完整配置体验而非重写表单，继续闭环四与独立队列。

## 产品闭环四：访问质量与支持到同版本实际 App 交接

生产实现：

- 沿现有main支持GET/scope hook/digest下载和G脱敏metadata完成取得材料、理解缺证、定位反馈和返回工作。
- project/window/config/auth/observedAt一致，新读取snapshot与旧观察分清，未知origin不由Git/路径猜。
- 不收集key/raw prompt/目标/patch/私有路径，不自动上传或对外发消息，不复制collector或下载pipeline。
- 同一实际组成页面覆盖1440/390、键盘/焦点/读屏语义、长中文/错误和稳定尺寸。
- 200%缩放/强制色彩/WebKit按实际可用环境验证，缺binary/未测范围诚实标记。
- 保持DESIGN/现有图标/标准控件与原导航，局部优化，不全局换主题、堆嵌套卡片或新shell。
- 有限大列表/历史/长会话和切换/重试交互有界，不把短测称48h稳定或效率收益。
- 指南覆盖实际配置保存、日常工作、证据历史/决定、支持和unknown返回，不要求手改表或复制profile。

默认实际 consumer：

- actual App贯穿前面三闭环，正式main/A/C/G/H输入与F组件组成同一个可用产品。
- 与D/E按选定同版本source/模块交接；浏览器、harness、source/安装证据不混用。
- 支持仅准入metadata和当前身份，缺正式版本显示未提供/未验证，不制造发行或执行承诺。

必要正负：

- 用户可完成进入/编辑/保存/失败/重试/浏览/返回，移动键盘与长数据无横溢、遮挡或无界请求。
- stale/错scope/坏schema/digest/legacy/缺callback不串文件、自动下载或泄秘密。
- readonly/旧API与不同identity有必要对照，未测读屏/平台/长期auth不填PASS。
- 默认实际consumer和必要strict/有限正负齐，原机器检查/批准/人工接受权限不放宽。

同版本/维护交接：

- 写 `reports/trial-experience/wave36-status.json`，四闭环source/consumer/对象/视口/命令/已合/余项齐。
- 旧九矩阵、原FAIL和修后证据保留映射，不用更多截图/接口或四闭环数量改完成率。
- 四闭环进入main实际版本且维护/必要正负交齐才完成whole-subsystem goal，未安装/native层不冒通过。

## 独立队列与永久边界

- RootHTTP/A/C新输入未到：早交typed组件/真实样例与最小复现，继续owned日常/状态/访问性，不直接fetch或伪造数据。
- 依赖只阻相关项，四闭环及独立队列持续；研究/B/private未达不停止普通体验，也不扩大native预算。
- owned仅trial src/test/e2e、user-guide、trial-experience；main掌RootHTTP/App/transport/lock/授权，A唯一SQL迁移，E唯一产品断言。
- 自动真实vendor/model/native0，B cap4 UNKNOWN/E原blocked pilot不reset/topup/refund/补样或价格研究。
- 十二服务及state/profile/tar/ledger/dirty/runs、六未跟踪截图全保留；仅完整独立birth/全资源且逐次fresh可受信号，UNKNOWNretain。
- 无global discovery、借凭据、真实CLI回退、新Driver/CAC/桌面/自动接受/第二ledger或生命周期，不新建checkout/线程。
- CAC排除，不做first-ZIP冲刺；所有层级诚实，源码早交后连续四个产品闭环，不在小fix停工。
