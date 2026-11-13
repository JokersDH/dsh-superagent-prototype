# 第二十三轮：可靠重接与同包内部试用

2026-11-13。本轮承接 wave22 的实际验收，见 [0061](../../docs/rfcs/WP-16/0061-wave-23-admission-and-end-to-end-packages.md) 和 [验收报告](../../reports/releases/wave23-admission/README.zh-CN.md)。原 A–E 工作树、分支、所有历史证据与预算保持，不另开产品仓库。

## 当前事实

主线已在 `8c8fdefa12ff04d524eec8424efe3a90bc09a6fd` 接入完整 launcher/portability 与构建运行闭包，含 `pnpm pa`、`pnpm build:distribution`、`pnpm check:distribution`。112 项模块测试、strict/build、15 个运行包与静态 console 构建通过，干净源码 stage 自校验成功，见 [0060](../../docs/rfcs/WP-16/0060-main-ordinary-distribution-source-integration.md)。这不是 E 对新 main 安装包的最终结论。

A 的持久事实与 C 的实际双格式标准启动、可选来源诊断通过。A 尚缺独立新 Node 进程读取；C 新 driver 的结果断言、服务身份和请求超时待补。

B 有真正新业务通道源码，不能再称只有旧控制 wrapper；strict 与旧控制通过。但原交接测试仍失败，facts 身份/分页与 receipt、payload、Broker 重新连接尚未闭合，新通道不合入默认产品。

D 的 a9b 安装包 6747 项字节验证通过，E 尚未对该包最终验收。E 对准确595包记录200 PASS/0 FAIL/15 NOT_TESTED，保留普通安装与只读审阅的测得范围；新的 required gate 缺失观测仍放行，需要纠正。D 新 live 测试脚本异常清理及原 Broker/双版本真实恢复证据仍欠。

## 三个可运行结果

| Owner | 第一里程碑 | 中期里程碑 | 最终里程碑 |
| --- | --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 新进程读取原身份持久事实和数据清单 | 获准 B 的原结果落库；未到则继续同数据生产器 | 两版本恢复与同包原数据完整读回 |
| [B](agent-b-runtime.zh-CN.md) | 身份绑定、有界回放、真正双客户端交接 | SIGKILL 后同 Store、原问题继续回答 | 恢复验证、候选、人工接受与并行资源归还 |
| [C](agent-c-context.zh-CN.md) | 有明确断言、身份与期限的单一 driver | 源码/安装包两种明确入口、无回退 | 同 Store 双版本审阅和准确界面输入 |
| [D](agent-d-delivery.zh-CN.md) | 异常清理、准确闭包和可发现 CLI | 新 main 字节同包恢复与冻结 | 升级、重开、支持材料和稳定内部安装包 |
| [E](agent-e-acceptance.zh-CN.md) | 完整报告正对照与缺失/矛盾必拒 | 准确新包同消费者核心用户流程 | 分层 required 结论及有界可用性 |
| [main](main.zh-CN.md) | 已交普通发行源码和干净 stage | 来源范围界面与合格 attach 消费 | 原授权链、安装与恢复的交叉验收 |

## 持续执行规则

每人建立或沿用覆盖整个结果包的 goal，不设 token 预算；十阶段、早/中/最终三个可运行 source checkpoint。提交后继续独立阶段。不要把 partial、原始观测、inspect/cancel、字节生成或短测试标记为整个 goal 完成。

外部输入未到只标对应项 NOT_REACHED，并执行任务包的独立备选队列。缺共享契约交最小 RFC 与真实调用样例；不得新增另一套 ledger、执行生命周期、确认权威或仅为旧 probe 存在的空方法。统一用 C 的一个参数化 consumer driver，A 提供 producer/reader 数据，D 包含实际运行入口，E 保持独立断言。

main 拥有根 contracts/config/lock/HTTP/provider/UI 和集成；A 拥有 storage/workflows 与唯一 append-only 迁移；B 原 execution/driver/runner/native-acceptance；C context/proposals/knowledge/routing；D launcher/portability/distribution；E product-acceptance。保留原分支，显式拥有路径提交并推 origin，绝不推 upstream。main 已发布源码，不等待 E 最终结论才给 D 构建。

## 验收与资源

所有阶段真实 vendor/model/native 调用为0。B 历史 cap4 的 UNKNOWN 不可支出；E 原24 turn/200000 token/USD5/单在途 pilot 保持 BLOCKED，不 reset/top-up/退款/补样/价格配方研究。goal 不改额度。不接新 Driver/CAC/桌面壳/自动接受/动态 Ticket DAG。

保留十二组5180/8796至5191/8807及所有 state、profile、tar、账本、B旧diff/untracked、C lock、E旧runs、用户日志。只能对独立证明为 probe 出生的 PID/start/UID/root/config/operation 资源发信号；未知资源保留现场，不按端口、共享安装或路径前缀归属。禁止全局 socket 扫描和读取其他 credential。每个请求及流程均有期限，失败清理不得先删仍活跃或未知 state。

普通安装/只读审阅不等待业务重接、私有许可、目标激活或 BLOCKED 实验。运行字节有变化先 freeze，再 E 最终同包验；docs-only 不重冻。精确595、a9b和新main三个 subject 分开，源码、安装、native、value 分层。完成度不按轮次、测试数或静态 PASS 上调。

分别转发 [五段话术](forward-prompts.zh-CN.md)。静态检查 `node agent-tasks/product-wave-23/verify.mjs` 不启动 runtime、不授 release/native 准入。
