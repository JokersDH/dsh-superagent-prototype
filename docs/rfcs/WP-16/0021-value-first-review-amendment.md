# 第五轮修订01：先验证价值，后扩大协议

日期：2026-11-10。承接用户对0019/0020及wave-05的五点复审。本修订与 [正式任务修订](../../../agent-tasks/product-wave-05/AMENDMENT-01.zh-CN.md) 优先于此前相冲突的排程、模型预算和原生只读前提。其余生命周期、权限、完成及资源屏障规则保留。

## 1. 两个独立问题与投资闸门

“新会话独立复核有没有帮助”先用当前Codex回答；“第二协议能否可靠接入”是另一个兼容性问题。更换模型不证明第二协议，新会话则足以构造第一项实验。B先继续现有控制/停止/恢复及有界session接口，不在价值试点前投入新协议产品Driver实现。

E先运行8例机制初筛：4个预埋缺陷候选、4个干净候选，各比较不复核、真实作者会话续查、全新会话复核。新会话只得到冻结任务与候选材料，不可见作者历史或其他复核报告；续查必须来自真实作者checkpoint，不能伪造作者推理。三组使用同一冻结候选与相同的复核资源上限，实际消耗分别报告；不复核组额外复核成本为0。

作者8个turn的成本只计一次；两种复核各8个turn。若缺陷在作者完成后注入，必须三组同变异，并明确这是合成材料，不是自然作者失败率。调用前固定案例、隐藏oracle、盲评规则、顺序、模型版本、预算和协议摘要。隐藏oracle与变异脚本不能暴露给作者或复核工具。

完整预注册要求见 [protocol.json](../../../tools/experiments/review-pilot-01/protocol.json)。新会话比续查至少多检出一个预埋缺陷、干净候选误报不多于续查且最多1/4、所有共同上限均满足，才判promising，允许下一次小规模异构试点。有效完整结果不满足则默认暂停新Driver投资；缺组、用量未知、session或隔离无效为inconclusive/invalid，不自动补样本。

8例只用于筛选，不能作为统计收益、产品准入或跨模型无益的证明。当前试点尚未执行，没有收益结论。

## 2. 单列小额预算

main单列E-owned grant `wave05-independent-review-pilot-01`：最多24个原生turn启动、累计200000计费token、USD 5，先到任一上限即停，只允许一个turn在途。一个turn可能包含多个底层推理调用，24不是推理调用总数承诺。

发送前须持久预留可核算的token/费用上界，包括历史输入、reasoning/cache等计费部分。价格、usage或原生turn停止上界不可核对就BLOCKED，不能用订阅代替零成本证明。未知发送保留预留并按原身份核对，不换ID重发、不自动补失败样本。B旧grant及历史账不刷新、不转移。预算计划已批准，实际调用仍为0。

E在自有验收目录产出私有运行账及可提交的脱敏摘要；本目录仅保存公开协议，不提交凭据、原生session dump或隐藏推理。实验材料尚未全部冻结，协议文件存在不代表可直接启动模型任务。

## 3. 密封副本默认，宿主边界仍单独验证

从已停止作者的冻结候选全量复制到一次性胶囊：不共享.git、object store、remote、hooks、符号链接、硬链接或作者文件inode。manifest绑定完整ReviewSubject；允许胶囊内scratch写，结束丢弃，只消费报告。

临时目录不是宿主沙箱。必须另外约束宿主文件/工具、凭据、网络和数据外发范围；只复制文件不能证明这些能力。输入发生改变时，修改后测试不能为原candidate背书，必须标input_mutated/inconclusive。报告里的命令仅是数据，不能直接执行。

`ReviewEvidence.isolation`新增两条显式路径：`sealed_copy`携带proofRef/capsuleManifestDigest；`native_read_only`携带实际原生只读证明。旧readOnlyProofRef为兼容字段，与新isolation互斥。schema只验证形状，不能自行颁发隔离证明。胶囊运行器与实际隔离准入仍待B/main实现，尚未声明可生产复核。

## 4. 先交用户可见的注意力能力

main/C首个产品阶段与R0、E试点并行：跨项目/会话汇总待回答、待接受和明确故障；按真实期限、阻塞关系、等待年龄、类别确定性排序并解释原因；保留来源及回原工作入口。缺期限保持unknown，不把问题过期时间编成业务deadline。

C提供纯rankAttention和规则fixture，main聚合读取与工作台，A仅补必要索引，E验混合项目/过期/旧版本/越权及离线操作。批量审阅是连续浏览与逐项确认；权限/认证仍逐请求逐target，不能一键共享授权或自动接受。本次已修订排程，注意力UI尚未交付。

## 5. 默认入口门槛

R0未准入前，推荐/复核只允许显式实验入口、默认关闭，不进入普通发送/委托/接受。R0包括真实持久命令事务与重放、所用profile的控制/停止/未知发送、恢复不执行旧队列、发行及严格发布gate。随后还要准入新路径材料隔离、外发授权、预算、来源和旧候选失效负例。

main记录精确源码及准入决定，E独立复核。pilot promising只是研究继续的闸门，不能代替R0或默认启用决定。当前并未实现新的产品路由/复核入口，本条是后续接线的强制规则；原已实测Codex路径继续按原门槛运行。

## 6. 已实现的观测接口

公共`ReviewTiming`已增加到ExecutionOutcome的可选reviewTiming，兼容旧记录；新producer必须填观测值或显式null。实际采集先写既有事件日志，A随后关联outcome/timeline，无新增生产迁移或writer。

| 字段 | 实际含义 |
| --- | --- |
| candidateReadyAt / acceptedAt | 持久可信验证回执时间 / 接受成功的服务端时间 |
| readyToAcceptanceMs | ready到accept的墙钟间隔，包含离线及排队 |
| activeReviewMs | 当前已验证候选详情可见且有焦点的UI活动区间并集 |
| activeReviewSource / Completeness | ui_visibility_proxy / partial；缺失为unknown和null |
| evidenceRefs | 对应验证与活动事件的有界出处列表 |

HTTP `POST /v1/works/:id/review-activity`只接受认证local_ui和精确当前已验证候选；短span不超过15秒，未来/过旧发送拒绝，commandId幂等。配置reviewActivityAvailable使旧后端不被误调用，恢复只读配置关闭此入口。

网页每5秒、失焦/隐藏/切换时flush；长时间挂起的span丢弃。接受前flush有1秒HTTP超时，遥测失败不阻断业务。服务端在成功accept_candidate的同事务写application.candidate.accepted；失败与同命令重放不重复计数。重叠tab取并集并裁到ready→accept；当前最多扫描验证之后5000个事件，覆盖不足仍partial，后续可由A索引替换。

活动代理不等于真实思考时间，不能作为质量或自动接受证据。等待间隔已包含活动时间，两者不能相加；跨候选估计总人工时间也需全局区间并集。旧页面、旧记录和漏报不填造0。当前用户的5180–5183服务未重启，新采集在新代码部署后生效。

## 7. 验证与下一消费者

本次验证分为共享schema、HTTP/真实SQLite受控执行、UI活动采集浏览器链路；不包含原生复核或收益测量。精确命令及结果将保存在reports/releases/wave05-amendment-01/，不覆盖既有发布证据。

A消费accepted事件及ReviewTiming；B提供当前Codex可核对的session/checkpoint、有界预算和胶囊宿主约束；C先交注意力排序和旧决定事务闭环；D继续个人发行/恢复；E先冻结试点并核对可运行性，同时验证R0及默认入口。各角色仍在原工作目录/分支，不能覆盖他人修改。
