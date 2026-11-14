# 第二十七轮：十路完整能力包

2026-11-14。按正常节奏推进，不设当日完成期限，不为加速删减范围或验收门槛。A–H 保留原目录/分支，新增 I/J 两个独立工作树，main 继续集成。每位 owner 连续完成 20 阶段，在 4/8/12/16/20 发布五个完整可运行结果；检查点是交接点，提交后继续整包。goal 覆盖整个结果，不设 token 预算。

阅读 [0068 实施输入](../../docs/rfcs/WP-16/0068-coordinator-channel-and-project-recipe-inputs.md)、[0069 派工与门槛](../../docs/rfcs/WP-16/0069-wave-27-ten-agent-continuation.md)、[本轮验收](../../reports/releases/wave27-admission/README.zh-CN.md) 和自己的任务包。分别转发 [十段开工话术](forward-prompts.zh-CN.md)，准确目录/分支见 [workspaces.json](workspaces.json)。这里只准备开发工作树，没有代发外部聊天。

## 已确认的实际进展

- D/E 已对齐同一个 ce64 包：6754 项字节核对、96/96 源码闭包、164 项 required ordinary installed 通过，238 PASS/0 FAIL/16 NOT_TESTED。包内真实 F App、readiness 和四原动作有浏览器证据。旧“E 仍只测 3b/a826、F 只是独立演示”的结论已过时。
- A 新 Node/strict 和合法消息 drift 拒绝已关；C 同一 manifest 驱动 v1/v2 实际恢复、准确包启动/读取/STOPPED 及 drift 拒绝已过。新 artifact inventory 可缩小、未知 conversation_search 前缀表漏摘要、整 event_log 宽豁免仍待闭合；这些是新数据核验范围，不是已证明主线权限绕过。
- B 的 135540 字节五块读取已修，但 160 条小日志累计页预算回归，独立 10/11。真实三 callback 重绑、同 Runner 双客户端、SIGKILL 后原问题到交付仍未实现。
- F 新身份/hook 修复已由 main `967dc0c677333ec307c215c0ed67e838b5487d92` 接入：13 项纯/传输、8 项干净 source 实际 App 浏览器、strict/build 通过。main 另发 CoordinatorChannel 小接口与五项校验，contracts 237/237，冻结 Runner hash 不变。模块实现仍待 I，实际接入仍待 B。
- G 原七反例与真实两项目受控 Q/A/accept/ReviewTiming 采集已过；还需嵌套总上限和冲突映射永久隔离，main 未接默认指标。H 四旧问题与 recovery fixture 定点 7/7 通过，原 600/1800 秒记录保留，实际业务恢复仍 NOT_REACHED。
- E 新 browser 清理 helper 的 substring force-kill 是测试工具 P1，先修再 live rerun；已有 ce64 实际普通安装观察保留，不要求为测试修复重冻 runtime。

## 十路五个完整结果

| Owner | 4 阶段 | 8 阶段 | 12 阶段 | 16 阶段 | 20 阶段 |
| --- | --- | --- | --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | artifact 完整闭包 | 可信 target proof | 同包双格式正负 | 原结果与故障 | 数据 API 完整交接 |
| [B](agent-b-runtime.zh-CN.md) | 完整回放与 Channel 接入 | 原进程双客户端 | SIGKILL 原身份恢复 | 原交付与资源闭合 | 完整运行时交接 |
| [C](agent-c-context.zh-CN.md) | 精确允许变换 | 同包双格式内容链 | 当前产品包全链 | 有界故障 consumer | 可复用数据链交接 |
| [D](agent-d-delivery.zh-CN.md) | 精确内容 proof 消费 | 双格式安装包整链 | 稳定组件同包候选 | 安装升级重开 | 完整发行与支持 |
| [E](agent-e-acceptance.zh-CN.md) | 安全 browser 工具 | 精确恢复与 drift 验收 | 合格受控链与字段 | 同包有限安装观测 | 独立分层结论 |
| [F](agent-f-experience.zh-CN.md) | 身份稳定真实入口 | 两项目日常闭环 | 项目草稿预览 | 可信数据/移动键盘 | 完整用户体验交接 |
| [G](agent-g-insights.zh-CN.md) | 可信输入到 consumer | Node 只读采集 | 两项目实际呈现 | 日常观测工具 | 可信数据完整交接 |
| [H](agent-h-trial-operations.zh-CN.md) | 合法三 consumer 输入 | 私有协议故障包 | 同 Runner 恢复支援 | 真实只读观察诊断 | 运维与同事交接 |
| [I](agent-i-coordinator-channel.zh-CN.md) | 三回调具体模块 | 同 controller 双客户端 | B 去旧管道接入 | 故障/容量/strict | 实际消费者完整交接 |
| [J](agent-j-project-recipes.zh-CN.md) | typed pure catalog | 只读 facts CLI | 可用预览草稿 | 多项目工具 | 现有确认链完整交接 |

