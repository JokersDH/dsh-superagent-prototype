# main：完整子系统到默认产品的四条交付线

2026-11-17。原目录 `/Users/hh/Desktop/joker/superagent`，原分支 `codex/g2-execution-integration`，固定产品输入 `f32a64ff2d22f3bcbcd48b19cb52c967b63f4530`（前端b454）。保留全部dirty/history/state/账本，fetch并merge origin/main，不reset/清状态。

读AGENTS/START-HERE/product-spec/README、本轮[README](README.zh-CN.md)、[0092已交](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[0093验收](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)、[0094整体程序](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。原[九项验收](../product-wave-35/main.zh-CN.md)保留，未闭的实际consumer/集成/维护继续，不把SOURCE_READY自动写完成。

一个whole-subsystem goal覆盖下面四条更大的端到端产品闭环和独立队列；不是九变十二微阶段。早/中/终可运行source交接后继续整个子系统/default consumer/同版本维护，不在某个小fix或文档处等新派工，无工时/时长/同日/token承诺。

## 产品闭环一：原运行与QuestionBroker到同原Work恢复交付

生产实现：延续旧M1/M2/M3。原launch返回running/attachCallbacks已供给，先用现有callbackconsumer初始bind加原stdio feed/stop实接正常问题；B新post-exit quiesce兼容修前不默认合四文件控制。

默认实际消费者与必要正负：沿原current→command index→allowAnswer→send→native_applied/unknown调和，原check/currentCandidate/available.manualaccept→delivered→原2/4资源与原ID重开。禁止新slot queue/ledger、等价guard或反射endpoint替代真实factory。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 产品闭环二：原事实、决定与项目到真实用户确认

生产实现：延续旧M4/M5/M6。本轮已交A三kind分类历史认证GET/HMAC/currentScope/strictDTO→原WorkDetail，保持旧timeline；C同步superseded/digest修后才接原create事务持久选择，J仅data rebind不授权。

默认实际消费者与必要正负：默认history多页/原bytes、实际新Work选定决定/版本/来源在创建前重验、registered-root freshrecipe及原确认；跨身份/config/Work/filter迟到与旧cursor拒，不裸透rawbindings或改旧合同。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 产品闭环三：日常工作台与配置到稳定可用体验

生产实现：延续旧M7/M8。保留已交网页private model-save、HTTP明示/secret清空/StrictMode隔离、三类history/原证据，继续F多项目草稿/错误恢复/键盘手机与G真实身份输入。

默认实际消费者与必要正负：实际App/core/HTTP原流程联调，保存不自动发模型；unknown身份/成本/活动代理诚实显示，旧服务可用。只导入审过最小slice，不改F候选或并写其目录。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 产品闭环四：选定工程版本到完整安装、数据与维护交付

生产实现：延续旧M9。本轮verifier两个明确已审wrapper hash已使W35静态准入，不动归档；D当前target的upgrade rawBLOCKED需准确receipt，必要含新history的后继另稳定freeze→E独立。

默认实际消费者与必要正负：同一source/包内entry/manifest/ABI/数据和真实原项目完整旅程，非空恢复/升级/诊断以原授权/资源guard，source/受控/安装/native/recovered/value分层；不把静态包与数字涨幅当完成度。 正向与相关负向必须在同原入口出现，接口可编译或helper全绿不单独算完成。

同版本/维护交接：提供最小源码与依赖、actual consumer/原IDs/命令exit/准确source和未达层，main持续审入，D/H/E独立消费；发source后继续其他闭环和独立工程。

## 独立队列与整包完成条件

外部依赖只阻对应项：交最小真实RFC/consumer后继续owned兼容/故障保留/日常路径/模块交接，不无限轮询或重复长soak，不复制另一个reader/状态机/执行生命周期。四条线均有生产实现→默认实际消费者→必要正负→同版本维护才完成整goal，旧九点映射延续不清零。

仅owned：`packages/contracts/`、`packages/application/`、`packages/questions/`、`apps/coordinator/`、`apps/console/`、`agent-tasks/product-wave-36/`、`tools/bootstrap/`、`docs/rfcs/WP-16/`。共享root/config/lock/provider/HTTP/App/transport/globalCSS/集成由main负责，排除Ftrial；只导入已审source，不改候选树。A唯一append-only生产迁移，E唯一产品断言，I唯一通信，B排除I；共享契约/HTTP/App/root只由main修改。

状态 `reports/releases/wave36-integration/status.json`，显式owned路径推原origin，main HEAD:main，neverupstream/reset。source/controlled/installed/native/recovered/value分别记录，静态/受控不抬安装或研究准入。

自动真实vendor/model/native0；B原cap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不重置/补额/退款/借凭据/price-recipe研究。十二5180/8796至5191/8807及全部state/profile/tar/ledger/dirty/history/runs/五用户日志保持。完整originalspawn不可变birth/PID/start/UID/orderedargv/root/config/op/fullresources先验且每signal fresh；UNKNOWN保留全部材料，不全局发现/substringkill/绕产品拒绝清理/真实CLI fallback。完整B/CAC后置，不新Driver/desktop/autoaccept/writer racing/dynamicDAG/第二ledger或生命周期。
