# Agent B：完整传输、真实重绑与原业务恢复整包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-b`，原分支 `codex/g1-runtime`。
原拥有路径不变：execution/catalog/policy-preparation/driver-kit/testing/drivers、`apps/runner/`、`tests/native-acceptance/`。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0066](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)、[0067](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md)。
fetch 并合并最新 `origin/main`，按实际 AGENTS/接口继续；八位外部 Agent A–H 与 main 并行，不改 root contracts/lock/HTTP/UI、A SQL 或 E 断言。
保留 `9fdfdd5` 大首 fact 引用发现、foreign payload source 拒绝、完整 command tuple 与 strict 的已过范围，不重派旧修补。
新中间 chunk 条件破坏合法传输；实际 135540 字节历史 payload 的首块/中间块被 503 拒绝，不能把改两条件当整个结果包完成。

建立或延续完整结果包 goal，不设 token 预算。十六阶段持续实施，B4/B8/B12/B16 发布四个可运行完整结果后继续。
主结果：facts→ref→全部 payload→receipt 及真实重绑 → 同 Runner 双客户端 → 原 ID SIGKILL 问答/恢复交付 → 版本/并行/资源闭合。
未知状态保持，入队 ACK 不等于 native_applied，sent 不等于 quiescence；无第二 coordinator、ledger 或执行 lifecycle。

## B1 完整修复合法 chunk 传输

- 正确核对 total/offset/requested length/decoded bytes，普通非最终 chunk 必须可读，不能要求一块等于全部剩余内容。
- 正常范围使用明确 expectedLength 与 nextOffset；EOF、越界、空进展、坏 base64 和最终短块语义一致。
- 保留 foreign producer/source 写前拒绝与 server 上限，不能通过放大全局 cap 或截断 bytes 规避。
- 用至少三块 payload 和原 135540 字节历史合法 payload 证明全量还原、稳定 digest 和正确 decoded units。
- 验收：已知 ref 的连续块正向恢复，合法首/中/末块通过，非法 range/total/digest 均准确拒绝。
- 交接物：实际 server/client 源码与完整原字节正负结果，不只一个最后块单测。

## B2 大 facts 到不可变 payload 的实际链

- 大首 fact 的 descriptor 发现已通过，在该原 seq/fact/ref 基础上接实际 consumer chunk 读取。
- 每块绑定完整注册 producer/attempt/source、原 descriptor、ref/range/total/digest，核验后才暴露 bytes。
- 完整重组并验证 payload 后，事实才可写入原 A ingress 并确认 receipt；分页 next 不等于已应用游标。
- serialized envelope 计入 metadata/identity/数组成本，保持 inline/chunk/server 总上限和背压。
- 验收：真实 schema-valid 大 journal 从发现到读取、摘要、fact receipt 全链成立，缺块/冲突/重放准确处理。
- 交接物：可调用 descriptor→payload→receipt port 与实际原序列记录。

## B3 统一 dispatch 与三类往返重绑

- stdio 与 endpoint 命令收敛到同一实际 dispatch，保留 prepared policy、begin-once、完整 subject、容量和 receiver 语义。
- 实现事实 receipt ACK、不可变 payload 请求响应、native-write intent/admission 的实际解绑和新客户端接管。
- 旧 stdio waiter/callback 不能继续拥有回执或批准；close 必须真实释放连接、waiter 和回调，不再 no-op。
- 原生写入仍调用 main/Broker 当前 guard，历史批准不能转换到另一个 request/target。
- 验收：三类往返在断开前/后均可观察，旧 callback/foreign tuple 拒绝，unknown 不补成成功。
- 交接物：早期实际 callable port、types、consumer 和准确 RFC；共享变更交 main 最小输入。

## B4 第一里程碑：完整通道与真实交接

- 真实 ProductDriver/协议接私有受控 fake，原 Work 到 begin/question，不以启动失败充当正常结果。
- client A 真实断开，client B 接原登记同 Runner/child，完成大 fact/payload、receipt 和 native-admission 往返。
- 保持同 Ticket/Assignment/attempt/contract/epoch/session/request 与完整 Runner/child 出生身份。
- RFC 仅声明已测保证；feed 调用、内存 replay map 不能单独证明 exactly-once 或 durable recovery。
- 验收：B1–B4 为一条完整实际链，提交第一可运行结果后继续，不在 chunk 微调后停工。
- 交接物：源码/RFC/真实 consumer、双客户端生命周期和准确未达范围。

## B5 原 A 事实与恢复准备

