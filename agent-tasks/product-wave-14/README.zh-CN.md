# 第十四轮：稳定内测的五个完整交付包

2026-11-12。保留原五个worktree/分支和所有差异，fetch并合并最新origin/main。先读[0041范围验收](../../docs/rfcs/WP-16/0041-wave-14-reviewed-inputs-and-product-exits.md)、[实际证据](../../reports/releases/wave14-admission/README.zh-CN.md)、本页和自己的packet。

| Owner | 完整出口 | 十阶段任务 |
| --- | --- | --- |
| A | 恢复准备与非空搬根的数据链 | [数据](agent-a-data.zh-CN.md) |
| B | 真实产品控制和独立Runner恢复 | [运行时](agent-b-runtime.zh-CN.md) |
| C | 默认来源审阅与候选完整数据 | [来源](agent-c-context.zh-CN.md) |
| D | 完整资源身份的当前个人安装 | [交付](agent-d-delivery.zh-CN.md) |
| E | 正确字节/动作/模式的独立发布gate | [验收](agent-e-acceptance.zh-CN.md) |
| main | 实际source/候选/授权产品消费者 | [主线](main.zh-CN.md) |

## 已完成与剩余

A旧4、B旧5、C旧6、D旧6个mock、E旧3分类均独立复验通过，不重复称旧问题未修。A87/100包回归通过；B真实正常产品纵向6PASS+1NT、helper68及strict通过；C四包276和当前main组合9通过。B恢复后控制、C默认factory实际替换仍欠缺。D新tar已有history/source/reply，尚不含main M1；E当前报告仍消费旧020af82，完整installed tier并未通过。

D新增完整身份/部分扫描/父目录角色P1，先mock闭合，禁止广泛真实stop/cleanup矩阵；E新增实质evidence与正确tuple绑定P1。B/C剩余新反例限其模块，不撤销main已测产品能力。具体source、文件位置、复现、artifact tuple和未运行项全部在0041与证据目录。

main1453cf2的M1讨论退化、history/source/reply已可供D普通personal打包，不等恢复激活或研究。A生产逻辑source reader已交，main必须承担真实baseline消费者，不能再次让A因“main入口没到”整包空等。C提供纯数据，main负责HTTP/候选UI、签名与最终同步guard。

## 连续执行方式

每人按阶段1–2、4–6、10交早/中/最终可运行source，push原origin分支后继续独立阶段。每包以一个完整产品出口为目标，旧未完成出口继续，不按轮次重置。外部依赖只将对应场景标NOT_TESTED/BLOCKED，交一次最小复现/RFC后切独立队列；不能无限轮询、用mock PASS覆盖缺的生产入口，或重复测试凑工作时长。

早期source交付内容：实际入口/导出、必要测试、精确scope和当前commit。中期必须有真实Store/进程/消费者组合；最终报告区分source、运行预览、installed、native、activation、value。全部checkpoint可运行，不以纯文档或空helper代替。

## 责任与保留

main：contracts/application/questions/coordinator/console/root config/lock及跨包集成；A：storage/workflows及唯一append-only迁移；B：execution/catalog/policy-preparation/driver-kit/testing/Runner/drivers/native-acceptance；C：context/proposals/knowledge/routing；D：launcher/distribution/portability；E：product-acceptance。不得交叉修改断言/生产拥有路径；共享变更走main最小RFC。

保留十一组服务5180/8796至5190/8806、原native profile、全部state/tar/预算。仅操作本次独立证明PID/start/UID/root/operation的资源；路径匹配、start相同、自洽record、部分ps失败均不是完整证明。共享探针必须指定`PA_ADMISSION_REPORT=/tmp/pa-wave14-<role>.json`，不覆盖历史。保留B两份report差异、C lock差异、E所有runs，不清理用户改动。

真实模型/native0。B旧cap4 UNKNOWN不可花；E原pilot24turn/200000token/USD5/单在途仍BLOCKED，无reset/refund/替换样本/新价格研究。普通安装不等激活或试点；无新Driver/CAC/桌面/自动接受/第二ledger/生命周期。

[分别转发话术](forward-prompts.zh-CN.md)。静态检查`node agent-tasks/product-wave-14/verify.mjs`只核对派工结构，不授runtime/native/release准入。
