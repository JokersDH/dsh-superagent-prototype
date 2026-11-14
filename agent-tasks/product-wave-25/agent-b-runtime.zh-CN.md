# B：原业务重接、恢复交付与消费者兼容整包

2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、原分支 `codex/g1-runtime`，保留全部改动后同步最新 `origin/main`，记录实际 SHA。
先读根 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0064](../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md)、[0065](../../docs/rfcs/WP-16/0065-wave-25-eight-agent-delivery.md) 和本包。
原拥有路径不变：`packages/execution/`、`packages/catalog/`、`packages/policy-preparation/`、`packages/driver-kit/`、`packages/testing/`、`packages/drivers/`、`apps/runner/`、`tests/native-acceptance/`。
保留两个旧 runtime report 差异、未跟踪 `b16-real-begin.mjs`、所有账本与历史证据；不编辑 main contracts/HTTP/UI/root lock、A SQL 迁移或 E 断言。
本轮外部 A–H 八人加 main 并行，新增 F/G/H 不取得 B 运行时所有权；通过实际 port、fixture 和精确证据协作，不并发修改同一源码。

固定输入 `4af2a3eb6cb84195a8f7f774b0c836f2cfc4b1ee`：完整 assignment/attempt/contract 拒写已经通过；131072 请求可按 48KB inline 上限返回；已知 ref 的 135540 字节 payload 分五块还原并核对摘要通过。
旧 page producer、foreign source 拒绝、小页 160/10 页、control/strict/normal 已验范围保留，不再重派已关闭的小修。源码已经是真业务通道，不称 wrapper-only。
仍欠大记录可发现 descriptor、每个 payload chunk 的 producer/ref/range 绑定、正确字节单位，以及实际统一 dispatch/receipt/payload/native-admission 重绑和真正双客户端。
建立或沿用覆盖整个结果包的 goal，不设 token 预算。16 阶段，B4/B8/B12/B16 四个完整可运行结果，发布后继续后续独立阶段，不在 helper、PARTIAL 或检查点停工。

## B1 早交实际 port 与准确 RFC

同步 main/A 的原登记/current binding、commands/dispatch/observations、payload、question/answer 和收据读取配方，列清原事实来源与持久所有权。
在 B 拥有目录发布与现有 RFC 对齐的接口说明和可调用类型，给 main 实际连接、fact descriptor、chunk、ACK、payload 请求、native-write admission、断开/重接的最小 consumer；共享 docs 的修改建议交 main。
early port 必须来自本次真实实现，不只发布描述符或可编译空方法；共享 contract 需要变化时交最小实际调用/RFC，由 main 决定。
纠正 RFC 中 feed 就证明 begin-once、pending intent exactly-once 等超前保证；分别写已测事实、必要前提和未实现范围。
已存在的 chunk reader 与尚未实现的原 payload 请求重绑是不同能力，不混写；主线普通发行/UI/readiness 与 B 恢复独立。
验收：真实方法与 consumer strict/exactOptional 通过，main 能在准确 source 上调用；早交后继续 B2–B4，不把 RFC 算首个完整结果。

## B2 descriptor 到 payload 的完整可读链

大 frame 不再硬塞进第一页：实际 pager 返回带原 seq/fact identity/payloadRef/byteLength/digest 的有界 descriptor，调用者可发现并继续原序列。
把 payload 方法接到实际 attach consumer，每个 chunk 绑定完整 registered producer/source/attempt、原 descriptor、请求 ref/offset/length，校验后才暴露 bytes。
返回正确的 decoded byte count/nextOffset；1024 字节不得报成 1368 个 base64 字符。对 total/range/digest/base64 与最终短块做严格验证。
保持 server 强约束 inline/chunk 和总 serialized envelope 上限，计入身份、数组分隔及 metadata；不得只抬全局 cap 或静默截断。
用真实 schema-valid journal、大单 writer.observed、多页及中断续读证明：descriptor 发现、分块、摘要、原 fact 入库、receipt 后 cursor 推进为一条链。
验收：原完整 tuple 与已知 ref 正对照保留；foreign producer/ref/range、坏 digest、空进展、非法预算、重放冲突在原数据暴露/写入前拒绝。

## B3 单 dispatch 与三类实际重绑