main 的 [20 阶段](main.zh-CN.md)覆盖实际 App、G Node/API/F 映射、J 草稿/原确认、I/B 实际业务恢复与当前包接线。新增人员用于建设具体模块；现有 A/C/D/E/H 验收链不再复制一套。

## 依赖和持续执行

I 先交共享接口的具体实现给 B/H，B 负责删除原三 waiter maps、合入原服务。B 不等 I 整包才修合法分页/统一 dispatch，I 不等 B 整包才做双 client/真实 sink/故障。H 在自己目录复用原 Product/Broker/A/Driver fixture，未到实际 B port 的阶段明确 NOT_REACHED。

J 先交纯 matcher/schema，再交有界只读项目 facts/CLI 和已有 CheckRegistry 的草稿引用。main/F 用原委托表单与明确确认接入；未知保持 needs_input/unsupported，清单脚本不自动变可执行命令。G 分析在 Node 侧，F 只收经 main 明确映射的 scope/window/coverage DTO，不能浏览器 import Node crypto 分析包。

source 早发布，依赖只阻对应结果；缺外部项转每包独立备选队列，有限观察，不无限轮询。禁止只提交局部小修就宣称整包完成，也不以测试数或 220 阶段代替功能。普通日常体验、模板、观测、安装独立于 B 业务恢复/private/target/blocked study。冻结运行字节先于 E 最终 installed verdict，docs/test-only 不重冻。

## 所有权与环境

main 保留 root/contracts/config/lock/HTTP/provider/App/transport/全局 CSS 和授权；main 的 console 明确排除 F 独占 trial 三子树。B apps/runner 明确排除 I 独占 attach-channel src/test 两子树。A 唯一写生产迁移，E 唯一写 product-acceptance assertions，J 只有 project-recipes 四路径，其他原 ownership 继续。机器检查见 [dispatch.json](dispatch.json)。

I `/Users/hh/Desktop/joker/superagent-agent-i`、`codex/g5-coordinator-channel`；J `/Users/hh/Desktop/joker/superagent-agent-j`、`codex/g5-project-recipes`，都从 main967dc0c 准备，不复制 state/profile/untracked。A–H 保留旧 dirty 并自行 fetch/merge origin/main；不 reset、不改别人分支、不 push upstream。

保留十二服务 5180/8796 至 5191/8807 和全部数据/profile/tar/ledger/B 两旧 report+b16/C lock/E runs/用户日志。仅精确自生 PID/start/UID/fullargv/root/config/operation，且每次信号前 fresh 核对；unknown 保留，不 global discovery、substring kill 或借他人凭据。

所有自动真实 vendor/model/native=0。B 旧 cap4 UNKNOWN 不可花，E 原 pilot24turn/200000token/USD5/单在途 BLOCKED，无 reset/topup/refund/补样/新价格配方研究。J 项目声明不属于模型配方研究。无新 Driver/CAC/桌面/autoaccept/动态 DAG/第二生命周期。

`node agent-tasks/product-wave-27/verify.mjs` 检查任务结构/预算/ownership/依赖/准确 evidence；`--workspaces` 只读核对十一个目录/分支。静态 PASS 不是 runtime/native/release 准入。69/100 与完整方案 50.8% 仍是历史冻结估计，本轮不按人力或阶段数调高。
