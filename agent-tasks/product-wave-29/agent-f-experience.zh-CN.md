# F：实际模板入口、当前状态与长期工作台

2026-11-15。工作目录 `/Users/hh/Desktop/joker/superagent-agent-f`，原分支 `codex/g4-trial-experience`，固定验收起点 `f7d80b9a3c31c47ef97cbb1c8031d64f27a2135f`。
保留全部历史/dirty，fetch并合并最新origin/main；读AGENTS、START-HERE、product-spec/README和[本轮README](README.zh-CN.md)。
共享事实见[0071](../../docs/rfcs/WP-16/0074-wave-29-architecture-and-reviewed-inputs.md)/[0072](../../docs/rfcs/WP-16/0075-wave-29-product-completion-packages.md)。
仅apps/console/src/trial/、test/trial/、e2e/trial/、docs/user-guide/、reports/trial-experience/；App/transport/全局CSS/HTTP/contracts归main，不并改。
十位外部A–J加main按正常节奏建设，不设当日deadline。建立整个结果包goal，无token预算；24阶段/4、8、12、16、20、24六个完整结果，source发布后继续，不在小修或PARTIAL处等待下一轮。
来源/foreign/project-local旧反例已关闭，18纯例通过；新P2是blocked project仍applicable、遗漏grant exclusions仍可出draft。main0073已在原NewWorkForm接真实J/API/预填/重验/两项目创建接受，不再称主线缺入口。
另读[0073实际模板入口](../../docs/rfcs/WP-16/0073-main-project-recipe-preview.md)。
状态写 `reports/trial-experience/wave29-status.json`，必须分source/controlled/installed/native/value/activation；静态检查和阶段数不提供产品准入。

## F1 当前blocked状态

保留已修来源/project-local成果，针对schema-valid dispatchAllowed=false项目仍applicable的反例收口。
明确区分profile可用与project当前可委托；readonly/discussion/expired/blocked必须解释而不准备。

## F2 严格保留排除项

按原Scope语义保留所有grant exclusions，更多排除可收窄，不能用相反的subset检查允许漏掉保护。
缺排除或扩大allowed/externalActions拒绝，scope.expiresAt保持原边界；用原Application同配置positive/negative。

## F3 直接消费实际预览

读取main0073 ProjectRecipePreviewInput/Fields和实际POST，原子/criteria/profile以服务端当前结果为准，不按check refs重造一份丢字段草稿。
回调只提供受限选择给main原NewWorkForm，main仍重读config/facts与原明确确认，UI applicable不是授权。

## F4 第一结果：当前状态下可用入口

交blocked/完整排除等新反例与实际main预览的完整组件消费；原旧来源/跨项目positive不退化。
源码和精确props早交main后继续，main已交原表单，不以另一个fixture草稿演示替代真实消费。

## F5 两项目日常工作

沿原App完成对话、明确委托、问题上浮、机器检查、证据与人工接受两项目流程，保留原草稿。
使用受控本地执行器并明确controlled层，真实vendor/model/native0，不依赖新模型配额。

## F6 工作与会话归属

项目、会话、工作选择切换后保持上下文身份，晚到reply/观察/提案不能覆盖当前项。
关页重开/返回项目/已有历史的正常和错误都真实跑，root组合缺口交main可复现输入。

## F7 只读和异常返回

readonly、legacy、缺执行器/模型、auth失败与坏schema均有可退出/重试路径；不把配置事实画成执行通过。
保留已有四导航动作、无障碍名称和草稿；不因错误清空用户输入或自动创建Work。

## F8 第二结果：两项目实际日常闭环

交实际App两项目问答、检查、审阅、接受与返回草稿的完整可运行消费者，区分source/fixture/installed层。
source、动作、请求/副作用和截图早给E/main，再继续模板体验，不等下次派工。

## F9 从工作台打开原模板表单

将trial建议回到main已实现的NewWorkForm模板选择/预览/应用，带原project/kind/atom/profile选择，不直接执行。
需要App新增最小导航callback交main，F不并改App/transport/HTTP，也不携带私有root或命令。

## F10 未知重试与用户编辑

保留编辑goal、原scope/criteria/profile和配置变更提示；相同表单网络未知重试使用原commandId。
不因错误/刷新自动重建Work或用新ID填未知；跨reload未知结果仍走原reconcile，不夸exactly-once。

## F11 原数据的两项目journey