将 stdio 与 endpoint 业务命令收敛到同一个实际 dispatch path，保留 begin-once、prepared policy、launch、完整身份、容量、控制优先级和 receiver 观察。
实现 fact sink/receipt ACK、不可变 payload 请求响应、native-write intent/admission 的断开重绑；旧 stdio waiter 不能在交接后继续掌握回执和批准。
原生写入时调用 main/Broker 当前 guard，核对原 native request/target/版本；send 预检不是原生许可，历史批准不能转换用途。
实现 client/session 关闭、waiter 取消、替换连接、过期回调拒绝与背压；no-op close 不能作为 client A 已退出的证据。
接原 A ingress 和不可变 payload Store，不新增第二 ledger、receipt-only coordinator、执行生命周期或私有 SQL。
验收：三类往返各有断开前/后正对照、有限故障窗和真实结果计数；unknown 保留，入队 ACK 不称 native_applied。

## B4 真双客户端与第一结果

真实 product Driver/协议接私有受控 fake，使原 Work 达到 begin/question；`/usr/bin/false` 的启动失败不能再作为正常业务证据。
client A 真断开，client B 接原登记的同 Runner、同 child，读取原 descriptor/payload、接手原问题及实际回执和 native-admission。
记录两客户端生命周期、Runner/child PID/start/UID/root/config/operation 和原 session/request/command/attempt/contract/epoch，不另起 child 或换 ID。
修正 B22/B23 非法 fixture、错误 endpoint 字段、无实际 backend 计数和无关 localhost 请求；使用现有合法 fact/payload builder，不归因缺 A 表。
第一结果是 B1–B4 的运行源码/RFC/实际 consumer 与同一条交接链，加上身份、字节、回执和 guard 正负证据；重放或 helper 单项通过不足以完成。
发布第一个可运行 source checkpoint 后继续 B5；精准记录未达项，整包 goal 保持未完成，不能要求用户再派一次同一里程碑。

## B5 原业务事实与恢复准备

使用 A 现有公共端口读取原登记/current binding、commands intent、dispatch/native observation、question/answer/receipt 和不可变 payload。
区分 not_seen、intent_recorded、observed/result、unknown；commands.has、无回执和自己 send 标记都不单独证明对方收到或未收到。
恢复准备固定原 Ticket/Assignment/attempt/contract/epoch、native session/request 与当前 guard，不从旧配置或 source receipt 派生新执行权。
把本次实际 endpoint/资源/数据来源交给 main consumer，避免只依赖 B 自己构造的假当前状态；不全局扫描 socket、猜目录或尝试其他 credential。
只影响恢复副作用所必需的入口，普通发行、只读恢复、readiness 和用户现有服务独立运行。
验收：独立读取原事实/身份快照和明确恢复条件；缺数据保持 unknown/拒绝，不以空 ledger 或新 attempt 代替原身份。

## B6 独立协调器 SIGKILL 与重开

在私有独立进程运行原 coordinator，真实持久使用同 A Store；注入正常退出和 SIGKILL，独立确认原 coordinator PID 已结束。
新 Node 进程从原登记和业务事实重连仍存活的同 Runner/child，不能把同进程重开 Store 或两个不相干 demo 叫跨进程恢复。
重连前后核对完整资源与当前 host/profile/policy/版本；旧 client callback 和迟到回执不得获得新连接写权。
每个故障窗有正常对照、原 PID/start/完整 argv、原 command/attempt/session、接收端观察和最终状态，所有等待有 deadline。
只能信号独立确认本次 probe 出生且完整身份一致的进程；unknown 不猜、不删除 state、标记或旧资源。
验收：真正新 coordinator 读原 A 并接同 Runner/child，原事实继续入库；尚无实际原问题回答时准确保留下一阶段未达。

## B7 原问题与原生写入结果

重建原 Broker question/version/target、native binding/request 和 answer，逐请求保持原批准语义，不因文本相同复用另一 request 的批准。
在真实 native-write intent 时调用 main 当前 before-write guard；过期 epoch/合同/问题不能因重接成功或历史 approval 而恢复权限。
原允许回答达到实际 native_applied；无法判定时保留 indeterminate，不把 pre-admission、response_written、普通 ACK 或 receipt 存在称原生已应用。
记录实际 receiver/native effect 与 A 持久事实，维持原 command id/body 和不可变 payload；重放原 receipt 不重复回答或重复测量。
缺 main HTTP consumer 时先交真实 private consumer 和实际 port，不造第三 coordinator 或直接写数据库使例子通过。
验收：原问题一次正确回答、拒写与未知路径独立可测；新 coordinator 和原 native/request/session 身份在证据中闭合。