- 经已有 A ports 读原登记/current、command intent、dispatch/observations、payload 和 Broker 问答/delivery。
- 区分 not_seen、intent_recorded、observed/result 与 unknown，commands.has 或无 receipt 不单独证明对方收到/未收到。
- 真实恢复准备绑定 host/profile/policy/原完整 subject 与当前 guard，不从旧配置或 source receipt 取得新权。
- 端点仅来自原可信登记，不全局扫 socket、猜目录或尝试其他 credential。
- 验收：可独立读回原事实，缺数据保持 unknown/拒绝，不换 command/attempt/session 补发。
- 交接物：实际恢复 consumer 输入和完整 precondition，不造空 ledger。

## B6 独立协调器 SIGKILL 与同 Runner

- 原 coordinator 在独立私有进程真实使用同 A Store，分别测正常退出和 SIGKILL。
- 新 Node 进程从原登记/事实重接仍活的同 Runner/child，不用同进程重开 Store 或另起 child 代替。
- 故障前后记录原 PID/start/UID/fullargv/root/config/operation 和原业务 IDs。
- 每个故障窗有完整正常对照、有限 deadline 与真实 receiver，unknown 留现场不清 marker。
- 验收：新 coordinator 可接管原事实与三类回调，旧 client 无写权，资源与业务身份不变。
- 交接物：真实跨进程故障 consumer、出生/退出证据和原 A 数据读回。

## B7 原问题回答与真实应用结果

- 恢复原 Broker question/version/target、原 native binding/request 和回答，不能以文本相同复用另一批准。
- 实际 native-write intent 时重读 main 当前授权，旧 epoch/合同/问题不能因连接恢复而重新获权。
- 实际允许结果写回原 A sink，只有真实返回可记录 native_applied；pre-admission/response_written/普通 ACK 不是最终结果。
- 不确定结果保持 indeterminate，原 command/body/payload 不变，原 receipt replay 不重复回答。
- 验收：原问题一次正确回答、拒写和 unknown 分别可测，原 session/request/answer 身份闭合。
- 交接物：实际 native effect/receiver 与 A 持久事实对应，受控与厂商原生范围分开。

## B8 第二里程碑：ACK 窗口与恢复问答

- 有限覆盖写前、receiver 后 ACK 前、ACK 后 fact receipt 前、receipt 持久后窗口。
- 原已接收命令不重发，unknown 不换 ID 重试，不退款/reset/补样或开启替代任务。
- 两 client 竞争、迟到 ACK、同 body 重放与冲突 body 有真实计数与独立正对照。
- 所有恢复判断交叉核对实际 receiver 和原 A facts，不只看本地 send 标记。
- 验收：B5–B8 同一原链完成 SIGKILL、新进程原身份问答与窗口行为，发布第二结果后继续。
- 交接物：真实源码、consumer、有限 fault 矩阵和原身份回执。

## B9 恢复原 Work 的检查与候选

- 原 Work/Ticket/Assignment 在恢复后继续产物，走 registered verifier/check、artifact 与 current candidate。
- 候选绑定原合同/attempt/环境/政策；native end_turn、另一正常任务产物或手写终态不能替代机器检查。
- 检查失败真实保留，修正后产生新当前候选；旧候选不因重连或评分被自动接受。
- question/answer/result/artifact/verification/candidate 的来源在同链准确关联。
- 验收：恢复后失败与合格候选均可复现，错误 subject/环境/版本在 completion gate 拒绝。
- 交接物：原 Work 完整验证 consumer 和实际产物/摘要。

## B10 明确人工接受与合法版本

- 通过真实应用命令接受当前候选，保留 acceptanceRef/verificationRef/artifact 身份，不直接写 accepted。
- 使用 current epoch≥2、旧 epoch≥1 的合法输入测旧合同/问题/target/session/迟到 ACK；0 仅算 schema 坏值。
- command、native-write intent 与结果落库各自核当前完整身份，原 receipt replay 不重复接受或 ReviewTiming。
- 人工行为和观察计时只作事实，不推导自动接受或额外后续副作用。
- 验收：当前候选一次接受，旧候选/版本拒绝，正常与 recovered 的链分别可追溯。
- 交接物：实际用户命令、版本正负和最终读取结果。

## B11 2/4 槽与控制重入

- 先 2 再 4 槽混合正常、问答、重连、unknown、停止和交付，使用原 scheduler/背压/控制优先级。
- 每槽的原身份、credential、游标、payload/receipt 隔离，不接其他槽的批准或抹掉 unknown。
- stop/cancel 使用 actual post-proof 与 main complete-resource barrier，覆盖 coordinator 停止中退出/重入。
- launcher 消失、认证 inspect、sent 不证明所有 writer 静止；完整资源未知不能转空集合放行。
- 验收：合法并发链、控制优先级和 unknown 屏障成立，资源归还不需要换 ID。
- 交接物：真实槽位矩阵、原资源与业务结果。

