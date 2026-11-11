# 主线：恢复新工作、提案网页与统一安装版本整包

继续primary checkout、`codex/g2-execution-integration`，读本轮[README](README.zh-CN.md)和[0026](../../docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)。拥有contracts/application/questions/coordinator/console/root配置锁/共享文档与集成；不并发改A–E拥有实现和E断言。真实模型0。

基线d4d51ae已经交决定网页/共享排序/接受Outcome与工作证据/恢复inspect及prepare。新的恢复commit、通用提案确认与上下文预览尚未交；必须实现真实消费者，不再把readonly preflight算作恢复完成。本包关键路径在main。

## M1 早交A/C/D来源与两个实际共享接口

分别复验并最小集成A/C已有真实消费者与D first-run源码，root lock由main再生成。B控制接口按适用范围准入，不让试点上界阻断A/C/D产品接线。记录准确source/accepted paths/反例，不以整branch自报PASS代替。

分开发布M1-source、M1-recovery-interface、M1-command-interface检查点。前者是已可消费源码；后两者是有运行fixture的真实共享端口和应用组合约定，不止一段PLANNED文档。恢复协议按0026先校核两个DB/文件系统的权威和崩溃窗口，命令协议分离异步preflight/同步commit。

M1-pilot-admission单独只读复验B1–B4/E1、冻结protocol及ledger；全条件满足才发布具体recipe准入，否则列BLOCKED。派工不自动授予模型发送，不自己跑付费smoke，不要求E先交结果才给它可用接口。

## M2 实现提案的事务性应用命令

消费C planProposalCommand及A持久port，不复制C规则。外部文件/环境preflight在事务外；确认在单UOW中重验当前source/actor/grant/scope/profile/合同与输入，将原UserCommand效果、proposal状态、receipt/event同提交。事务中不await dispatch。

覆盖confirm/reject/revoke各实际支持语义、重复命令和响应丢失、来源过期、版本变化、下游业务失败与reopen。缺字段走needs_user_input，不擅填scope/profile/criteria；模型文本不能构造可信actor/native命令。库层通过后发布真实认证HTTP检查点给C/E。

## M3 接上下文/提案与交付证据网页

复用C有来源/显式范围/有界输出的composer，增加只读上下文预览与可确认提案入口，显示实际对象、缺项、当前状态和失效原因；继续主对话为中心的石墨/白/青绿设计，不再铺新面板体系。

把已有工作evidence/Outcome/partial计时接成紧凑交付历史，历史审计与当前权限区分。确认/拒绝/撤销、响应未知同命令、重开/跨项目和移动布局都可操作。按适用前端skill做真实浏览器验证，受控输入不宣称真实模型已跑；新模型0。

## M4 实现旧历史只读与新执行的明确激活

按M1实际协议实现inspect/prepare/commit与D启动描述：source事务内稳定意图+receipt，准备私有新空state，source已提交事实与目标字节/身份匹配才激活。新state不复制旧业务queue、session或权限；原marker和历史数据保留。

严格绑定当前机器/路径/profile/环境/材料/资源/期限/用户，明确唯一激活权威与每个中断窗口的重入规则。未提交/半准备目标不可启动；重复确认、提交后响应丢失/重启不得生成另一代际。未知影响资源的writer仍须当前可信屏障或已证明的物理隔离。

在source提交前后、目标写入/指针切换/启动前后注入失败并复验。恢复源仅窄授权元数据写，不将normal开关施加到原Effects队列。无法满足则commit仍关闭、此阶段未完成；不能删marker/队列或以新state绕过屏障换PASS。

## M5 冻结同一来源并完成独立安装准入

集成D双binary切换与A快照，给D两个真实不同source的构建基线和目标。先交冻结安装物让E实测，最终准入才等待E3–E5；不制造“先E通过再给产物”的依赖环。

主线复验PA_CONFIG_ROOT/可信manifest、作者checkout独立性、数据保留/不兼容回退拒绝和恢复新工作关键窗口。安装/controlled/native各自报告，原生控制缺实证仍单列不通过；pilot结果不是个人产品出口前提。

## M6 交统一状态、可用入口与有限研究决定

汇总真实source/安装物/tier/未完成owner，不给虚构百分比。E2有实测才谈独立复核收益；NO_SUPPORTED_BOUNDED_RECIPE只是当前运行方案不可行，不是研究no-go。即使promising也不自动启动第二Driver或新预算。

发布统一用户入口、安装/升级/恢复步骤、保留实例/数据边界与下一开发消费说明。权威`reports/releases/wave07-integration/status.json`记录源、实际命令、证据和真实模型0，accepted commits推origin/main。计划文档/static检查不计作M1–M6实现完成。

先M1接口与逐段源码收货，连续推进M2/M4及M3/M5，不等全部整包结束；遇owner依赖先做本方失败窗口/公共schema/HTTP与网页消费。保留5180–5185及全部状态、账号、ledger；不新增长期预览或自行重启用户实例。