## B8 ACK 窗口与第二结果

begin/answer 覆盖写前、receiver 接收后 ACK 前、ACK 后 fact receipt 前、receipt 持久后等有限窗口，使用真实接收端与 A facts 交叉判断。
已接收/完成的原命令不重发，unknown 不换 command/attempt/session/request ID 补发，不退款、reset ledger 或创建替代任务。
相同 body/原 ID 重放返回原结果，冲突 body 拒绝；修正先重复 send 再测试另一个 ID 的假 no-resend 断言。
验证两 client 并发提交、迟到 ACK、重连期重复 fact/payload 和 receipt 超时，保留原 writer barrier 和未知状态。
第二结果必须是 B5–B8 同一条原业务链：SIGKILL、新进程同 A 原身份回答、窗口下实际写入/回执/幂等行为，不是四份孤立报告。
发布中期可运行源码/消费者与有限故障证据后继续 B9；外部输入未到只阻相应步骤，继续独立队列。

## B9 恢复原 Work 的验证与候选

让原 Work/Ticket/Assignment 在恢复后继续真实产物，走已有 registered verifier/check、artifact、current candidate 与 completion gate。
候选绑定原 contract/attempt/环境/检查政策；不能借另一正常运行的结果、直接改 candidate 状态或以 native end_turn 代替验证。
机器检查失败保留失败及原证据，支持真实修正后产生新的当前候选；旧候选不因重连或复核评分变为可接受。
记录 question/answer/native_applied、artifact digest、verification、candidate 的同链来源，normal/controlled-recovered/native 各自分层。
不为演示新增动态 DAG、自动接受、合并或上线权限；副作用仍由主线实际应用命令控制。
验收：恢复后检查失败与合格当前候选均能复现，错误 subject/环境/版本在完成 gate 前拒绝。

## B10 人工接受与合法版本

通过真实应用命令完成一次明确人工 acceptance，保留原 acceptanceRef、verificationRef、candidate 和 artifact 身份；不直接写最终状态。
构造真实 current epoch 至少 2、旧 epoch 至少 1，覆盖旧 contract/question/target/session、迟到 ACK 和修订后旧候选；0 只算 schema 无效输入。
command、实际 native-write intent、fact/receipt 落库均验证当前身份；原 receipt replay 不产生重复人工接受或 ReviewTiming。
接受结果与原 Work 恢复链一致；人类按钮/准许必须是本次实际操作，不能由脚本把最终 accepted 字段写成成功。
人工接受与 observed 审阅数据仅作事实，不能推导自动接受置信度、质量证明或超出原授权的后续执行。
验收：当前候选一次接受、旧候选/旧版本拒绝、回执重放幂等；记录真实输入命令与最终读取结果。

## B11 2/4 槽与控制重入

先 2 槽再 4 槽混合正常、待人回答、重连、unknown、停止和已交付，使用原 scheduler 背压与控制优先级，不新建调度权威。
每槽隔离原身份、credential、游标、receipt 与 payload；错误槽不得接其他槽的批准、消耗其数据或把 unknown 自动改成 quiescent。
原 cancel/stop 使用 actual post-proof 和 main complete-resource barrier，覆盖 stop 中 coordinator 退出/重入、仍活 child 与部分观察。
sent、认证 inspect、launcher PID 消失都不是所有 writer 静止；完整资源未知时保留 barrier/state/material，不构造空集合解除阻断。
每条链使用本次独立出生的受控资源，注入迟到消息和容量压力时不影响十二用户服务或其他 agent 的进程。
验收：2/4 槽真实恢复链、控制优先级与 unknown 隔离成立；受控容量错误明确且无需换 ID 才能归还资源。

## B12 资源归还与第三结果

采集连接、FD、waiter、queue、journal/attempt、Runner/child 的开始、峰值与结束，证明断开/重开后无悬挂回调、重复 effect 或漏计 writer。
清理前重新核对本 probe 独立出生 PID/start/UID/完整 argv/root/config/operation；不使用 shared install/path/子串或陈旧 proof 判断所有权。
unknown 或观察失败保留根目录与证据，禁止删除仍可能活跃的 state，禁止 pkill、全局 socket 发现和其他 credential。
normal 与 recovered 的最终资源分列，受控 fake 不升级成厂商兼容；短序列只称有界稳定性，不称 48h soak。
第三完整结果覆盖 B9–B12 的原 Work 验证/人工接受、合法版本与 2/4 槽资源闭合，所有过程和拒绝有准确 scope。
发布可运行源码和真实全链 consumer 后继续 B13，不因第三次 source checkpoint 已交而结束整包 goal。

