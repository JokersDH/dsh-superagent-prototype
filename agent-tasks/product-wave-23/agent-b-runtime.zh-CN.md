# B：原 Runner 的完整业务恢复与交付

工作目录 `/Users/hh/Desktop/joker/superagent-agent-b`，原分支 `codex/g1-runtime`。保留已有改动后合并 `origin/main`，读根 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、WP-16/0060/0061 和本包。
只改原拥有路径：`packages/execution/`、`packages/catalog/`、`packages/policy-preparation/`、`packages/driver-kit/`、`packages/testing/`、`packages/drivers/`、`apps/runner/`、`tests/native-acceptance/`。
保留两份历史 runtime report 差异、未跟踪的 `b16-real-begin.mjs`、所有账本和旧证据。不得替换主线 contracts、HTTP、UI、根配置、lock 或 A 的生产迁移。

本包从 `f35c38ba167c81feb4031b5b31ee09c7e4747401` 继续：实际业务通道源码已存在，不再称为只有旧 wrapper。新模块 strict/exactOptional 与旧 endpoint 9/9 已通过；旧 control 5/3/4、normal 10/10 的已验范围保留。
但提交的 B22 真实交接仍以 `unknown_outcome` 失败；新通道身份绑定、回放上限和低层写前拒绝存在独立反例。第一里程碑尚未通过，不能用接线和控制测试替代业务恢复。
建立或沿用覆盖整个结果包的 goal，不设 token 预算。十阶段连续实施，三个完整可运行里程碑发布后继续独立阶段；不得每关一个小问题就等待新派工。

## B1 固定边界并早交实际接口

读取 main 的固定复现与 A 现有 bindings/current、commands、dispatch、observations、payload、question/answer 端口配方，列清原 attempt 的身份和数据所有权。
提交最小可调用 attach/stream 接口、精确类型、私有调用样例及 B 拥有目录下的 RFC，说明连接、断开、重接、读取、收据和写前授权如何工作。
RFC 必须列明与原 RunnerLink、AttemptRunner、FileCriticalJournal 的调用关系；不能只交描述符或计划，也不新建 receipt-only coordinator、第二账本或执行生命周期。
确需共享契约时，将实际编译调用和最小变更建议交 main；不要自行编辑冻结 wire 或删除主线 guard。
main `8c8fdefa12ff04d524eec8424efe3a90bc09a6fd` 已接完整普通发行源码，见 [0060](../../docs/rfcs/WP-16/0060-main-ordinary-distribution-source-integration.md)。它与 B 业务恢复独立，不等待新 launcher 或普通安装入口。
验收：实际模块 strict/exactOptional 与调用样例通过，main 能明确消费真实方法；早交接口不等于第一里程碑完成，继续 B2–B4。

## B2 每页身份绑定与写前拒绝

为 facts 每一页绑定原登记的完整 attempt/contract/producer/source 身份，调用方在暴露任何 frame 前验证；固定 socket/inode 和 credential 检查仍保留。
不能依靠先前一次 inspect 或仅持有 credential 推断当前页身份正确；新连接、原连接重用和数据读取都须拒绝不匹配上下文。
新低层 command API 必须在 backend/native 写入前拒绝预期 producer/source 不符；不能先执行命令再因返回 inspection 不符报错。
保留 attach.send 的实际 beforeCommand/Broker guard，拒绝不得被 catch 后转成可发送状态；调用方 guard 不得变成 transport 自行授予的许可。
验收：同 endpoint 原身份读取/发送正对照、foreign source/attempt/contract/有效旧 epoch 拒绝、socket 被替换拒绝分别独立；断言读取暴露数和真实接收/写入数。
已关的控制 wrapper 边界只在变化影响它时回归；新 API 的问题不能倒推现有主线控制已经失效。

## B3 有界回放和统一命令入口

