# B：原终态证明持久确认到正常退出的完整责任包

原目录 `/Users/hh/Desktop/joker/superagent-agent-b`，原分支 `codex/g1-runtime`。保留dirty后fetch/merge最新origin/main，读AGENTS、共同README和[11-19验收](../../reports/releases/recovery-milestone-01/admission-2026-11-19.json)。当前main **6d309128**，本轮B **91ba4f9a**。

**主动，一个结果做到主线实际采用并独立验收，不在单个fix或SOURCE_READY处结束。** 目标仅是同一个原Runner的终态证明，在原main屏障持久提交前始终可恢复，提交后明确确认才退出。不是新增宿主、运维框架或另一条产品线。

当前源码HOLD：awaitTerminalBarrier未进RunnerServiceHandle，实际entry+service直接strict报TS2339/TS2353；closed/noLease cancel里resolve、50ms后清endpoint早于main持久confirm，丢回复/第二次故障仍丢证明，UNKNOWN资源也不能清退。保留b38已改好的UNKNOWN材料保留，不回归。B39的fixture cancel正例不是自然turn终态/持久确认。

实施约定读[0095“唯一剩余生命周期接口约定”](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)：原inspect/cancel只给证明/关业务/停原资源，不负责endpoint最终清退；原main确认Store receipt/event成功提交后，再通过原认证连接做可选私有postcommit-finalize。B拥有service/entry/recovery-transport/endpoint，main独占Store适配。可选扩展不改冻结Bridge v1/hash，不新队列/ledger/公共用户命令；不要用50ms代替提交。

连续负责以下同一链路直到闭合：把实际entry/handle类型/所有直接consumer对齐；证明普通自然terminal与显式shutdown兼容；proof/cancel回复丢失或confirm前owner再退出时原endpoint仍在；main提交后finalize前退出可由原receipt继任；合法finalize响应丢失可按同确认ID调和；wrong/foreign/缺确认/资源UNKNOWN绝不清退。Finalize只允许已terminated/closed且完整原manifest和每资源quiescent的原对象，不带新停止/执行权限。无明确证明就保留材料。

先交一个可运行最小source和正负consumer，让main接原Store确认与H独立验证；随后持续处理这条链的集成缺口/类型/重放/收尾至同原Work检查接受与原容量组合通过。不能拿export、fixture receipt、cancel200或两个分离PASS充当完成，不必增加长报告或阶段数。

执行受控Node/fake协议与无信号故障，真实vendor/model/native/信号0；无global discovery/危险fallback/借凭据。只改B owned，排除I通信子树，显式推原origin分支；保留十二用户实例、原dirty、state/profile/tar/ledger。遇主线依赖交最小repro/接口差异并继续本链已有负例，不扩独立维护队列或通用进程管理。