## B12 第三里程碑：交付与资源闭合

- 记录 FD、连接、waiter、queue、Runner/child 的开始/峰值/结束，断开重开无悬挂 callback 或重复 effect。
- 每次信号前 fresh 核独立出生 PID/start/UID/fullargv/root/config/operation，不能复用旧 proof 或共享路径认领。
- unknown 保留状态/marker/material，不删除仍可能活动的根，不用 pkill/global scan。
- 短受控序列只称有限稳定性，不冒充厂商兼容或 48h soak。
- 验收：B9–B12 同原 Work 检查/人工接受/合法版本/2&4 槽资源成立，发布第三结果后继续。
- 交接物：实际可运行交付 consumer 与可复核资源终态。

## B13 模块完整故障边界

- 有限覆盖 corrupt/partial journal、descriptor/ref/range/digest、缺页、receipt loss、连接替换、容量与中断。
- 每项只改变一个原因，保留完整合法正对照、原事实和 deadline，拒绝点可准确归因。
- 未知 pending/spend 保留，不清 ledger、重写旧结果或缺数据填零。
- 修复后只扩大受影响范围，不机械重跑全部旧套件凑时长。
- 验收：所有承诺失败有实际 error/exit 与资源结论，无虚假恢复绿灯。
- 交接物：有限 fault 工具、矩阵和实际运行命令。

## B14 实际 consumer 兼容与早期 port

- 给 main/A/明确 consumer 稳定 callable API、types、fixture 和准确 source，不要求私有 SQL。
- direct module strict/exactOptional 与真实 consumer 编译通过，不能只引用未覆盖源码的根 tsconfig。
- 错误码、字节单位、游标、关闭和 unknown 语义准确，schema 通过不授 runtime。
- 跨 owner shared contract 由 main 管理，B 保留唯一 runtime 修改权，不抢 E/F/G/H 路径。
- 验收：独立 consumer 可完成 B4/B8/B12 实际结果，未达项准确，不为旧 probe 新增空方法。
- 交接物：公开接口、准确 RFC 和消费者实测记录。

## B15 可重复使用与操作说明

- 文档说明真实连接/断开/恢复/unknown/停止与失败定位，不保留超过实测的 exactly-once 保证。
- 有限重复观察多项目/多槽连接、内存/FD/waiter/queue，给开始/结束和总 deadline。
- 受控 fake 不 fallback 真实 CLI/网关，不借协议/价格/模型配方研究替代本轮 runtime 实现。
- ordinary FApp/readiness/安装与 B 恢复独立，configuration-only/none 不成为 native proof。
- 验收：新 consumer 按文档在私有资源完成真实受控链，失败能定位实际未达层。
- 交接物：完整操作指南、可重跑命令与真实支持范围。

## B16 第四里程碑与最终结果

- 状态写 `tests/native-acceptance/reports/wave26-status.json`，列 B1–B16、四完整结果、source/原 ID/命令/exit/行为。
- 第四结果包含完整故障、兼容、可重复 consumer 和文档，不用 helper 数量或局部修复替代。
- 若仍未到真双 client/恢复交付，wholePackageComplete 保持 false，不能以发布 source 充完成里程碑。
- 显式提交 owned paths 并推原 origin 分支，不 upstream/reset；保留两旧 runtime report diff 与 b16 untracked。
- 验收：已承诺结果实际可跑，scope/未知清楚；发布后继续独立队列，整包真实完成才结束 goal。
- 不新 Driver/CAC/桌面壳/autoaccept/动态 DAG/第二 ledger 或生命周期。

## 独立备选队列

- main consumer 未到：先完成实际 port/RFC、全量大传输、统一 dispatch/三回调和私有双 client，不无限等待。
- A 缺一个输入：用现有 ports 给原身份最小复现，不用非法 journal/空结果归因缺表，不申请模型。
- 后续执行入口未到：继续合法 epoch/unknown/容量/回执/资源归还；独立结果不升级为未跑全链。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E 原 BLOCKED pilot 不重置、不 topup/refund/补样。
- 保留十二服务 5180–5191 / 8796–8807 和全部 state/profile/tar/ledger/dirty；每次信号仅对 fresh 独立证明本轮出生的精确资源。
- 新 F/G/H 无 B runtime 所有权，main 保留授权/根 contracts/HTTP/UI，A 保留迁移，E 保留独立断言。