## B13 模块完整故障边界

按实际新模块边界做有限故障矩阵：partial/corrupt journal、payload/ref/digest/range、页重放、receipt loss、连接替换、容量与中断。
保留完整合法正对照，坏输入只改变一个原因，记录实际拒绝点和数据/资源不变量；不能用一条坏签名同时代表多个来源故障。
所有 pending/unknown 故障保留可审计原事实，不清 ledger、重写旧结果或把 absent 数据补零；修复后重跑受影响的有限用例。
不要机械重跑全部历史 suite 充时长；风险相关模块与既有控制语义一旦被修改才扩展回归。
验收：每项故障有 deadline、真实 error/exit、原身份和完整资源结论，失败无虚假恢复绿灯。

## B14 实际 consumer 兼容

给 main 和其他明确分工的 consumer agent 稳定 callable API、types、fixture 与准确 source；兼容现有原 A/Broker/Store，不要求新私有 SQL。
consumer 应能用注册身份完成 B4/B8/B12 三条结果链；若共享 input 未到，给最小编译与行为复现，不为旧 probe 增加空方法。
保持公共返回类型 strict/exactOptional 与实际消费者编译，错误码/字节单位/游标语义/关闭行为有契约；仅 root tsconfig 绿不算覆盖。
新增 F/G/H 在其拥有目录消费接口，B 仍唯一修改 runtime；跨 owner 调整由 main 明确，不抢 E 断言或另造同名事实 authority。
验收：实际 main/private consumer 的严格编译及有界正负流程通过，fixture/normal/recovered/native 层清楚，不用 schema PASS 授 runtime。

## B15 可用性与操作文档

完成面向开发与运维的连接/断开/恢复/unknown/停止说明、真实可运行命令、失败定位和需要 main 明确授权的边界。
有限重复运行观察连接/内存/FD/waiter/queue 是否随次数增长，包含两项目或多槽身份隔离；给出开始/结束和总 deadline，不持续无限轮询。
文档/RFC 声明以最终源为准，清除 feed 就保证 begin-once、pending exactly-once、仅有 reader 就完成大记录恢复等过强表述。
保留零真实模型要求；不新做价格、厂商协议、模型配方、second Driver 或价值实验研究来替代已授权运行时实现。
验收：全新消费者按文档在私有资源完成受控链，失败准确说明何处未达、哪些真实原生能力仍 NOT_TESTED。

## B16 第四结果与最终交接

写 `tests/native-acceptance/reports/wave25-status.json`，列 B1–B16、四个真实结果、source/consumer/原 IDs、命令/exit/行为、限制与未达项。
第四结果为 B13–B16 完整模块故障、消费者兼容、可重复运行工具与文档；不能以 helper 数量、局部修复、代码接线或计划替代。
四个结果在 4/8/12/16 发布 runnable checkpoint 后继续；whole goal 未齐保持未完成，不把 partial 报成用户可恢复完整业务。
只显式提交 owned paths 并推原 `origin` 分支，不 upstream；保留两个旧 report diff、b16 untracked、全部历史 tar/profile/ledger 和用户改动。
vendor/model/native 自动调用为 0；B 原 cap4 UNKNOWN 不可花，E 原 24turn/200000token/USD5/单在途 pilot 仍 BLOCKED，无 reset/top-up/refund/补样。
十二组 5180/8796 至 5191/8807 与所有 state 保留；不新 Driver/CAC/桌面/autoaccept/动态 DAG/第二 ledger/lifecycle，私有 fake 不 fallback 真实 CLI/网关。

## 独立备选队列

main consumer 未到先实现实际 port/RFC、descriptor-to-chunk 完整链、单 dispatch 和三类重绑，再私有双 client/故障/兼容，不无限等下一轮。
A 暂缺一个配方先用已有公共端口交原 ID/事实最小复现；自造非法 journal/空 receipt/假计数不是缺 A 表，不据此申请真实模型。
缺产品入口只标对应 NOT_REACHED，其余合法 epoch、unknown、页/字节/回压、回执窗口和资源关闭继续；独立结果不升级为未执行的全链 PASS。
普通发行、主线 readiness、UI 与研究独立，configuration-only/authority none 不成为 native proof、执行 grant 或恢复完成证据。
