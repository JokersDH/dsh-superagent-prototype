# 第六轮：价值初筛与个人 Alpha 整包收口

日期：2026-11-11。派工基线：`ece95d1`。状态：可下发的执行计划，尚非本轮验收结果。本轮接续已有五个工作区和分支；wave-05修订01的价值前置、预算、密封副本、R0门槛全部保留。

先读 [共享边界0023](../../docs/rfcs/WP-16/0023-wave-06-alpha-and-value-boundaries.md)、[修订01](../product-wave-05/AMENDMENT-01.zh-CN.md) 和自己的完整任务包。旧wave-05的已测结果保留，但新执行顺序以本轮为准。不要重做已存在的存储、排序、发行或试点工具。

## 1. 本轮三个交付结果

1. B/E首先解除当前Codex独立复核试点的前置缺口；可以执行时在原grant内给出8例三组结果。不满足真实计费、会话、隔离或单turn上界时给出可核对的BLOCKED，不能将工具完成或零调用称为价值通过。
2. main/A/C把已有候选接成一套日常工作闭环：跨项目待办排序、精确来源、明确决定的确认/撤销、持久计时与重开。该结果不等待pilot或第二协议。
3. main/D/E收尾个人Alpha候选：同一来源安装物、新目录安装/诊断/备份/只读恢复、明确重新绑定与授权、升级回滚，以及独立准入矩阵。原生未测或恢复未通过时，准确保留阻断。

本包不开发新协议Driver，不实现自动接受、竞速、在线学习、桌面壳、CAC或远程多人服务。pilot promising只形成下一次小规模异构验证建议，不自动扩张本轮任务或预算。

## 2. 六个通道与原工作区

| 角色 | 原目录 | 原分支 | 整包任务 |
| --- | --- | --- | --- |
| A | `/Users/hh/Desktop/joker/superagent-agent-a` | `codex/g2-workspaces-verification` | [持久消费者、计时与迁移](agent-a-durable-consumers.zh-CN.md) |
| B | `/Users/hh/Desktop/joker/superagent-agent-b` | `codex/g1-runtime` | [现有Codex控制与有界试点运行](agent-b-pilot-runtime.zh-CN.md) |
| C | `/Users/hh/Desktop/joker/superagent-agent-c` | `codex/g3-assistant-context` | [共享排序与决定事务](agent-c-attention-decisions.zh-CN.md) |
| D | `/Users/hh/Desktop/joker/superagent-agent-d` | `codex/g3-local-distribution` | [个人Alpha发行与恢复消费](agent-d-alpha-distribution.zh-CN.md) |
| E | `/Users/hh/Desktop/joker/superagent-agent-e` | `codex/g3-product-acceptance` | [前置价值实测与独立准入](agent-e-value-and-release.zh-CN.md) |
| main | `/Users/hh/Desktop/joker/superagent` | `codex/g2-execution-integration` | [公共接口、候选准入与产品接线](main.zh-CN.md) |

代码归属不变：A唯一生产迁移；B拥有execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C拥有context/proposals/knowledge/routing；D拥有launcher/distribution/portability；E仅product-acceptance；main拥有contracts/application/questions/coordinator/console/root配置与锁、共享文档和跨模块集成。代理自己任务的证据写在自己拥有目录，不争写共享发布报告。

## 3. 已有输入与本轮消费

以下为派工时看到的提交/自报范围，尚非main本轮独立准入；报告中的依赖缺失要在新基线复核。

| 输入 | 已有内容 | 本轮工作 |
| --- | --- | --- |
| main `ece95d1` | attention接口/页面、原工作深链接、逐项审阅；206契约、43后端、18前端、22条分范围浏览器用例 | 消费C优先级与决定事务，集成A/B/D，完成恢复新授权 |
| A `99a192b` | v13证据仓储、ReviewTiming时间线；自报75 storage、21 workflow | 真实A/C/main消费者与接受事件投影、快照/迁移闭环 |
| B `6b4e4ab` | 精确ExecutionProfileRef resolver、现有控制回归、零模型协议调研 | 真实session/checkpoint、有界计费/停止与胶囊支持；旧原生缺口 |
| C `9a39908` | 决定事务/重放修复、纯attention/eligibility/review模块；自报真实SQL7/7 | 对齐共享AttentionRanker与未知值，消费A真实port与main命令 |
| D `809a957` | 自报36 portability、29 launcher、47步smoke，已测macOS arm64闭包 | 更新到同一集成来源，真实证据完整备份、恢复授权消费与E安装物 |
| E `34ff976` | 65条gate自测、8个冻结案例、试点预检 | 当前pricing_unavailable、0/24 turn；先解决前置，再价值报告和新源码独立验收 |

不要照搬旧报告里的“A持久实现不存在”“注意力未交付”“C旧三项仍失败”。按确切source commit区分：未集成、真实失败、未测、环境缺失。模块自报通过仍需main/E独立消费。

## 4. 大颗粒连续执行规则

