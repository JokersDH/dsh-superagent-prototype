# 提案：证据约束的路由建议与候选独立复核

日期2026-11-10。状态：PROPOSED，尚未实现或批准为新的生产执行策略。输入基线`654765e`及 [评审回应](../../reviews/architecture-and-innovation-response.zh-CN.md)。不改变wave-04派工、模型预算、frozen Runner/data wire和当前完成要求。

## 1. 问题与目标

当前产品证明了限定的单Codex开发路径，尚未证明异构收益。需要用一个能落地、能失败、能比较的流程验证平台额外价值，同时维持现有事务、权限、候选和资源屏障语义。

目标：用户给出目标后，平台根据**实际准入的能力和当前证据**推荐执行器与是否附加复核；确认后照原链路执行；作者停止并冻结候选后，另一个实际不同协议的执行器可在明确只读权限下复核；用户看到注册检查、复核发现和依据，再按原合同接受。

非目标：新增通用LLM工具循环、无限修复团队、同合同多writer投机、自动合并/部署、置信度取代必需人工验收、在线强化学习路由、分布式编排集群。

## 2. 三个模块及其接口责任

### EvidenceEligibility：准入过滤

消费既有Catalog/CompatibilityIdentity、公开项目授权、固定合同及执行器政策。对每个profile返回eligible或稳定排除原因及证据引用；不训练质量分数、不启动模型、不改准入状态。

必要检查：profileRevision/driver/native版本、executable/config/policy指纹、当前平台、native准入、相关能力的实际证明、scope/数据目的地与预算。PASS兼容仅是可用资格，不等于质量高；schema测试、fixture或旧报告不能变native PASS。

同一协议更换底层模型不等于第二协议；但模型身份改变仍会影响质量证据适用性。未测能力、证据漂移和授权收缩默认排除，保留人工解释与重新探测入口。

### RouteAdvisor：建议

输入是有界任务刻画、已过滤候选与有效结果证据；输出RouteAdvice，不产生执行效果。任务刻画可由Reasoner提出，但决定字段经parser校验，不能携带actor、native命令或扩大scope。

概念性数据（不是已冻结的wire类型）：

```ts
type RouteAdvice = {
  id: string
  taskContextDigest: string
  catalogRevision: string
  policyRevision: string
  eligibleProfileRefs: readonly string[]
  suggestedProfileRef: string | null
  excluded: readonly { profileRef: string; reason: string; evidenceRefs: readonly string[] }[]
  basis: 'only_eligible' | 'operator_default' | 'fixed_rule' | 'measured_history'
  evidenceRefs: readonly string[]
  reviewSuggested: boolean
  expiresAt: string
}
```

profileRef必须在服务端解析到精确版本与身份，不能是一个品牌字符串。只有一个eligible时明确返回only_eligible，不虚构比较；样本不足按operator_default/fixed_rule，不显示假概率或成本。未知费用不是零，未知性能不是低质量。

用户明确确认或原先明确授权的路由规则，才使主线从建议构造现有create_work。**路由规则只可在原授权允许的profile/scope/预算中选择，不新增执行授权。** 记录原建议/排除原因/所用版本；实际dispatch前重新校验资格，profile写入合同关联的执行快照。旧建议过期或漂移要重新提案，不在执行中静默换agent。

当前唯一可写命令权威仍是application/coordinator→Ticket/Assignment→事务effects。Router不直接调用serve/begin或改core状态，原生未知发送也不能靠换profile当作故障重试。

现有core Decision处理接单等领域判断；profile来自可信create_work并记录到关联Trigger/执行快照。不要把Router建议当成core新增“路由状态”硬塞进去。真正接第二profile前还需改造当前single-NativeProductConfiguration组合与项目profile授权集合，保持已冻结合同的执行身份；不是仅在UI增加一个选项。

### CandidateReview：独立复核

输入：已获可信物理屏障的冻结候选、最小必要patch/检查材料、明确的复核授权和精确reviewer profile。输出ReviewEvidence及审阅发现；不确认主候选、不写humanAcceptance。

```ts
type ReviewSubject = {
  candidate: CandidateRef
  artifactDigest: string
  baseCommit: string
  environmentRef: string
  checkPolicyRef: string
}
type ReviewEvidence = {
  id: string
  subject: ReviewSubject
  reviewerProfileRef: string
  inputDigest: string
  reportDigest: string
  evidenceRefs: readonly string[]
  disposition: 'findings' | 'no_findings' | 'inconclusive'
}
```

以上仅为领域提案，真正公开schema由main根据首个消费者确定；不要求现在加另一套泛型状态机。

复核执行如使用原生工具，仍通过现有Ticket/Assignment承担生命周期；如何把辅助Ticket关联到subject由专门契约评审决定，不能偷偷变成第二primary candidate或让复核Ticket的完成确认主Ticket。若现有类型不能准确表达，先RFC补齐而非强行复用不相干字段。

reviewer输入与作者会话隔离，默认不给作者完整推理/指令历史；只读材料可选择sealed artifacts或经证明的只读workspace。没有可验证的只读能力就拒绝该复核路径，不能用prompt“不要写文件”当权限保证。worktree本身不提供安全沙箱。

报告中的命令、链接和代码均是不可信数据；不得从review文本自动注册检查或执行shell。模型发现可给定位/理由/建议复现，但只有受信任注册检查的实际结果才是机器验证。no_findings表示未发现问题，不表示证明正确。

## 3. 最小执行时序

