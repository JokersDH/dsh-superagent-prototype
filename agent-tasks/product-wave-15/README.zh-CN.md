# 第十五轮：实际入口和同一安装包的交付闭环

2026-11-12。保留原worktree/分支与所有差异，fetch合并最新origin/main。读[0043固定验收](../../docs/rfcs/WP-16/0043-wave-15-production-composition-and-admission.md)、[实际证据](../../reports/releases/wave15-admission/README.zh-CN.md)和自己的packet。

| Owner | 本轮完整出口 | 十阶段任务 |
| --- | --- | --- |
| A | 实际source预检与非空恢复数据 | [数据](agent-a-data.zh-CN.md) |
| B | 真实Application到独立Runner的控制恢复 | [运行时](agent-b-runtime.zh-CN.md) |
| C | 已接入产品的来源/候选数据与失效验证 | [来源](agent-c-context.zh-CN.md) |
| D | 真实产生完整身份、三态停止的当前个人包 | [交付](agent-d-delivery.zh-CN.md) |
| E | 实际动作/模式/完整subject约束的独立发行验证 | [验收](agent-e-acceptance.zh-CN.md) |
| main | 默认来源/候选/确认及恢复控制实际消费者 | [主线](main.zh-CN.md) |

## 本轮可直接使用的输入

main`697efdc`已接A reader与strict fact slice，实际runtime恢复inspect/prepare用同一SQLite快照和逻辑摘要。没有event的业务变化也使原预检失效，不完整源不能准备；新8项/组合66PASS，contracts228/storage87/workflows93/strict通过。见[0042](../../docs/rfcs/WP-16/0042-logical-source-preflight-checkpoint.md)。**prepare已实现，confirm/许可仍未实现**，A/E可立即测试前者，不能再把整个source消费者列为缺失。

A候选3121ec4自身87/105通过；B旧4与C旧6通过，C285/main组合11/strict通过。B13正常真实纵向范围保留，B14独立服务重连仅substrate：begin/answer实际计数0，不是业务恢复。D旧6返回PASS的UID分支有不可读前置，E旧5拒绝有空证据共同前置，本轮等价正负对照避免把这些当完整修复。

D新114b73c tar已包含M1及context/history/source/reply，不再下发“缺M1”旧任务。但生产journal字段缺失与signal后UNKNOWN仍P1；E仍未验收新tar，actual observed/mode/exit/fault/API/ABI关系仍需收口。普通M1安装不等恢复激活或研究，主线新预检字节不能被冒充已在旧tar。

## 工作方式

每个包按1–2、4–6、10阶段发布早期/中期/最终可运行source并push原origin分支；之后继续独立阶段，不等逐项用户回复。首个checkpoint必须是实际修复/调用，不是报告或第三套测试coordinator。缺外部入口仅对应项NT，提交一次最小RFC/复现后转独立队列；不无限轮询、不用重复PASS凑时长。

正负对照要达到同一目标分支：UID不可读不证明UID匹配规则，空evidence拒绝不证明foreign tuple拒绝，缺身份提前拒绝不证明signal后UNKNOWN。需要成功正对照、故障位置和具体失败原因；保留原报告，不反改历史PASS/NT。

## 责任和保留

原拥有路径不变：main管contracts/application/questions/coordinator/console/root config/lock/跨包集成；A唯一storage/workflows/迁移；B管execution/catalog/policy-preparation/driver-kit/testing/Runner/drivers/native-acceptance；C管context/proposals/knowledge/routing；D管launcher/distribution/portability；E仅product-acceptance断言。main先交实际消费者，不让其他人因其欠项整包空等。

真实模型/native0，旧B cap4 UNKNOWN不可花；E原pilot24turn/200000token/USD5/单在途仍BLOCKED，不reset/refund/补样本/研究价格。无新Driver/CAC/桌面/自动接受/第二ledger或生命周期。十一组5180/8796至5190/8806服务、全部state/tar/profile/账本保留；B旧report差异、C lock差异、E runs保留。

完整身份和停止后三态未证明之前，D/E禁止广泛live stop/install/cleanup矩阵；仅本次独立证明PID/start/UID/argv/root/operation资源可操作。共享probe输出用`PA_ADMISSION_REPORT=/tmp/pa-wave15-<role>.json`，不覆盖旧报告。新探针exit1是已记录负例，不要靠改断言消除。

[分别转发话术](forward-prompts.zh-CN.md)。`node agent-tasks/product-wave-15/verify.mjs`只检查派工/依赖/预算/链接，不授runtime/native/release准入。
