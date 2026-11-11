# 第七轮接线边界：恢复隔离、提案事务与统一试点准入

日期2026-11-11，基线d4d51ae。输入A d3207d8、B 6890fe8、C 119bb96、D 4a0ea7f、E 3cfe445。状态：已读候选与下一实施约定；本文不实现恢复commit、开放预算或宣布installed-alpha。当前实际接口仍以0024/0025为准，本轮包见 [wave-07](../../../agent-tasks/product-wave-07/README.zh-CN.md)。

## 1. 审视结果与避免重复

A已交接受消费者/真实C联调与快照摘要，C已交真实A port/有界效力扫描/command plan，B已交真实传输及宿主拒绝探针，D已交干净schema13产物，E已交独立价值tier与部分安装验收。main需复验并整合对应源码，不让原branch上“尚未接线”的报告继续冒充当前main缺陷。

仍未实现的是main恢复授权commit、通用提案/上下文产品接线和完整D/E安装准入。E实际pilot仍0 turn；当前适配器的缺价格和整turn上界必须同时解决。任何模块自报PASS只在其source/layer成立，不能由派工自动提升。

## 2. 恢复设计检查点：旧历史与新执行隔离

本轮优先评审并实现的方案为：保留恢复state为历史只读来源，明确授权的新工作使用新建、空业务队列的执行state/代际。代际只表达实例授权/存储边界，Ticket/Assignment仍是唯一执行生命周期，不增加一套工作调度状态机。

选择这一方案的原因是旧state同时包含execute/verify/answer/assistant/reconcile等任务。不能只改变HTTP startupMode或新项目映射后启动同一Effects实例，也不能靠清空/删除旧队列使测试通过。若新state方案无法在当前组件中证明安全，main保留commit关闭并给具体阻断，禁止静默回退为旧库normal启动。

### 计划、持久事实、激活的语义（PLANNED）

| 阶段 | main/A/D需共同保证 |
| --- | --- |
| inspect/prepare | 继续0025只读检查；未来可提交计划要重新绑定真实marker、source state、当前机器/路径/profile/政策/环境/资源与材料摘要、期限及用户 |
| commit-intent | main校验明确用户确认，A在source现有UnitOfWork中幂等记录精确计划和稳定激活身份/命令回执；不得授予原历史合同新权限 |
| prepare-target | 在受控私有根内准备新的执行state/凭据/注册配置，无旧业务queue、runtime binding、native session或旧授权复制；不运行业务，路径/权限/所有者/链接及内容摘要可核对 |
| activate | 只有source已提交事实与目标实际字节/身份完全对应，且当前资源前提仍成立时才允许D启动新state；失败/崩溃可用原身份核对，不创建第二代际或隐式重试业务 |

文件系统与两个DB不能宣称天然跨库原子。main先发布实际协议与崩溃窗口，指定哪个已提交事实为唯一激活权威；未提交目标只能是不可启动的准备产物。缺source事实、目标不完整、重复/错路径/指纹变化时拒绝激活。清理只能处理可证明属于该准备身份的临时产物，不能删除用户目录。

A提供同步事实/查询/重放/版本保护port，优先复用现有receipts/events/artifacts；只有需要真实查询约束才追加迁移，不预建授权平台。main唯一决定公共schema、鉴权、状态切换与业务过滤；D只消费已发布接口和权威激活描述，不自行猜JSON或管理第二认证。

新state隔离**不替代物理资源屏障**：影响目标范围的旧writer若无法取得当前可信复验/隔离证据，继续阻断。旧ended、旧机器签名、PID不存在、目录复制或新代际标签都不能被解释为旧writer已停。不同资源命名空间是否足够隔离由明确证据决定，不从名称推断。

备份/再恢复不能继承可执行激活权限。D不打包新本机凭据或让旧描述在新根自动生效；恢复一律重新检查/明确授权。用户看到历史只读与新工作入口，不要求理解代际、数据库或queue内部结构。

## 3. 提案/上下文组合

C的planProposalCommand、listEffectiveWindow和真实A port消费者是起点。main先独立准入并发布必要公共companion，让E/D/C有实际入口；模型文本和ReasonerProposal只是待确认数据，不能带可信actor/native命令或扩大scope。

main需把现有Application的异步preflight与同步业务提交分开组合：外部文件/环境检查在事务外，确认时在同一UnitOfWork内重验当前来源/grant/合同/profile/检查/资源与输入，原UserCommand效果、proposal状态、事件和receipt同提交。禁止在事务中await dispatch或先confirm再补效果。

C仅补公开库函数/同步计划和输入不足语义，不改application/HTTP/UI；main复用C规则，不复制第二套确认算法。缺scope/criteria/profile/当前合同就needs_user_input，不擅用新默认值。确认、拒绝、撤销与来源失效后的重放都有固定语义；历史审计不因拒绝/撤销消失。

上下文只读预览绑定明确项目/原会话/可选work、来源摘要与预算。显式决定、项目事实和模型/文档内容标明来源与可信度，缺失/过期/扫描不完整不能默默成为有效知识；caller预算截断与完整效力扫描的失败分开。是否进入真实模型请求由用户授权入口决定，本轮不为演示调用模型或增加LLM loop。