1. 用户选择项目并描述目标，Reasoner提受校验的任务刻画。
2. Eligibility按当前native准入和授权过滤；Advisor提出可解释建议。模型离线可用固定默认或手动选择。
3. 用户确认后，main同事务写原Work/Ticket/Assignment、profile快照、receipt与effects。
4. 作者按原Runner执行；所有owned writer静止后冻结候选并运行注册检查。
5. 用户已授权的复核路径准备最小只读材料，创建关联subject的辅助执行；存在新数据目的地时先取得相应上下文授权。
6. 复核报告绑定exact subject，解析并记录。冲突显示给人；机器FAIL仍FAIL，不通过多数投票/模型裁判翻成PASS。
7. 原合同要求人工时继续人工接受；当前候选或依据变化则旧review失效。收到建议修复后，走已有补充/合同修订及新候选流程，不能直接改冻结候选。

原生复核失败、缺失、超时、未知发送、资源未确认，都不能被当作no_findings。若复核被授权声明为必需，则阻断交付；若仅可选，则准确标未完成且由原流程决定是否允许用户继续，不能静默删除约定要求。

## 4. 证据失效规则

| 变化 | 路由建议 | 复核报告 |
| --- | --- | --- |
| profile/driver/native/model/config/policy变化 | 重验eligibility，旧历史按适用性废止或降为unknown | 保留原审计，不能声称新reviewer版本已测 |
| contract revision / scope /用户授权变化 | 旧建议拒绝或重新确认 | 旧subject不得应用于新合同 |
| candidateGeneration或artifactDigest变化 | 任务证据重新判断 | 直接失效，旧report不能接受新patch |
| 项目环境/check policy变化 | 当前配置与旧授权分开，不改在途执行 | 对新环境/新检查不继承旧报告 |
| 来源决定撤销、上下文授权撤销 | 停止未来复用；在途影响由原修订/停止流程处理 | 标明失效原因，必要时重新复核；不承诺消除既有外部影响 |
| unknown begin/answer/cancel或writer状态 | 不通过重新选择Agent绕过reconcile | 保留unknown，不制造完成/停止证明 |

## 5. 结果数据与冷启动

第一批只存必需事实：任务族/项目/合同与baseline、profile身份、候选/检查结果、用户接受/明确拒绝原因、修复轮次、墙上时间、可观测费用/unknown、所选建议及人工覆盖。

用户改目标、暂时环境失败、主观风格选择与Agent执行错误分开；不能把所有修改都记成负reward。人工接受也不是通用正确性标签，尤其是同一批数据既训练又评测时。InterventionRecord的schema存在不代表这些标签已经采集。

注册检查通过是证据的一部分，不是完整正确性标签。对候选内可改写的测试/package脚本、空测试集或覆盖不足单列说明；独立评测的验收检查与数据应在被测writer权限之外，不能把它自己改成PASS的测试当作路由收益。

先记录与shadow，不为缺少样本伪造质量概率。没有真实第二profile时不宣称routing uplift；不要仅凭被选中Agent的日志推断未选中Agent在同任务的反事实表现。后续如做学习/探索需独立预算、倾向/选择记录、预声明的比较和退出条件。

## 6. 实验与停止条件

至少保留四种对照：固定已准入Codex；确定性规则推荐；同Agent在相同预算下多一轮自查/修复；异构Agent只读复核。必要时再加随机合格选择以检查推荐是否有信息量。

固定任务材料、baseline、授权、机器检查和总token/费用/时间预算；使用独立隐藏测试或可复现缺陷，不让被测Agent修改评分标准。涵盖有缺陷和无缺陷候选，分别记录检出、漏报、误报、最终质量、返工、人时和费用；第二Agent换品牌不自动代表误差独立。

先做合成fixture/无模型错误用例，再为小规模真实试点提交明确任务预算。此RFC不增加B或E额度、不启动任何计费任务。样本量应由预期效应与可用预算决定，试点结果不能直接推广到所有仓库/语言/用户。

停止/不上线条件：出现越权、重复业务发送、旧候选被接受或假证据PASS立即阻断；同预算下无可复核收益则保持可选/实验，不默认加一次模型成本；证据缺失就报告unknown/NOT_TESTED。

## 7. 自动接受与竞速单列

自动完成只能在用户预先批准、可审计的窄策略和合同内讨论。原有required human不能由confidence替代；更不能把policy actor伪装为local_ui。即使没有human条款，当前应用入口也尚未实现无人触发的完成路径，需单独设计合法触发与审计。接受交付不等于合并/部署，撤销数据库标记不等于撤销外部副作用。

同合同竞速需要新的竞争候选权威、winner选择与接受CAS、loser取消和全部物理屏障、问题/答案隔离、超额预算及崩溃窗口证明。当前single-current binding/latest Assignment/current candidate与Work级屏障不能直接表达它。与只读复核分开RFC和验收，不能以“隔离已具备”略过这些变更。

## 8. 实施边界

现有A–E继续wave-04收尾。R1可先做main/C的只读类型与规则fixture；A只为首个真实消费者添加必要结果索引；B在关闭当前控制/预算阻断后交第二真实协议的最小能力；D保持发行整改；E独立设计上述反例与对照。

不引入LangGraph/AutoGen/RouteLLM作为第二执行权威。这些先例可用于设计与实验基线；驱动继续优先复用协议SDK/现有native harness，事实与生命周期留在当前产品。若某能力需要额外框架，先解释它替换了哪段真实复杂性，避免叠出第二份调度、状态和恢复机制。

下一生产变更须有稳定schema/事务归属/资源与预算时序、真实接口消费者和失败用例，再变更任务包或产品规格。当前提案不作这些能力已实现的声明。
