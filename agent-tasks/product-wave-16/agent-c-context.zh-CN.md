# C：当前来源到候选确认的数据可靠性整包

继续`/Users/hh/Desktop/joker/superagent-agent-c`和`codex/g3-assistant-context`，只改context/proposals/knowledge/routing。保留root lock diff，先同步最新main。main65ac737/eb96c3e/104b7a0/1169535已实现实际factory、非空SDK建议和确认UI；旧53b1598缺入口说明已过时。模型/native0，不写SQL/HTTP/第二确认权威/私有LLM loop。

## C1 先消费真实当前入口

复用main`tests/integration/fixtures/assistant-candidate-model.mjs`或同等实际SDK本机mock，以原聊天产生非空artifact，再走实际候选GET与指针prepare。记录C factory调用、原reply/request/index/digest和完整reader。手工拼verified wrapper的既有测试保留scope，不能代替本阶段。

## C2 候选kind完整链

work/revision/decision分别经原ProductProposals/A事务确认与拒绝，明确检查requiredInputs、只读原payload、当前目标和原receipt重放。包含重复/混合有效无效suggestion及reply-only数据；读取/准备不得创建业务。阶段1–2交真实消费者早期checkpoint，不再以“main尚未接入”结束。

## C3 修改与陈旧来源

在结果持久化、候选读取、prepare、confirm之间改变原消息、artifact、模型身份、project/会话或目标合同。新确认拒绝，已记录原receipt可核对且不产生第二业务。权限缩小/撤销/到期以及当前范围outside suggestion不得被当前project授权洗白。

## C4 默认factory的实际覆盖

在main实际preview与selected-context send路径验证cutoff600、工作限定、外会话污染、published receipt与原fingerprint/final guard。现有6项可引用，仅对新增source组合/coverage变化补有意义用例；保留assistant内容与权限问答排除语义。

## C5 真实遗漏与公开诊断

修复或补齐实际公共投影中的omitted/suppressed/truncated/预算真值，嵌套POSIX/Windows/UNC根不可泄漏。无法验证的source显式partial而非sufficient。任何新projection须由当前main消费者映射，不引入另一个grant或自行放宽查询范围。

## C6 非空恢复后的候选与历史

消费A真实快照/恢复配方或当前公开API，第二根只读审阅原来源/候选和历史；current数据不可冒充frozen原文。恢复/跨根不继承执行许可，artifact缺失或scope变化安全拒绝。阶段3–6交中期实际consumer与main最小源码清单。

## C7 决定适用性与失效解释

在现有明确决定模型内核对supersession/revoke、范围和有效期，给实际context来源状态明确解释。已经撤销的新决定不能复活旧项，未来/过期项不能进入新消息；不新增自动学习推广、隐式确认或任意tool执行。

## C8 候选输入健壮性

保留已修unknown wrapper null/body/identity/principal反例，同时防御真正公共未知输入的getter/超大/坏数组等有界失败。typed内部路径与unknown公开入口边界分清，不让可伪造verifiedBy本身成为信任。main完整reader仍是前置，不用新helper逼main绕过原校验。

## C9 有界规模与调用成本

测新增实际consumer在600扫描边界、候选8项和长正文、omissions预算下的reader次数/bytes及真实partial状态。已有10000历史规模不机械重跑；只有复杂度改变再扩测，不读全库/所有artifact正文为一个候选预览服务。

## C10 最终集成配方

写`packages/context/reports/wave16-status.json`和当前main consumer map：哪些实际已调用、哪些module-only、哪些仍需main最小接线。交第三源码checkpoint，strict/exactOptional/build与必要四包回归，push原origin分支的owned paths。过时报告保留但顶部注明新基线，不将旧NOT_TESTED搬进当前阻断。

## 独立备选队列

- A新修复未到：用当前main的A18/SDK真实消费者测试，在新snapshot项注明版本，不伪造已修。
- main确认/target未到：照常完成当前候选、默认factory、scope/历史和诊断，不等激活。
- 需要HTTP/共享schema时提交最小consumer与需求给main，自己不越界写第二权威。