## 4. B/E运行与费用准入必须统一

B的真实JSON-RPC transport与Seatbelt探针已经存在，E也有实际execute链；不能再把它们当缺接口从零重写。但当前B明确记录：Codex 0.164.0 turn协议无整turn预算字段、usage在turn后到达、实际模型别名没有可核对价格。E当前CLI估算预留与“可选B接口缺失就直连CLI”不能绕过这些事实。

本轮需要一个绑定实际adapter的准入结果。main拥有任何公共wire，B提供实现/证据，E消费并强制要求：精确executable/version/config/model/provider、真实价格出处/单位/日期、全部计费组件与工具往返的保守上界、实际生效的执行限制、会话/材料/宿主范围及原reservation身份。布尔canStopWithinQuota或文件存在不是权威证明；也不能把结束前能看到usage当作天然能阻止下一次超额消耗。

E预检须在价格之外同时报告runtime_bound_unavailable、isolation_unproven等实际缺口。字节/4+固定padding不是token上界，Math.min缩小一个大输入的预留更不合法；负数/NaN/无限费用、损坏ledger回退0、重试/结算重复计数、unknown退款等都需拒绝。真实session续接历史、系统输入、reasoning/cache与多轮请求必须入账。

默认只采用经准入的一个adapter路径；接口缺失/过期/版本漂移时拒绝，不能退到另一个未经证明的CLI路径。作者与复核都预留；保留原grant累计账。E grant 24 turn/200000计费token/USD5/一个在途不变，B原grant余量UNKNOWN继续不可花，main/A/C/D与E其他任务0模型。

### 有限可行性出口

B验证当前版本的可用原生配置/正式SDK/供应商限制：能够提供全部上界就交可复跑证据；不能就给NO_SUPPORTED_BOUNDED_RECIPE/BLOCKED及具体缺失，不再无限重复同一协议导出/假服务测试。允许零模型验证最多两个明确、可复用的替代recipe提案，不自动切provider/模型、加代理计费平台、实现新Driver或改变预算。

E只有在对应recipe、冻结协议和main准入一致后才消费原pilot grant。若需更换测量设计/模型/provider，先在确认0调用且不重置旧账的条件下版本化；已有调用则保留原实验/账并停止受影响执行，不覆盖结果。pricing文件本身不等于开跑许可。

这一可行性失败不证明独立复核无收益；反过来，dry-run合成报告promising也不证明有收益。个人版安装和功能收口继续独立推进。

## 5. 把宿主证明接到同一运行路径

B保留允许OS创建hardlink的负对照事实，不把“整个OS禁不了hardlink”重新设成产品硬前提。实际builder必须复制字节、拒绝/检测不安全链接或共享inode；故意换成hardlink builder要使准入失败。不能仅将旧FAIL改PASS。

Seatbelt/工具隔离必须覆盖E真正采用的执行/工具子进程树、凭据与网络路径，不能用一个独立Node探针的9/9替代真实adapter集成。engine合法使用传输凭据与模型工具能读取凭据是不同能力；scratch可写，原候选材料变化失效，账户/父目录/作者范围及未授权外发不可达。

真实vendor非计费握手可证明的只按相应范围记录；checkpoint/作者推理/复核结论仍需真正turn，不能靠空thread或假协议server授予实际模型兼容。

## 6. 安装、升级和独立准入

D已有干净schema13产物，E已在新根验证多数安装路径。剩余工作聚焦：PA_CONFIG_ROOT覆盖后可信release.json的初始化、两个真实不同二进制/代码产物、精确进程/端口/安装根切换、失败恢复与E独立升级。改tag只能是同源码对照，不能宣称二进制跨版本完成。

升级前的数据保护、升级后的新数据、回退时schema兼容/不兼容拒绝必须分别说明。不得为了回退静默回滚/删除升级后用户数据；若用户明确选择恢复某个备份，必须标为显式数据恢复并保留原state。没有真实二进制切换证明时保留NOT_TESTED。

本轮继续沿用module/controlled-product/actual-native-control/installed-alpha/review-value分列。review-value仅要求本次独立会话实验的实际结果和必要安全事实，不挂第二协议/路由平台；installed-alpha不要求pilot正收益，原生控制与恢复新工作能力单列是否通过。禁止将某tier自报PASS扩张为整产品PASS。

E从同一冻结artifact与干净source验收，不混D旧包/main新源码/B另一版本的证据；raw结果和派工状态不能互相代替。所有失败给真实owner/source/复现，已关闭阻断从新权威状态移除而保留历史报告。

## 7. 主线关键路径与当前范围

main本轮先发布最小A/C/D集成来源、准备命令事务接口及恢复激活方案检查点；随后实现proposal/context网页与恢复commit/启动切换，再冻结安装版本给E。不能只重复“inspect/prepare已交”就把M4算完成，commit不满足条件时明确保持未完成。

本文所有新schema/恢复激活事实/启动切换均为PLANNED，只有代码及分层证据发布后才转IMPLEMENTED。用户5180–5185六组实例、历史与原预算保留；本次审视和派工没有运行模型、变更生产DB或启停服务。
