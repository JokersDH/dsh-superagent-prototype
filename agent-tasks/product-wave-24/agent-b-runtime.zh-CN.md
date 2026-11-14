# B：从有界通道到原业务恢复与交付

2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-b`、原分支 `codex/g1-runtime`，保留全部改动后同步最新 `origin/main`，记录实际合入 SHA。
先读根 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0062](../../docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md)、[0063](../../docs/rfcs/WP-16/0063-wave-24-admission-and-product-closure.md) 及本包。
只改原拥有路径：`packages/execution/`、`packages/catalog/`、`packages/policy-preparation/`、`packages/driver-kit/`、`packages/testing/`、`packages/drivers/`、`apps/runner/`、`tests/native-acceptance/`。
保留两份历史 runtime report 差异、未跟踪 `b16-real-begin.mjs`、全部预算账本与旧证据；不编辑 main contracts/HTTP/UI/root lock、A 迁移或 E 断言。

固定起点 `3a40d00054bf90023f4805c77eed7881fcebccf9`。新业务通道源码已存在，不能再称只有旧 wrapper；actual-module strict/exactOptional、旧 endpoint 9/9 保留。
本轮已独立验证 facts 每页 producer/source、foreign source command 写前拒绝、真实 160 条合法日志分 10 页完整回放。不要再派这些已关闭的修补或重做旧 normal producer。
仍欠完整 command tuple、预算与传输上限一致性、大单 frame 路径，以及实际 receipt/payload/native-write-admission 重绑。B22/B23 提交脚本仍失败，首个业务交接里程碑未准入。
建立或沿用覆盖整包的 goal，不设 token 预算；十阶段持续实施，三个完整可运行结果交出后继续独立阶段，不在小修、PARTIAL 或接口草图处停工。

## B1 固定实际输入并早交接口

同步 main 后列出真实原 attempt 的登记、binding、commands/dispatch/observations、payload、question/answer 和 receipt 读取配方；直接消费 A 已有公共端口。
提交 B 拥有目录下的最小 RFC、实际 callable port、严格类型与调用样例，明确连接、断开、重接、fact page、ACK、payload 和原生许可如何关联原身份。
RFC 必须画清原 RunnerLink、AttemptRunner、FileCriticalJournal、A Store 与 Broker 的调用关系和持久事实所有权，不创建第三个 receipt-only coordinator。
确需共享契约时交给 main 最小实际 consumer/编译复现和字段建议；不修改冻结 wire、不复制私有权威、不添加只为 probe 存在的空接口。
main 本轮来源诊断 UI 与 CLI 帮助有独立实际交付；普通发行、UI 与 B 的业务恢复互不等待，不能再把缺普通 launcher 作为阻断。
验收：实际模块和最小 consumer 在 strict/exactOptional 下通过，main 能调用真实方法；接口早交后继续 B2–B5，不将它计作第一个完整里程碑。

## B2 完整命令身份与拒绝时序

修复 `matchesProducerAttempt` 只比较 ticketId/fenceEpoch 的缺口；在任何 backend dispatch 前比较完整 Ticket/Assignment/attempt/epoch/contract workId/revision/digest。
producer envelope 与 command 自身都要绑定原不可变登记；有合法 producer 不代表其携带的另一 assignment/attempt/contract 命令也合法。
对 source、assignmentId、attemptId、contract 三字段分别做独立有效 schema 负例，使用同 endpoint 原身份正对照；记录实际 backend/receiver/native write 计数。
保留本轮已过的 foreign source 写前拒绝和 attach.send 的真实 beforeCommand/Broker guard，不能通过捕获错误后继续 send 或仅检查返回 proof 来补救已发生写入。
原 control wrapper 的登记、socket inode、post-proof 与 unknown 语义保留；防御性 AttemptRunner.feed 校验不能代替 reusable transport 的写前契约。
验收：每项错身份在真实 dispatch 前拒绝且计数不增；原完整命令成功，重放同 body/冲突 body 的结果明确，不能混用无效字段 0 充当旧 epoch。

## B3 预算一致的页与大 payload

由 server 强约束可支持的 page byte budget，与客户端/响应总上限一致；非法或无法承诺的预算在读取 journal/backend 前拒绝，不能接受 1MiB 再撞 64KiB cap。
按真实序号和完整序列化 envelope 大小分页，计入数组分隔、producer 和游标字段；page.next 表示实际返回的不可变前缀，不能重编号或指向未传完的末尾。
对单个合法 frame 超过一页的情况，交付明确的有界 payload reference/chunk/range 路径及 digest 绑定，调用方能完成原 payload；不得突破预算硬塞首条或只抬全局上限。
覆盖 160 条合法多页、空/末页、非法/超前游标、页边界、一个真实合法大 writer.observed payload 和中断后续读；证明不跳过、不截断、不重复消费。
修正 B23 fixture：使用已存在的合法 fact/payload builder，补必填 source，kind 与 payload 一致；不要把自造非法 journal 误归因缺 A 表或申请真实 vendor。
使用实际 `serveRunner` pager，而非在 acceptance 中复制一份算法；使用返回的真实 endpoint 字段、完整合法 command 和真实 backend 计数，移除无关 localhost fetch。
验收：小页已过范围保留，大页预算和大单 payload 的正反例新增通过；所有请求有 abort/总 deadline，失败明确保留 unknown，不输出假完成空页。

## B4 单入口与实际通道重绑

把原 stdio 和新 endpoint 业务命令归入一个真实 dispatch path，保留原 begin-once、prepared policy、launch、完整身份、容量、控制优先级及 receiver 观察。
不能让 endpoint 只 feed 而绕开服务层 begin/launch/receiver-log；命令 ACK 表示哪个阶段须在实际接口中定义，不把入队成功称 native_applied。
使事实 sink/receipt ACK、不可变 payload 请求响应、native-write intent/admission 可以断开后重绑到新的实际客户端，原 waiter 不得永远挂在旧 stdio。
原生写入时必须调用 main/Broker 当前授权 guard，核对原 native request/target/版本；普通 send 的一次预检不能取代原生写入许可。
实现真实 client 关闭、取消 waiter、连接/会话替换和迟到回调拒绝；no-op close 不构成 handover，旧客户端不能继续接收新许可或回执。
验收：每种请求在 A 断开前后各有正常路径与有限故障窗，事实回执落原 A Store、payload digest 不变、过期许可无写入；不新建 ledger 或执行生命周期。

## B5 同 Runner 双客户端第一结果

使用真实 product Driver/协议与本机受控 fake，使原 Work 达到 begin/question；固定 `/usr/bin/false` 的启动失败只算失败诊断，不能算正常业务。
client A 真断开，client B 连接原登记的同一 Runner、同一 child，读取原事实并恢复原问题及后续事实收据、payload 和原生写入许可请求。
记录两客户端真实生命周期与 Runner/child PID/start/UID/root/operation、原 command/session/request/attempt/contract/epoch；禁止另启 child 或换身份补齐成功。
修正 B22 observed-not-resent：同一个原 command id/body、真实持久 observation 和实际 receiver/effect 计数；不能先再次 send 再测另一 id。
新连接重放事实须经过原 A ingress 幂等检查，原 payload/read/receipt 与 main guard 仍权威；工具自己的内存数组只作观察，不作持久事实源。
第一完整可运行结果是 B1–B5 一起通过：实际 port/RFC、完整拒写/预算、大 payload、单 dispatch、三类重绑和原进程双客户端。
发布这一源码检查点及有界正负证据后立即继续 B6；partial channel 或 replay-only 仍标未达，不把整体 goal 完成。

## B6 原协调器退出与原身份回答

在私有独立进程运行原 coordinator，持久使用 A 原登记和业务事实；注入正常退出及 SIGKILL，独立确认原 coordinator PID 已结束。
新 coordinator 进程从同一个 A Store 读取精确 endpoint/current binding/完整资源，连接仍在工作的原 Runner/child；不扫描全局 socket 或尝试其他 credential。
恢复原 Ticket/Assignment/attempt/contract/epoch、native session/request、Broker question/version/target 和原 answer，不重新创建等价问题或新命令身份。
原问题允许时实际达到 native_applied；无法确定原写入时保留 indeterminate，不能把 response_written、普通 ACK 或 receipt 存在判成已经应用。
核对 main 当前 before-write 授权仍在实际原生请求时运行；历史 approval 不能转用于另一个 request，相同文本也不产生跨请求许可。
验收：真正新进程读 A、同 Runner/child 身份、原问题回答、原事实回执与授权时点可追溯；每条链有正常对照、完整退出状态和有限 deadline。

## B7 发送窗口与第二结果

begin 和 answer 分别覆盖写前、receiver 接收后 ACK 前、ACK 后事实回执前、回执持久后等有限窗口；用真实 receiver 与 A 持久 facts 交叉判断。
区分 not_seen、intent_recorded、observed/result 和 unknown；commands.has、无回执或自己的 send 标记都不能单独证明对方没收到。
已接收/完成的原命令不重发；unknown 不换 command/attempt/session/request id 补发，不清 ledger、不退款、不创建替代样本。
迟到 ACK、重连期间重复回放和两客户端并发提交都经过原幂等入口；完整相同请求返回原结果，冲突 body 拒绝，原 payload/身份不可改写。
验收：第二完整结果包含原 coordinator SIGKILL、新进程同 A 原身份回答，以及上述窗口下原实际写入/事实/重放行为；不是两个互不关联的独立演示。
发布中期源码与准确进程/原 ID/计数证据后继续 B8；缺 main 产品 consumer 时先交真实私有 consumer，不造第二 coordinator 或放宽 Broker 期待。

## B8 原 Work 验证与版本边界

同一条恢复后的 Work/Ticket/Assignment 继续实际产物、注册 verifier/check、artifact、current candidate 和 completion gate，不能贴另一正常运行的候选。
用真实应用命令完成一次明确人工 acceptance，保留 question/answer/native_applied、验证、候选与接受的完整原身份来源；不直接写状态或自动接受。
构造真实有效 current epoch 至少 2、旧 epoch 至少 1，覆盖旧 contract/question/target/session、修订后旧候选和迟到 ACK；0 只算 schema 反例。
在 command、实际 native-write intent 和事实/回执落库处检查版本，重接成功不得复活过期授权；机器检查失败或旧候选须保持不可接受。
验收：合格当前候选人工接受和机器失败/旧版本拒绝均在恢复同链发生；controlled-recovered、normal、installed-native、value 分列，不互相贴标签。
main 消费器未到只阻对应产品步骤，status 标 NOT_REACHED；既有公共 A/Broker 端口可推进私有真实运行与版本/回执负例。

## B9 控制重入与多槽资源

保留原 cancel/post-proof/current complete barrier，覆盖 stop 过程中 coordinator 再退出/重入、仍活 child、部分观察和 unknown writer；sent/inspect 不是静止证明。
先 2 槽再 4 槽混合正常、待人回答、重接、unknown、停止和已交付，使用原 scheduler 背压与控制优先级，不增加新的调度生命周期。
每槽原身份/凭据/游标/receipt 隔离；故障槽不获取其他槽权限，unknown 不能通过换 ID、丢资源或空 manifest 自动清空。
记录连接、FD、waiter、queue、attempt/journal 与 child 的开始、峰值、结束；真实关闭重开后没有悬挂回调、重复 effect 或未计资源。
只信号独立确认本 probe 出生且 PID/start/UID/root/config/operation 一致的资源；超时/unknown 保留根和证据，不 pkill、不按路径杀或清旧队列。
验收：第三完整结果包括同一恢复交付链、合法版本/迟到 ACK、控制重入、2/4 槽和完整资源归还；短序列只称有界稳定性，不称长期 soak。

## B10 完整交接与持续执行

写 `tests/native-acceptance/reports/wave24-status.json`，列准确 source/consumer、阶段状态、原 IDs、实际行为/命令/exit、正负控制和明确未达项。
三个可运行源码检查点按实际第一/第二/第三结果发布；checkpoint、接口、单项修复或测试数量都不完成 whole goal，未齐继续独立阶段。
只显式提交 owned paths 并推原 `origin` 分支，不推 upstream；不回滚原两个 report diff、未跟踪 b16、用户日志或任何历史 ledger/tar/profile。
自动开发与验收 vendor/model/native turn 为 0；原 B cap4 UNKNOWN 不可花，E 原 24turn/200000token/USD5/单在途 pilot 仍 BLOCKED，无 reset/top-up/refund/补样。
私有 fake 不 fallback 到真实 CLI、网关或未授权宿主执行器；不新 Driver/CAC/桌面/autoaccept/动态 DAG/第二 ledger 或执行生命周期。
保留十二组 5180/8796 至 5191/8807 服务、全部 state/profile/tar/账本和旧证据，不为本包重启、迁移或清理用户实例。

## 独立备选队列

main 共享输入未到先交最小 actual port/RFC、生产 pager/大 payload、统一 dispatch 和三类重绑私有 consumer；不无限轮询等下一轮重派。
A 配方暂缺先用已有公共端口并给出原 ID/事实的最小真实复现；自造非法 journal、空 receipt 或假计数不是缺 A 表，不据此申请模型预算。
产品 consumer 未到继续真实双 client、有效 epoch、unknown 保留、页边界/backpressure、原 guard/回执窗口和资源关闭，按准确 scope 发布独立结果。
普通发行、诊断 UI 与只读审阅独立推进；source 确认/安装/read selection 不授业务恢复、私有启动或 target 权限，BLOCKED 研究不是本包停工理由。
