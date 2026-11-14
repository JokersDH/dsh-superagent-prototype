# D：可靠探针与最新个人工作台同包交付

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`。
保留历史，合并最新 `origin/main`，先读实际 AGENTS、START-HERE、product-spec/README 和[本轮说明](README.zh-CN.md)。
同时读 [UI检查点0062](../../docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md) 与[验收及交付0063](../../docs/rfcs/WP-16/0063-wave-24-admission-and-product-closure.md)。
建立或沿用覆盖整个结果包的 goal，不设 token预算；三个可运行结果里程碑提交后继续整包独立阶段。
仅修改 launcher/portability/distribution，状态写 `tools/distribution/reports/wave24-status.json`；main拥有根配置/锁/契约/HTTP/UI，A拥有迁移。
保留所有原分支、dirty、原始证据、tar、state、profile、ledger和历史scope，不重开仓库或清旧材料。

起点：closure78/78与0ede包6747项已独立通过，CLI帮助三入口均退出0；无需再派这些旧修补。
E准确a9b208PASS/0FAIL/15NT及162required普通范围成立；0ede和最新主线UI仍需准确同包E验。
剩余关键项是登记前失败窗口、精确且新鲜的子资源证明、两种snapshot独立恢复与最新UI的实际安装字节。

## D1 在任何等待前登记出生资源

修同Store/nonempty/real-relocation工具：spawn后必须立即建立可追溯的probe资源记录，不能等waitHealth成功才登记。
记录本次唯一operation、新私有config/data根、实际spawn handle/PID和独立start/UID；随后增补真实子资源身份。
健康失败、实例记录未出现、API未就绪、父进程提前退出时仍有非空UNKNOWN记录，不把null过滤为空集合。
只复用既有probe ownership事实，不创建第二业务ledger、执行生命周期或可供产品启动的授权记录。
未知资源或停止不明必须保留受限私有state/诊断；不先rm根目录，再宣称资源已经清理。
验收：故意永不就绪、缺instance.json、提前退出三个独立输入，均有限失败且准确保留或清理自己资源。
本项及D2/D3未过独立门槛前，不启动broad live安装、升级或停止矩阵。

## D2 精确证明每个子资源与信号前身份

每个launcher/API/console/后代必须有自己的独立出生start/UID/角色/argv/root/config/operation；不能借launcher时间±2秒。
读取apiProcessStart等真实字段并与该PID的当前身份对应，不能仅靠同父PID、同UID或install路径声明owned。
路径与命令按完整token和规范化边界比较，data-sibling/config-sibling与同前缀路径必须拒绝。
区分macOS `/var` 与 `/private/var` 的规范化等价和真正兄弟目录，不用substring松匹配。
CLI stop及有界等待之后，任何直接信号前再次读取每个PID的完整身份；复用PID、换start、未知观察立即停止该动作。
未知集合不得清空；只有完整自有资源全部确认终止，材料才有资格清理。
验收先pure控制：完整own positive、独立child-start不符、sibling根、错误operation、PID复用、缺记录准确拒绝。

## D3 登记前与清理中断的独立故障矩阵

覆盖spawn后record前、record后health前、seed/review/reopen三次启动、stop超时与信号前身份变化。
每个故障从完整合法positive和全新private根开始，设单场景deadline与总deadline，保留失败原始结果。
先用注入观察证明不会向错误PID发送信号，再仅对独立证明自己出生的资源做必要有界真实验证。
finally重复执行应稳定；未知记录、无法确认退出或父退出后的子资源保留UNKNOWN与私有材料，不删活根。
清理控制工具本身也覆盖异常路径，不能因try块变量作用域错误漏停它自己的测试进程。
第一里程碑交安全可运行工具、独立正反控制、有限故障结果和真实资源归属清单。
发布该源码后继续D4–D10；不等待E包验或B业务恢复才开展独立阶段。

## D4 消费最新主线UI与CLI帮助检查点

以最新origin/main实际source为输入，确认0062对应来源诊断界面与CLIhelp均在已发布源码，不重写main界面。
核launcher/portability/build/stage/freeze与console/coordinator依赖保持完整，更新准确source closure而非复制旧head标签。
核包内 `pa --help`、`pa help review-restored`、`pa review-restored --help`，只对新差异做有限回归。
帮助命令不得创建state/credentials/queue或启动daemon；实际私有env根前后比较，不能检查一个未传给命令的目录。
根脚本/lock/公共契约需求给main；只修改拥有路径，不把安装工具改成另一套授权入口。
验收：实际源码/clean build/staged文件一致，诊断UI及其后端接口均来自相同source。
CLI/帮助已通过的历史范围保留，不用重跑旧矩阵替代本轮核心结果。

## D5 组合A真实原数据与唯一C驱动

消费A独立producer/reader及C唯一有界、身份绑定的参数化consumer，记录各自source/entry/hash与调用参数。
同一源Store含原Work/question/answer/attempt/native_applied与SDK/context/candidates，原稳定ID和实际字段不可替换成近似名称。
使用已有产品入口生成事实，readonly断言可读A公开port；不得手写SQL补原本不存在的业务结果。
测试驱动可作为明确版本的开发验收输入，不强迫它成为运行包的一部分，也不能借checkout补缺失产品consumer。
原B/A数据与历史材料只读，所有修改限定本次新副本；真实vendor/native0。
依赖未到仅标本项NOT_REACHED，继续安全清理、准确闭包和普通安装准备，不再造一份私有驱动。
验收：同一来源描述能被main/E调用，producer/数据subject/实际包内consumer身份分别绑定。

## D6 两种snapshot实际独立恢复与用户读取

从同一原Store实际create/verify默认workflow1与显式2，分别恢复到两个不同的新目标根。
使用已有或A交付的真实恢复/材料消费接口；如缺接口交最小真实需求给A/main，不伪造不存在的restore方法。
两条路径分别读取原Q/A/native_applied等实际ID、answer digest、attempt、Work及SDK候选，不能只比family或数据库SHA。
每条路径均用包内prepare/start完成未选择403→明确选择后candidate/history/frozenbody200，业务422、queueheld、provider不增。
一次bundle恢复与两snapshot数据库等价的历史结果保留，但不得冒充两条独立格式consumer。
实际最新UI显示与后端一致的范围原因/遮蔽状态，默认读取与原权限守卫不变，解释绝不授执行权。
第二里程碑交最新source可运行同包候选、唯一驱动及两目标完整结果，先发布再继续后半包。

## D7 准确冻结最新运行字节并早交E

先保留0ede不可变输入供E；最新main UI/CLI运行字节发生变化时，以准确clean source生成必要后继。
记录source/build/tarSHA/bytes/schema/platform/ABI/Node/SQLite与完整文件/内部link闭包及consumerentry。
运行字节先冻结，再给E最终验收；main不需要等E结论才交source，禁止形成派工依赖环。
只改文档/报告的HEAD不反复冻结；不得覆盖0ede/a9b/595或把旧E结论重标到新tar。
把最短包内prepare/start/reuse/reopen/拒绝流程和实际数据驱动参数早交E，缺项准确列出。
验收：从tar重新读取的source/manifest/hash与交接一致，UI静态资源和API字节确为同一候选。

## D8 普通安装、复用与安全升级

D1–D3独立通过后，才在全新私有根运行有限cold/no-executor/multi-state/reuse与准确升级。
same-file REUSED需原PID/start/实际health身份一致；不同选择、根、端口、登录拒绝且不暗中stop/spawn。
选已验证安全旧包→本候选与16→18，核actualexit/status/pointer/operation/data及所有资源归属。
未知live资源阻断切换；保留升级后新增数据，不拿旧快照覆盖它来制造回滚通过。
只扩新增风险窗口，各场景有positive、deadline、准确自有cleanup；危险旧97路径仍只mock。
验收同一候选tuple与consumer贯穿安装/升级，跨机器或ABI未测如实记录。

## D9 重开、支持包与内部使用闭环

同包执行prepare/start/同选择reuse/失配拒绝/stop后重新prepare/reopen，证明原数据可读且不重发完成请求。
有限SSE、刷新、并发只读与重开后核provider、queue、FD、子资源回到准确基线，不宣称长期soak。
support私有0600、脱敏、拒绝覆盖，不含模型key/credential/可执行旧授权；失败保留可验证ownership和诊断。
交E能直接运行的步骤、命令、退出码与数据/producer/consumer来源，不只交自己PASS计数。
验收以实际用户流程为主，private permission、target、B/native恢复未交不阻普通只读安装，也不外推那些能力。
外部依赖不确定时继续有限可用性与文档准确性，不无限轮询其他Agent。

## D10 第三个结果里程碑与最终交接

交安全probe、准确closure、新包、原Store两snapshot独立恢复与同包普通安装/升级/reopen/support完整结果。
每阶段明确PASS/FAIL/NOT_REACHED及下一项，E最终待到只写待验，不自授release或删历史失败。
只提交拥有路径推原origin分支；wholegoal未达继续独立队列，三个checkpoint不是停止点。
真实vendor/model/native0；Bcap4 UNKNOWN不可花，Epilot24turn/200000token/USD5/oneflight继续BLOCKED，不reset/refund/补样。
保留十二组5180/8796至5191/8807与全部state/profile/tar/ledger/dirty，不global扫描或触碰用户进程。
不扩新Driver/CAC/desktop/autoaccept，不把计划、测试数或源码检查当完整产品发布。

## 独立备选队列

A/C真实接口未到：先做登记前窗口、精确出生证明、UI/CLI准确闭包和安全普通发行，不复制第二数据权威。
main最新UI source未到：安全工具与0ede精确输入先交，等实际source后才冻结变化字节，不猜主线实现。
E结果/B/private/target未到：独立ordinary/review继续，未知资源与账本保留，未授执行权始终未授。