每包有六个阶段。先完成自己的接口/兼容检查点并push原分支，再连续做后续阶段；无需每修一处等用户下发。检查点后附可运行recipe、真实证据范围与依赖请求，不能仅交导出类型。

遇外部依赖时记录最小复现、owner、所需输入和阻断的阶段，转到本包明确列出的独立项目。依赖到达后回到组合验收；不可用mock或私有实现替代生产依赖宣布通过。不要用无限轮询、重复截图或计费请求维持运行。

完成条件是：本包可独立执行的阶段全部完成；仍阻断的项目列出具体输入和下一消费步骤。先交checkpoint不是整包完成；只有“候选已交”也不是产品准入。

## 5. 开始与依赖顺序

所有人现在即可保留原修改，在自己的目录fetch并合并最新origin/main，读AGENTS、START-HERE、product-spec/README、本页、0023及专属文件。不要切别人分支或新建产品仓。

| 阶段 | 可立即开始 | 组合验收前置 |
| --- | --- | --- |
| A1/B1/C1/D1/E1 | 现有候选核对、共享接口消费、预检与负例 | 不需要等其他整包完成 |
| B2 + E2价值试点 | B先交零模型运行接口；E先核验冻结/价格/用量/身份 | B的可核对运行证明、main试点准入、E持久预留，三者缺一不发送 |
| A2/A3 + C2/C3 | 计时投影/纯排序/事务消费fixture | main先准入并发布A/C稳定源码，随后在真实A port组合验证 |
| main M2/M3 | 注意力/决定接线与恢复计划设计 | 对应A/C/B接口已准入，命令事务和失败负例通过 |
| D2/D3 + E4 | 当前发行物和安装负例可先做 | 使用同一冻结来源与真实artifact；恢复新授权等待main入口 |
| E3/E5/E6 + main M5 | 独立反例/发布gate可先准备 | 精确集成提交、安装物、必要原生证据与已完成case |

main逐段收货，不要求A–E完整包同时结束再集成。E价值实验优先；E与D的发行验证不等待新协议。新增路由/复核生产入口依旧默认关闭，pilot与个人Alpha分别验收。

## 6. 预算与现有服务

本轮不新增、转移或刷新任何grant。main/A/C/D为0真实模型任务，E除下述pilot外也为0。B仅可核对并使用原`wave03-b-native` grant剩余量关闭原控制缺口；limit4及所有used/reserved/unknown历史保留，不能拿旧摘要强行覆盖账本。

E仍仅用`wave05-independent-review-pilot-01`：24个原生turn启动、200000累计计费token、USD5任一先到即停，最多一个turn在途。它不是24次底层推理调用；历史输入/reasoning/cache等计费部分全部入账。B负责运行能力，E负责该grant预留与调用，main只读审核，不为联调另跑付费smoke。

价格不明、用量无法核对、单turn没有可保守预留上界、会话/隔离不成立、未知发送未核对时阻断。确认有实际依据后可在既有grant内执行，不需要逐样本审批；缺事实不是默认为获准，也不能自动补失败样本。试点冻结的两个时点见0023，存在歧义先对齐，禁止边看结果边改标准。

保留用户五组服务：5180/8796、5181/8797、5182/8798、5183/8799、5184/8800。所有测试用临时端口/新state/临时项目；不重置原生账号、升级全局runtime、修改用户Git项目或复制旧队列去自动执行。

## 7. 统一交接

每个阶段记录NOT_STARTED/IN_PROGRESS/PASS/FAIL/BLOCKED/NOT_TESTED，并说明是包内、受控、实际原生还是安装层。更新自己的wave06-status文件，不改别人的断言或历史证据。

交接必须有branch/base/source commit、拥有路径、接口checkpoint、实际命令/退出码、证据位置、真实/受控范围、预算reserved/used/unknown、剩余依赖owner、下一消费者recipe。发行物额外交artifactId/buildId/sha256/平台/运行时/ABI/依赖闭包。新共享schema和权威root lock仍只由main提交。

本轮的机器可核对排程为 [dispatch.json](dispatch.json)。这只是计划与候选快照，所有新阶段初始均为NOT_STARTED。

只读检查命令：`node agent-tasks/product-wave-06/verify.mjs`。它检查阶段、依赖环、代码归属、试点前置/预算及本地文档链接，不运行产品、安装依赖或启动模型，也不授予产品准入。

## 可复制的统一启动指令

```text
继续第六轮整包，沿用你当前的Agent角色、目录和分支，保留已有修改与全部预算账。
在自己的工作区fetch并合并最新origin/main，读取AGENTS.md、START-HERE.zh-CN.md、product-spec/README.md、agent-tasks/product-wave-06/README.zh-CN.md，以及角色表中你的专属任务和WP-16/0023。
先交稳定接口与可运行检查点，再连续完成专属包的六个阶段，不在第一个checkpoint或一次小修后停止。缺跨模块输入时留最小复现/owner并继续本包独立项目，依赖到达再做组合验收。
仅修改/提交拥有路径并push原分支；不改共享契约、根锁、其他Agent断言或用户服务。不刷新模型额度，不启动第二Driver或自动接受。
```