以 journal 的真实不可变 seq 为基础分页，明确字节预算、页尾游标、结束状态和 ACK 后的安全继续位置；不能按过滤后的数组下标重编号。
使用真实 FileCriticalJournal 生成超过 64KB 的合法日志，连续读取每页，证明原 fact/payload/顺序完整且无跳过、重复或静默截断。
为单条合法大 payload 提供明确的有界读取或引用传输路径，验证原 payload digest；不得只抬高全局 64KB 上限或返回空页冒充完成。
把新 endpoint 命令和原 stdio 命令归入一个实际 dispatch path，保留 begin 一次性、prepared policy、身份、容量、控制优先级和实际 receiver 观察。
不能仅调用 feed 就绕过原 begin/launch/receiver-log 规则；客户端关闭也须有真实连接与 waiter 生命周期，不能靠 no-op close 证明交接。
验收：多页/空页/末页/非法游标/超界 payload、重复 begin/冲突 body、满队列控制命令分别有正对照、明确错误和有限 deadline。

## B4 真正重绑并交付第一里程碑

让原事实 sink/回执 ACK、不可变 payload 读取响应、原生写入许可请求可以重绑到新客户端；只增加 facts polling 和 command 入队不足以完成这一阶段。
Broker 必须使用 main 当前授权回调，在真实 native 写入时重读；不能继续向已断开的旧 stdio 等待 write-admission，也不能将普通 command 预检当原生许可。
client A 完成原 Work 的 begin/question，真实断开 A；client B 接同一 Runner 和同一 child，回放原事实、登记到同一 A Store，并接手原问题后续响应。
记录两个客户端生命周期、Runner/child PID/start、原 session/request/command/attempt/contract/epoch、真实事实及收据；不得另起 child 或改身份填补失败。
私有 fake 应能走真实 product Driver/协议和 Broker 链；固定 `/usr/bin/false` 的启动失败只算失败诊断，不能算正常业务交接。
第一可运行里程碑：B1–B4 的源码、接口/RFC、实际双客户端流程、身份/分页/guard 负例一起通过。发布后继续 B5，不以 PARTIAL 标整个 goal 完成。

## B5 协调器退出后的原进程恢复

在独立私有进程运行原 coordinator，持久化使用 A 原有事实和精确 Runner 登记；注入正常退出和 SIGKILL，核实原 coordinator PID 已终止。
新 coordinator 进程从同一 A Store 读取完整原登记/当前 binding，连接原 Runner/child；禁止全局 socket 扫描、猜目录或尝试其他 credential。
证明原 journal、native session/request、原 Ticket/Assignment/attempt/contract/epoch 未换，不借内存 map 或重建空账本宣称 durable recovery。
核对 pending intent、observed、result、unknown 的真实来源；某 receipt 存在、commands.has 为真或无响应都不能单独证明原生已收到或未收到。
验收：新进程实际读取、连接、事实入库和原接收端观察，提供存活/退出和最终资源身份；每一故障窗有完整正常对照和总时限。

## B6 原问题回答与有限发送窗口

恢复原 Broker question、version、target、native binding/request 与 answer；允许的同一回答实际达到 native_applied，无法判定时保留 indeterminate。
begin 和 answer 分别覆盖写前、接收后 ACK 前、ACK 后事实回执前、回执持久后等有限窗口，不用另一个新 command id 补发未知请求。
使用 A 真实 intent/observed/result 读取配方区分状态；已经接收/完成的原命令不重发，unknown 不退款、不换 attempt/session/request 或创建替代任务。
修正 B22 的 observed-not-resent 断言：同一个原 id/body，持久观察为依据，计数实际 receiver/native effect；不得在断言前先再次 send 原命令再测试另一 id。
原生批准逐请求保留；用户回答不能因为文本相同或旧 approval 已存在转给另一 request。答案消费和回执重放保持幂等。
第二可运行里程碑：真实 coordinator SIGKILL 后，新进程原身份回答及上述有限窗口通过；发布准确源码/进程/原 ID/行为证据后继续 B7。

## B7 有效版本与恢复后控制

