# 第十三轮：稳定内测出口收口

2026-11-12。先保留改动，fetch并合并最新origin/main，继续原五个worktree/分支。读[0039固定验收](../../docs/rfcs/WP-16/0039-wave-13-admission-and-alpha-closure.md)、[完成度依据](../../docs/roadmap/progress-2026-11-12.zh-CN.md)、本页和自己的packet。

本轮每人只有一个完整子系统出口，按十个连续阶段实现，早/中/最终三次可运行source；交检查点后继续独立队列，不等逐项用户回复。上一轮未闭合的生产出口继续执行，不因轮次重置预算或改称已完成。

| Owner | 完整出口 | 任务 |
| --- | --- | --- |
| A | 可用于实际恢复baseline的源证据与非空持久数据 | [数据完整性](agent-a-data.zh-CN.md) |
| B | 真正经过产品命令/队列/Runner的控制与恢复 | [生产控制](agent-b-runtime.zh-CN.md) |
| C | 可替换main适配器的完整来源/候选数据链 | [来源数据](agent-c-context.zh-CN.md) |
| D | 有准确所有权证明的当前个人安装与升级 | [个人交付](agent-d-delivery.zh-CN.md) |
| E | 真正约束当前字节发布的独立验收 | [发布验收](agent-e-acceptance.zh-CN.md) |
| main | 明确启动退化、真实产品消费者和授权集成 | [主线](main.zh-CN.md) |

## 稳定输入和准入

主线M1已在`d9d347e/b2b1adb`交付实际无执行器启动：[0040](../../docs/rfcs/WP-16/0040-personal-discussion-readiness.md)。`pnpm start`在预期Codex准入失败时进入个人对话，`--discussion-only`可明确禁执行，保留原任务/队列/unknown writer，后端拒绝任务控制且不默切fixture。新增5190/8806仅对话预览使用独立state。D/E可直接消费固定source`b2b1adb`继续普通personal安装/准确字节验收；无需等源恢复授权或研究。384项分范围非浏览器、6项新网页及原17项网页回归通过；不代表安装/原生控制/目标激活准入。原完成度快照不因此自动加分。

当前main e1e0c97已经提供A18持久回复、真实产品进程恢复、上下文history/source HTTP/UI、原请求核对和签名cursor。预览5189/8805可用，505项非浏览器/17网页为此前限定证据。不能继续以“历史入口没发布”为整包阻断。

本轮固定A d42a6e9、B9ec6027、C667bf74、D0ac2b58、E90baa01。旧反例分别A4/B3/C8及旧17/D6通过；新反例A3、B5、C6、D6个mock+1个legacy、E3个必测分类仍失败。候选缺口没有撤销main现用私有guard和已测能力；不把包内测试或自造receipt当生产命令执行。

首期稳定内测工程估计约70%，完整B约50%，不是release PASS。硬阻断是进程所有权、真实活动任务恢复、当前personal安装和独立发布gate。普通安装不等恢复激活/研究；先冻结真正字节，再由E作最终验收。新Driver/CAC/桌面/自动接受不扩。

## 连续工作和边界

阶段1–2交首个**实际生产消费者**或安全修复checkpoint；阶段4–6交第二个组合source；最终交十阶段结果。文档或工具函数存在不算这些出口。外部依赖仅阻断对应消费者，交最小RFC/复现后转独立队列；不能无限轮询、空跑计时或重复已过测试凑时长。

原拥有路径不变：main为contracts/application/questions/coordinator/console、root config/lock和共享集成文档；A唯一storage/workflows/迁移；B为execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C为context/proposals/knowledge/routing；D为launcher/distribution/portability；E仅product-acceptance。只提交explicit owned paths、push原origin分支，不推upstream。

共享probe在候选worktree运行时统一用`PA_ADMISSION_REPORT=/tmp/pa-wave13-<role>.json`，不提交或覆盖main历史报告。主线旧wave11 context探针现已支持该变量；其历史测试数量/行号已经明确标为historical，不能作本轮包回归证据。

自动模型/native turn0。B旧cap4 UNKNOWN不可花；E原24turn/200000token/USD5/单在途pilot仍BLOCKED，不清账/退unknown/补样本或研究新价格。所有测试用受控协议/本地mock，不启动厂商模型任务。

保留原十组服务5180/8796至5189/8805及新增5190/8806、全部数据/旧tar/账本/账号。只停止本次已证明自有PID/start/root/operation资源；path匹配、自洽JSON、缺失start、扫描失败、pidReused都不能变成可停止/空集合证明。D危险分支先mock闭合，再跑新鲜自有进程矩阵；不pkill/全局清队列。

[分别转发话术](forward-prompts.zh-CN.md)。静态检查：`node agent-tasks/product-wave-13/verify.mjs`，不颁发runtime/native/release准入。
