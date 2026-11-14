# 第二十五轮：八Agent完整产品交付长包

2026-11-14。本轮从A–E扩为A–H八位并行开发者，main继续负责主线集成。每人十六阶段、四个可运行结果里程碑，发布检查点后继续完整goal。验收见 [0065](../../docs/rfcs/WP-16/0065-wave-25-eight-agent-delivery.md)，实际共享输入见 [0064](../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md)。

## 本轮验收与可立即使用的输入

A的原subject/required集合/UoW/成本修复2/2通过；C实际A模块调用、独立reader、双恢复和工具9/9及准确0ede包真实只读启动/停止通过。A清单还没进入唯一consumer driver；C package缺launcher PID/API start仍误verified，source/包正向保持而该缺省gate仍待修。

B完整command tuple和大页clamp通过，已知引用的大payload可五块读回并核摘要。大首frame仍没有可发现的ref descriptor，新payload通道未绑定producer；真实回调重绑、双client、协调器崩溃恢复、恢复交付仍未完成。

D旧prerecord/child start/sibling/全null修复按scope通过，新3b包6748项、closure87/87和新UI静态字节通过；每次升级信号前fresh、child config/argv、mixedunknown仍需修。E准确0ede162required、223PASS/0FAIL/16NT和真实跨3b来源拒绝通过，旧capability/count修复关闭；opt-in HTTP成功观察仍有新P2。新3b/UI和本轮readiness不能借旧包认证。

main `fdb3f160b1d867f7167fb034d96a5c13bd16cdfb` 已交真实鉴权 `GET /v1/readiness`、共享schema和typed transport，供F/H直接消费；不是计划接口。实际Store/Node HTTP、鉴权、readonly、fixture/unknown、隐私、生成产物和旧HTTP回归通过，Runner wire不变。F/G/H产品本身尚未实现，不因工作树已创建算完成。

## 工作目录与职责

| Agent | 工作目录 | 固定分支 | 完整结果 |
| --- | --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-a` | `codex/g2-workspaces-verification` | 原清单直接进入同一次两格式同包恢复、原B结果持久与数据API |
| [B](agent-b-runtime.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-b` | `codex/g1-runtime` | 真正可重绑业务通道、SIGKILL后原问答、恢复交付与2/4资源 |
| [C](agent-c-context.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-c` | `codex/g3-assistant-context` | 完整package身份gate、实际A清单驱动的同包双恢复与工具交付 |
| [D](agent-d-delivery.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-d` | `codex/g3-local-distribution` | 精确fresh清理、准确新包、普通安装/升级/重开与支持 |
| [E](agent-e-acceptance.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-e` | `codex/g3-product-acceptance` | 真HTTP成功及同包UI/readiness/数据恢复的独立required结论 |
| [F](agent-f-experience.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-f` | `codex/g4-trial-experience` | 实际接入体验组件、日常用户journey、响应式/可访问性与用户指南 |
| [G](agent-g-insights.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-g` | `codex/g4-usage-insights` | 纯效率分析API、只读采集/CLI报告、可给F展示的可信summary |
| [H](agent-h-trial-operations.zh-CN.md) | `/Users/hh/Desktop/joker/superagent-agent-h` | `codex/g4-trial-operations` | 内部试用/迁移只读预检、脱敏诊断、有界运行与同事交接 |

F/G/H三个Git worktree已从上述main源码准备；A–E原树/分支保留。它们是同一仓库的独立工作树，不是另一个产品或复制的用户数据。开工时fetch并合并最新origin/main，读取本包；新Agent打开对应目录后发送 [八段完整话术](forward-prompts.zh-CN.md)。源/任务文件同步信息见 [workspaces.json](workspaces.json)。

## 四个共同交付出口

1. 阶段1–4：实际接口/组件/CLI及本轮关键边界可运行，发布早期source，让main和其他消费者立即接线。
2. 阶段5–8：真实现有数据和产品接口消费，发布中期source与最短端到端命令，准确标未达依赖。
3. 阶段9–12：同包/两格式/故障/用户journey或有界运行，实际原身份与失败证据齐全。
4. 阶段13–16：完整交付、文档、资源归还、必要回归和最终准确scope；wholegoal尚未实际完成就继续独立队列。

这些是四个完整结果，不是四次等人批准。每个阶段有实施和验收，发布后持续下一阶段。可以并行有限测试和独立开发，不能无限poll或把等待、文档/测试数当实现。H的600/1800秒场景报告实际时长，不能当48小时soak。

## 路径归属

A/B/C/D/E原owned paths不变。F只拥有 `apps/console/src/trial/`、`apps/console/test/trial/`、`apps/console/e2e/trial/`、`docs/user-guide/`、`reports/trial-experience/`。main对console的原广域所有权明确排除这三个新trial子树，保留App、transport、全局CSS、其他组件、配置及组合。

G只拥有 `packages/usage-insights/`、`tools/usage-insights/`、`reports/usage-insights/`。H只拥有 `tools/trial-kit/`、`tests/operational-soak/`、`docs/internal-trial/`、`reports/trial-operations/`。F/G/H不修改A SQL、B原通道、D生命周期、E assertions、共享contracts/root lock/HTTP/provider。新包manifest可在G自有package.json声明依赖，根锁/注册由main集成。

main负责真实消费者接线和早期源码准入；稳定组件/纯API/CLI先交，不等整包才合入。A→C数据链、G→F展示、D→E准确包和H→E原始观测分别明确。E始终独立判断required；H/G/F的成功标记不成为发布/执行权威。无第二ledger、SQLwriter、确认authority或执行生命周期。

## 固定边界

八位开发者与main的自动开发/验收真实vendor/model/native调用全部为0。B原cap4 UNKNOWN不可支出；E原pilot24turn/200000token/USD5/单在途保持BLOCKED，不reset/topup/refund/补样/新价格配方研究。新F/G/H没有追加模型额度，goal也不刷新额度。无新Driver/CAC/桌面壳/自动接受/动态Ticket DAG。

保留十二服务5180/8796至5191/8807、全部state/profile/tar/ledger、B旧report差异与b16、C lock、E历史runs和用户日志。只对独立证明本次probe出生的PID/start/UID/full argv/root/config/operation发信号，每次信号前fresh核验；unknown保留现场。无global socket扫描、其他credential或真实CLI回退。新工作树不复制原生profile/用户DB/密钥。

普通安装、接入体验和观测工具不等待B/private/target/BLOCKED实验；运行字节先准确freeze再E最终验，docs-only不重冻，旧0ede/3b/main和后续F/G/H产品scope分开。完成度不按人员、轮次或测试数上调。

`node agent-tasks/product-wave-25/verify.mjs` 检查九owner、144阶段、四里程碑、依赖/路径/预算/链接。`--workspaces`额外只读检查目录和固定分支。静态结果不授runtime/native/release准入。