构造合法 current epoch 至少 2、旧 epoch 至少 1 的真实运行态，而非 schema 无效的 0；覆盖旧 contract、旧 question/target/session 与迟到 ACK。
在写前 guard、实际 native-write intent 和回执落库处验证当前身份；过期请求不得因重连成功或历史批准而恢复写权。
原 stop/cancel 继续使用 actual post-proof、完整资源集和 main 的 quiescence barrier；sent、认证 inspect 或 runner PID 消失都不是全部 writer 已静止。
覆盖 stop 途中 coordinator 再退出/重入、unknown writer 和仍活的受控 child，保持精确 endpoint 与原 operation，不能用空资源集消除未知。
验收：每项拒绝在真实写入前发生、旧回执不能污染新版本；正常原身份停止和完整资源归还正对照仍通过。

## B8 原 Work 恢复到可人工接受交付

在同一恢复链继续原 Ticket/Assignment 的工作产出，走已有注册 verifier/check、artifact、current candidate 和 completion gate。
通过真实应用命令执行一次明确人工 acceptance，记录结果；不得直接写候选状态、自动接受、跳过检查或将另一次正常运行的结果贴为 recovered。
证明原 question/answer/native_applied 与候选、验证、接受使用同一 Work/contract/attempt 的可追溯事实；结束后保留原未知记录与审计。
验收：机器失败和修订后的旧候选拒绝、合格当前候选人工接受均有流程证据；normal、controlled-recovered、installed-native、value 分别计量。
main 消费者暂未到时交实际 port 与私有原 A/Broker 消费样例，标明对应产品步骤 NOT_REACHED，不能造另一 coordinator 或伪造 main PASS。

## B9 并发槽位与资源归还

先 2 槽再 4 槽，在有界场景中混合正常、待人回答、重接、unknown、停止和已交付；维持原 scheduler 的背压与控制优先级。
每个槽有独立原身份和受控 child，故障槽不获取其他槽授权或凭据，不共享错误的 source/cursor/receipt，unknown 屏障不被自动重试清空。
记录连接、FD、waiter、队列、journal/attempt 和子进程的开始/峰值/结束，核实关闭重开后没有悬挂回调、重复事实或额外 native 接收。
只清理独立证明由本次 probe 出生的 PID/start/UID/root/operation；超时也不 pkill、按路径杀进程或删除旧标记/队列。
验收：明确总 deadline、可解释未知状态和完整最终资源观察；短序列只称有界稳定性，不称长期 soak 或厂商兼容准入。

## B10 第三里程碑与完整交接

写 `tests/native-acceptance/reports/wave23-status.json`，列准确 source、消费者、原 ID、每阶段状态、命令/exit/实际行为、限制和未达项。
第三可运行里程碑必须覆盖恢复验证/候选/人工接受、有效版本、控制重入及 2/4 槽资源归还；不能把新增 helper 数量、源码接线或单项修复当整包完成。
第一/中期/最终三个源码 checkpoint 都显式提交 owned paths 并推原 `origin` 分支，不推 upstream。提交检查点后继续独立阶段，整包出口未齐就保持 goal 未完成。
自动开发/验收真实 vendor/model/native turn 为 0；B 原 cap4 余额 UNKNOWN 不可花，E 原 pilot 仍 BLOCKED，goal 与 checkpoint 均不刷新预算。
私有 fake 不允许 fallback 到真实 CLI、网关或未授权宿主执行器；不新增 Driver/CAC/桌面壳/自动接受/动态 DAG。
保留十二组 5180/8796 至 5191/8807 的用户服务，以及全部 state/profile/tar/账本/历史报告；不为验证重启、迁移或清理用户实例。

## 独立备选队列

main 共享变更未到时，先完成实际 attach/RFC、精确身份/分页、同 Runner 双客户端、回执/payload/许可重绑的私有真实消费者，不无限轮询或等下轮重派。
A 暂缺一个真实读取配方时先用已存在公共端口，并交最小原 ID/事实复现；不添加探针专用空方法、SQL writer、并行账本或授权捷径。
后续产品消费者未到时继续合法 epoch/迟到 ACK、unknown 保留、页边界/回压/资源关闭与正常回归；独立结果明确 scope，不升级为未运行的整链 PASS。
普通发行已在 main，可与本包并行。安装、source 确认和只读恢复都不授业务重接/私有启动/target 权限，BLOCKED 研究也不成为本包停工理由。
