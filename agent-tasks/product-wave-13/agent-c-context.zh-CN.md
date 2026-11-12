# C：可替换的完整来源与候选数据链

原superagent-agent-c/codex/g3-assistant-context，仅四owned包。保留root lock差异不提交，合并当前main，读README/0039。旧8+17及四包269通过保留；main历史/来源UI已交，模型/native0。

## C1 先关闭授权和Composer完整性

probe-wave13-context前3例：缺trusted Scope不能选择私有decision；Composer必须按grant.scope过滤decision正文；scoped adapter complete=false不能在Composer/manifest变成complete/unchanged。授权/coverage必须贯穿真实链，不只改selector。先交可运行source，让main开始替换消费者。

## C2 保持来源证明与主线兼容

project/conversation/work/role/provenance/question anchors/cutoff保持；source metadata与Scope不丢失，provider扫描不完整有明确传播。若旧interface缺字段，先给main最小RFC和调用点；不移除main外层Scope过滤、600条截止/最终同步assertCurrent，不改HTTP/SQL。

## C3 完整回复绑定

历史投影不能仅凭source/project/conversation附加foreign principal/request/reply/model/artifact。通过main CompletedAssistantReplies.read的完整核对body和原request接入，或要求准确的受信读取port；缺必要身份就unverified，不造第二授权器或verified=true自证。

## C4 所有输出分支有界且默认脱敏

关闭5000 omissions/365KB和omission.detail路径反例。定义items、omissions、diagnostic bytes与固定protocol开销各自上限，不能只限制excerpt；超预算准确suppressed。path/detail/reason及嵌套字段统一公开策略，不回声host私有路径或凭据。

## C5 完整候选数据

保持已通过的整body project/conversation/source绑定，ReasonerProposal逐项有效与缺输入规划；foreign revision、过期Scope、撤回决定、来源缺失需准确拒绝。只能交待明确确认的数据，不补actor/profile/check或自动执行。

## C6 真实A18与当前main组合

用当前main e1e0c97及后续实际history/source/reply入口，不用Map fallback；新factories必须实际被调用，提供call counts/来源ID/coverage证明。旧main私有路径9/9仅保留为回归，不能计作新adapter已接。阶段3–6交第二个source。

## C7 实际替换recipe和准入

交main精确provider factory、Scope/cutoff/published artifact映射及guard契约。main发布组合入口后测试新factory在真实HTTP中被调用，前后允许内容一致、原文/摘要变化同步拒绝。没有读取SSE就不宣称SSE准入；缺此入口仅标组合NOT_TESTED。

## C8 确定性质量与规模

固定中英文、多项目/多会话/重复/长内容的相关项与污染项基线；5000/10000项扫描与分页，测query/bytes/tokens/时间上限和遗漏原因。真实身份负例优先于正常路径PASS；不把fixture检索指标称模型价值收益。

## C9 失效与历史一致性

撤销/替代、Scope缩小、合同新版本、源删除/字节变化、page中间新增；原始历史与当前有效输入分开。主线保存的原bundle不因重新检索变成新内容，也不因历史可读重发模型。

## C10 完整交接

四包typecheck/build/test、新旧probe、当前main组合，维护packages/context/reports/wave13-status.json。consumer map标明真的调用方，删除旧“history未发布/A work未修”泛化阻断但保留旧报告scope。只push原分支。

## 独立备选队列

- 授权、Composer coverage、回复身份、遗漏预算与脱敏不依赖UI。
- 当前main已有真实A18/history/source，组合读验不等target激活。
- main新adapter/候选入口未到，继续owned数据链与规模，交精确RFC不循环等。
