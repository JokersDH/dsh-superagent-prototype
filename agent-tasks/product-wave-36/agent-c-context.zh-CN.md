# Agent C：显式决定与原工作确认的完整子系统

日期：2026-11-17。继续 `/Users/hh/Desktop/joker/superagent-agent-c`。
原分支 `codex/g3-assistant-context`，保留原脏lock、runs、全部报告和历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0092 主线完成历史消费者](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[0093 架构复审](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)、[0094 子系统闭环](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。
保留改动后同步 `origin/main`，固定真实source，只推owned路径到原origin分支。

## Whole-Subsystem Goal 与历史延续

建立或延续一个goal：让当前显式决定被可靠选择、在原create事务确认绑定，并在日常来源/草稿重开中可用。
四个端到端产品闭环合并旧九成果，不是9→12再堆阶段，也不是四个修复测试。
旧C1–C2延续到闭环一，C3延续到二，C4–C6到三，C7–C9到四；历史验收不清零。
每闭环覆盖生产实现→默认实际consumer→必要正负→同版本/维护交接。
源码早交后连续完成四闭环及独立队列，不逐项等派工，不在小fix或source检查点停工。
无同日、工时、持续时长或token承诺，不通过重复全套或长soak充执行量。

- 固定起点 `01177e1d`；旧selected33rd、scope/provenance/deepfreeze和草稿/strict修复保留，不重派。
- 新同步guard有真实同UoW consumer，较创建前单独assert是实质进展，但仍漏superseded状态与canonical digest校验。
- 其测试reader将原PersistedDecision强转为DecisionRecord，不可用as never掩盖derived status缺失。
- 默认main创建持久引用/guard及App选择仍需闭合；source transaction示例不是已安装原生能力。
- main已交配置/回调/支持，并在接A严格完成历史；它们不是决定grant，不再声称只欠data port。
- 复用原DecisionGovernance/AssistantDecisionStore/provider/composer和main原prepare/confirm链，不建第二框架。

## 产品闭环一：Canonical 显式选择到可信当前 Binding

生产实现：

- 完成capture/revalidate/prepare/bind的统一schema、当前scope/version/content/source/time与有界选择语义。
- 选定ID通过可信per-id当前查询，不被项目窗口截断误报不存在；mode/window/selected覆盖准确。
- 保留完整snapshot深不可变和已报untrusted clone校验，不把valid/current/hash当grant。
- 修同步guard：每个record必须真正effective，superseded/inactive不能只因version未变、无revokedAt而通过。
- 验证/recompute snapshotDigest及完整binding shape/数量/时间，不能仅检查digest是string。
- binding嵌套数据和canonical身份稳定，克隆/修改不能污染用于持久引用的内容。
- 使用真正带治理状态的同步projection，复用AssistantDecisionStore.getSync及原可信source规则，不强转raw record。
- 所需有效性扫描不能完成即拒绝，不fallback active；source角色/项目/会话/provenance与摘要一致性保留。

默认实际 consumer：

- main兼容选择/准备消费者使用同一canonical生产模块，F可呈现当前/历史/缺失/不可选信息。
- currentScope由main可信授权输入，C只给数据与guard，不从客户端scopeChecked/valid推权限。
- async与sync治理对同一正常/撤销/替代/过期事实给一致结果。

必要正负：

- fresh、40条项目外窗口选择、真实当前scope/source和合法caller预算可用。
- 正常supersede、revoke、expiry/source变化、伪digest/shape/重复/版本与缺有效性信息必须拒绝。
- 大小/时间/字段边界有限，旧scope/provenance/deepfreeze与selected回归保持。
- 测试有合法原始对照，不用全inactive或SQL伪状态代替原governance正常操作。

同版本/维护交接：

- 早交canonical生产模块、真实同步reader契约、actual caller和命令exit，修复发布后继续其余闭环。
- 不把新guard默认准入，直至完整effectiveness/digest负例和main消费边界明确。
- 保留已关闭问题的证据，不把旧九重新派成独立小fix。

## 产品闭环二：原 Create 事务到持久确认引用

生产实现：

- 用户在main原表单选择并预览决定版本，原确认后固定当前所选引用到新Work/合同上下文。
- main掌shared schema、表单、原命令与UnitOfWork，C提供typed preparation/binding/同步guard，不新ledger或批准token。
- 用原prepareCommand→同UoW中current guard→commitPrepared的真实事务边界，不跨await持事务。
- 最终写前核当前actor/项目/Scope/source/version/治理状态，prepare后变化要求明确重预览。
- 在原存储/原artifact/context引用内持久化所选refs和canonical摘要，不能只在测试局部变量里有binding。
- 原command/body/receipt幂等保留：已提交重放查回同Work，不因后续撤销重发或改写历史。
- 无选择仍支持普通委托；决定是上下文数据，不扩大原工具/网络/文件scope或native批准。
- post-create assistantContextSend只能证明后续上下文，不能冒充create时绑定已完成。

默认实际 consumer：

- actual main原NewWorkForm/HTTP/Application使用这条确认链，F能定位所选版本及其现在状态。
- 原Work/contract可读回持久binding引用，模型/检查/人工接受沿同一原生命周期。
- 用户取消/修改/遇冲突能回原草稿；原raw创建无需伪造决定引用才能普通工作。

必要正负：

- 两项目合法选择到原Work，事务/receipt/绑定refs与冻结内容可核对，创建只发生一次。
- prepare后supersede/revoke/source/Scope/config变化、旧主体/版本和伪binding在effect前拒绝。
- guard失败后Work/queue/receipt无半提交，合法历史receipt重放不复活决定、不重复业务。
- 安装/native/活动恢复未测不补通过，原机器FAIL/人工接受权威不被binding改变。

同版本/维护交接：

- 交真实默认消费者、原对象/事务原始材料、持久refs和main最小接线需求。
- source早交持续联调，不以“同步函数已提供”或绿测试称用户确认闭环完成。
- 不复制另一create handler/coordinator；原schema变化由main统一冻结。

## 产品闭环三：来源治理与草稿到普通两项目重开

生产实现：

- 原来源preview/select/prepare/assert/send/冻结/历史read连续可用，当前权限与历史正文分清。
- record/supersede/revoke及source stale/expiry使用原治理，显式用户决定才生效。
- permission/auth回答、候选/testing/shadow或模型推断规则不自动进入新工作上下文。
- 撤回限制未来引用但不重写旧冻结bytes；运行中Work影响交main原修订/停止流程。
- safe draft创建/明确更新/有界owner-private/no-follow读取、协议/时间与source重新预览策略完整。
- TTL有效也不能替代当前source/config/version校验；草稿只数据，不持confirm token/秘密/可迁移批准。
- written/observed/unknown/recorded及原commandId/body核对准确，不默认换ID重发业务。
- 两项目/多会话关闭重开保留原来源/决定/草稿/receipt，readonly与普通模式兼容。

默认实际 consumer：

- actual main/F与正式CLI共享DTO/错误语义，原会话/Work/source使用同一批原数据和冻结引用。
- A提供持久原事实，main保留公开HTTP/副作用；C不造会话数据库、授权缓存或第二LLM loop。
- 模型配置saved只是当前主线能力，不表示对来源/决定自动增加授权或验证收益。

必要正负：

- 正常选择/记录/替代/撤销、私有draft/重新预览、原IDs和冻结bytes在普通重开后一致。
- cross-project、旧版本/源/权限、unknown/冲突body、symlink/0644/坏时间/大文件有必要对照。
- receipt重放不复活旧状态，不重复发模型/执行/接受；正文withheld不变完整零值。
- 读/preview/取消保持原副作用约定，真实vendor/native0，受控provider不借作原生证明。

同版本/维护交接：

- 交生产治理/持久策略、实际普通整链、原始对象/命令/限制及可操作错误返回指南。
- 旧已修三处保留回归，扩大完整用户链而非重复修复成果。
- 相应source/readonly/data恢复与活动native恢复层级准确，不混报告或旧包范围。

## 产品闭环四：实际 API/UI 到同版本兼容维护

生产实现：

- 收口生产exports/types/source/dist、公开DTO与原API兼容，让默认App真实消费而不只是CLI。
- provider/composer/snapshot/current guard共享有效性和原引用，不维护相似但分叉的规则。
- strict协议/版本/省略/unknown/预算和错误有限；Node文件/crypto/治理实现不进入浏览器。
- 原Scope/body/principal/actor链由main保持，new public wire由main冻结生成，不私自扩命令payload。
- 多决定/大量来源/旧格式/读中变化和失败重开可维护，原UoW与唯一Store不变。
- 完整操作材料覆盖选择/预览/确认/撤回/原来源/草稿/unknown核对，不要求手改表或复制profile。
- 发行在选定集成版本由D/E独立核准确字节，不以临时ZIP、组件数量或测试数代理工程。

默认实际 consumer：

- main/F/A/H用正式接口定位原事实，E独立核同版本对象和权限，不信report DONE。
- 一个actual App普通用户链完成决定选择、新Work原确认和重开原来源审计。
- 旧API/缺可选模块仍有准确普通fallback，不因可选新功能使主对话/原手动委托失败。

必要正负：

- 默认consumer、相关strict/有限正常错误/兼容与维护材料齐，源码闭包可复现。
- wrong version/schema/source/包或缺依赖明确拒绝/HELD，不借别的checkout/包补齐。
- 所有层级保留准确source/controlled/installed/native/recovered/value状态，不抬完成分数。

同版本/维护交接：

- 状态写 `packages/context/reports/wave36-status.json`，四闭环source/consumer/事务/原refs/命令/已合/余项齐。
- 保留旧九验收矩阵及原失败/修后证据，映射到四闭环，不重置预算或阶段数量。
- 四闭环均有实际生产/默认consumer/必要正负/维护交接才完成whole-subsystem goal。

## 独立队列与永久边界

- main新schema/表单未到：早交稳定canonical reader/preparation/同步契约和真实caller，继续owned治理/兼容/草稿。
- A/F未到：保留partial/unknown，推进其它闭环；不造替代SQL/API/UI，不无限轮询或长soak。
- owned仅context/proposals/knowledge/routing；main掌shared/root/contracts/lock/HTTP/App/transport/授权，A唯一生产迁移，E唯一断言。
- 自动真实vendor/model/native0，B cap4 UNKNOWN/E原blocked pilot不reset/topup/refund/补样/借凭据或价格研究。
- 十二服务和state/profile/tar/ledger/dirty/runs全保留；完整独立birth/全资源且逐次fresh才可受信号，UNKNOWNretain。
- 无global discovery、真实CLI回退、新Driver/CAC/桌面/自动接受/第二ledger或生命周期，不新建checkout/线程。
- CAC排除，不做first-ZIP冲刺，源码早交后持续四闭环与独立队列，数据current始终不是grant。