用当前原HTTP完成建议→表单→编辑→明确创建→问答/check/currentCandidate/manualaccept，两个真实项目隔离。
只读预览/取消零业务写，实际创建接受才有原命令；closed/late/auth/legacy可回手动流程。

## F12 第三结果：工作台建议到原交付

交实际main/J/F同一source完整用户流程，源/动作/回执/窗口/未达项和E可复现输入齐备。
controller数据或harness PASS不替代默认App；installed字节后由D/E独立验。

## F13 观测窗口与项目控制

通过可选受限props/callback提供7/30天与项目筛选，读主线已有接口，不在浏览器引入Node分析/凭据。
窗口/时区/identity切换立即隐藏旧值，复用现有刷新与错误状态，不增加第二collector。

## F14 partial和未知可读

区分已枚举work样本与每个metric样本，保留未知用量/成本、币种、证据层与部分UI活动代理。
不把窗口截断/缺来源画成完整总数，不声称人力工时或已证明收益。

## F15 日常观测操作

让用户能从观察返回原项目/工作和交付，数据更新或范围变化不打断原草稿与正在审阅的候选。
需新读DTO先给main最小实际调用；没有来源钻取就不要造可点但无效的入口。

## F16 第四结果：可信日常观测

交实际两项目/7-30天/partial/unknown与错误重试、晚到隔离的完整App流程，E能照同一source复验。
保留本轮G两旧缺口已关闭和main现有保护；不复制分析算法或为统计新造账本。

## F17 精密工作台局部完善

沿石墨导航/白色主对话/青绿方向，在自有trial子树统一局部token、紧凑表头、按钮和长中文换行。
遵循impeccable和现有DESIGN，不更换视觉世界、全局CSS或根导航，不为了截图加装饰卡片。

## F18 键盘与移动操作

核手机底栏/抽屉互斥、焦点恢复、表单错误、长路径与计数，加载/hover不改变固定工具尺寸。
真实浏览器一次集中检查桌面/窄屏；截图不能替代操作，未测screenreader/其他浏览器单列。

## F19 失败与版本适应

对后端重开、旧可选接口、scope/配置改变和读取中离开视图给稳定行为；保持观察与编辑互不污染。
错误文本脱敏，不显示token/私有绝对路径/stack，状态有清楚恢复动作。

## F20 第五结果：长期可用的工作视图

交完整局部视觉与交互、错误/空/加载/只读、多项目和键盘手机证据；实际功能与已测范围齐全。
源码与最小App组合需求早交main/E，不要求D为docs/test变化重冻运行包。

## F21 真实用户指南

以当前实际入口写用户操作、模板和审阅/停止/恢复说明，别用原型或旧字段冒充新功能。
异常时说明如何保留数据与回到原工作；不在产品界面堆架构或使用教学文本。

## F22 准确包体验交接

消费D明确tar/source/build/hash/schema/ABI/mode，在同一准确包核必要新增用户动作；E断言独立。
旧ce64正常安装scope保留，恢复模式bug或新统计/模板不能借旧报告认证。

## F23 稳定兼容交付

给main公开props/DTO/回调、最小fixture与迁移清单；无接口则给最小需求，不私造HTTP/授权层。
保留原boolean readiness consumer与新identity兼容，root文件/根锁由main唯一改。

## F24 第六结果与完整交接

写reports/trial-experience/wave29-status.json列F1–F24、六完整结果、actual consumers、源/包元组和未达项。
显式owned paths推原origin分支；source交后继续whole goal，条件未达不以阶段数或截图数算全产品完成。

## 独立备选队列

J/main接入未到先完成项目内适用性、统计原接口、两项目/只读/错误/移动键盘与用户指南。G无需重新证明旧nested/tombstone，main已有真实统计。缺D/E字节则保留source层，不把旧包贴新功能。
每个请求、子进程与总流程有限deadline，依赖未到标NOT_REACHED并继续可独立项，不无限轮询，不造第二实现或探针专用空方法。
所有自动真实vendor/model/native0；B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot BLOCKED，无reset/topup/refund/补样/价格配方研究。
保留十二服务5180/8796至5191/8807、全部state/profile/tar/ledger和B旧diff+b16/C lock/E runs/用户日志。只精确独立出生PID/start/UID/fullargv/root/config/operation且每次fresh后signal，unknown保留；不global发现、substring强杀或其他credential。
无新Driver/CAC/桌面/autoaccept/writer racing/动态DAG/第二生命周期；只显式自有路径推原origin分支，main用HEAD:main，不upstream/reset或清旧状态。
