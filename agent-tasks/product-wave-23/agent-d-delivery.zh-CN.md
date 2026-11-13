# D：安全验证、主线发行与同包恢复交付整包

继续 `/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`。
先读 START-HERE、product-spec/README、本轮 README、WP-16/0060/0061 与本轮验收报告。
建立或沿用覆盖整个结果包的 goal，不设 token 预算；三个里程碑提交后继续独立阶段。
仅拥有 `apps/launcher/`、`packages/portability/`、`tools/distribution/`；根配置/锁/契约/HTTP/UI 属于 main，迁移属于 A。
状态统一写 `tools/distribution/reports/wave23-status.json`，准确区分 source、package、producer、consumer、ordinary、recovered、native。

本轮起点：a9b155c 包的 6747 项字节已经独立通过；E 的准确595普通安装范围保留，a9b尚无 E 最终结论。
main 已推 `8c8fdefa12ff04d524eec8424efe3a90bc09a6fd`，完成71文件普通发行集成；不要继续把该源码入口列为缺失。
本包先修 live 验证工具的异常资源清理，再沿真实主线交付可独立验收的安装包，不重做已关闭的选择复用修补。

## D1 固定输入与准确源码清单

保留当前历史，合并上述 main 检查点，记录实际 HEAD、base、dirty 与 owned-path 差异。
核对 launcher 完整 lib/bin、portability exports/config、build/stage/freeze 的依赖，根配置差异交 main 处理。
重新生成实际 source closure；旧清单 source58ae294 有一个后来修改的 nonempty helper 哈希，不能直接称当前完整证明。
清单包含每个实际文件的 SHA/bytes/source，以及 Node24.21、ABI137、SQLite3.53.4 和 workspace 依赖。
验收：全部列出的文件逐一匹配；缺项、哈希不符或源码 dirty 必须明示，不重标历史 manifest。
文档专用变更不触发新冻结，a9b/595/e4e/ee 与全部旧 tar 保留。

## D2 关闭验证工具的异常资源清理缺口

优先处理 `verify-same-store-dual-personal.mjs`：两次 detached spawn 只有正常路径 stop，finally 直接删根的问题。
每个出生资源记录独立 PID/start/UID/root/config/operation，覆盖 launcher/API/console/子资源；共享 install 路径不能证明所有权。
把停止与私有材料处置放到可靠 finally；只有完整证明归属与停止后才删除可清理材料。
归属、发现、停止或残留任一 UNKNOWN 时，保留受限私有根与诊断，返回明确失败，不把 UNKNOWN 改成空集合。
同类 owned 验证工具也审查，避免另一个 happy-path stop 漏洞继续阻断使用。
验收先用 injected pure controls：完整自有 positive、外来资源拒绝、start不符、未知资源、清理失败与重复finally。

## D3 故障窗口与第一个可运行里程碑

在 seed 启动后、review 启动后、候选读取失败、断言失败和 stop 超时处分别有界注入。
每个故障以自己的全新 private roots/resources运行，先独立证明出生身份；不运行旧用户服务或依赖全局 socket 搜索。
验证成功清理精确关闭资源；不明停止必须保留材料且报告失败；原 B 数据目录只读、不被删改。
为父进程退出/信号后的归属记录与恢复清理提供有限流程，不以递归删除目录替代停止确认。
第一里程碑交安全可运行的验证入口、故障矩阵、更新后的准确 closure 与最小调用 recipe。
发布源码后继续 D4–D10，不等 E 结论才开展独立工作。

## D4 消费主线完整发行与命令可发现性

直接消费 main8c8fdef 的71文件普通集成，维护相同依赖闭包；main不需要等E最终结论才提供源码。
核对 `pa --help`、`pa help`、具体命令帮助与报错中的 `review-restored` 可发现性，保留既有参数与退出码约定。
帮助应让用户找到 prepare/start/reopen 操作，重复 `--project` 等实际支持的参数必须一致。
新增或改动帮助只测试对应 CLI 解析/路由；不要为这一步重复 broad live 安装矩阵。
验收：源码与 staged 包的帮助一致，不因帮助命令创建 state、credentials、队列或运行进程。
根 scripts/lock 需求提交 main，不越权更新根文件或借旧 E 报告认证新 main。

## D5 接入 A 数据与 C 的单一流程驱动

消费 A 的原始业务持久事实配方及 C 的统一参数化驱动，明确 producer source、Store、Work/question/answer/attempt/result 身份。
在同一真实 Store 中产生原 Broker/Work/answer/native_applied 与 SDK/context/candidates，不手写 SQL 代替产品动作。
原数据目录保持只读；复制、备份与恢复必须有可追溯数据来源，不从某个 Work 存在推断所有原问题恢复。
驱动参数包含 install 根、producer 身份、新 private root 与格式；包内入口不可由 checkout 的缺失实现补齐。
若 A/C 尚未交可运行接口，只阻该项，先继续 D4/D8/D9；交准确缺项而非第二份私有驱动或 ledger。
验收：记录实际生成与读取的稳定 ID、状态与回执，并能独立重放有限流程。

## D6 两格式实际恢复与包内读取

对默认 workflow-snapshot/evidence1 和显式2实际 create/verify/restore 到第二根，不能只数 readWorkflowEvidence 的 family。
包内 prepare/start 完成未选择403、明确选择后 candidate/history/frozen body200，Work及原Q&A/result身份与生产数据一致。
检查旧队列 held、业务422、provider不增与无重发；fixture、normal、recovered、vendor范围分别记录。
合法新签窄路径/增加排除后保持正文拒绝与失效状态；重复选择 REUSED 需原PID/start及实际health身份一致。
实际含712时才测试 `scopeReview=1` 的 reasons/partial/withheldSourceCount/authorization，默认 response不加field。
第二里程碑交真实双格式同数据流程与准确包内 consumer/hash；不把后续诊断反贴595。

## D7 冻结必要的准确候选并早交 E

优先给 E 完整不可变 a9b 输入；若本包引入必要运行字节变化，再基于准确 clean main集成后继冻结。
记录 source/build/tarSHA/bytes/schema/platform/ABI/Node/SQLite、完整 file/link closure 和真实 producer/consumer来源。
冻结与 E 最终验收有顺序：先给准确字节，E再做最终结论；不要求先有E绿灯才冻结候选。
给 E 可独立执行的私有 roots、参数、入口哈希、数据 recipe及已知未达范围，不交可重写的候选路径。
验收：从 tar 重新读取的 tuple/hash与交接一致，必要能力确实在包内，旧 a9b与旧595不被覆盖或改名。
docs-only HEAD 不重冻，目标授权/B恢复/研究阻断不阻普通安装。

## D8 普通安装、升级与数据保护

在已关闭安全清理后，以准确候选执行有界 cold/reuse/no-executor/multi-state，覆盖不同选择/端口/配置拒绝。
按真实安全旧包做同schema升级与16→18，验证 exit/status/pointer/operation/data与完整资源集合一致。
未知活资源拒绝升级/回滚；保留升级后新增数据，不用旧备份覆盖新数据以制造rollback通过。
先选择有限的已知故障窗口；新增窗口必须有完整正对照和准确归属，不无限重复历史全矩阵。
验收结果绑定同一候选 tuple、实际运行入口与数据来源，跨机器/跨ABI未测如实列出。
不得把普通个人读取准入外推到 native恢复、私有许可或target activation。

## D9 重开、支持包与内部可用交接

给出包内 prepare/start/reuse/refusal/reprepare/reopen 的最短可运行流程与准确用户可见错误。
完成有限 SSE、并发只读、刷新/重开和资源归还；短序列不称长期soak，重开不重新发送旧完成请求。
support输出脱敏、私有0600、拒绝覆盖；不能包含模型key、原生credential或可执行旧授权。
失败时保留必要受限诊断和可验证 ownership，用户服务及原数据完全不作为清理对象。
验收：同一包可由 E在另一私有根独立运行；每个结论有原始命令/退出码/consumer/provenance。
外部依赖未到继续文案/帮助/离线闭包和失败恢复，不另造确认权威。

## D10 最终源码与第三个结果里程碑

交更新状态、准确closure、可运行同包驱动、稳定候选与有限故障结果，逐项标 PASS/FAIL/NOT_REACHED及原因。
第三里程碑必须覆盖完整ordinary/review交付与资源处置；E最终尚未到只标E待验，不自授发布权。
只提交拥有路径并推原 origin 分支；保留 main整合边界、旧源码/tar/报告和历史scope，不推upstream。
整包goal未达就继续独立队列；检查点不是暂停点，不用测试数替代真实出口或声称full product完成。
真实 vendor/model/native均0；B cap4 UNKNOWN不可花；E pilot24turn/200000token/USD5/单在途BLOCKED，不reset/refund。
十二组5180/8796至5191/8807、全部state/profile/tar/ledger保持，不新Driver/CAC/桌面/自动接受/动态DAG。

## 独立备选队列

A/C单一driver未到：先完成安全finally、故障注入、帮助、闭包与支持包，不复制一套数据权威。
E最终未到：先交不可变输入后继续独立源码/有界可用性，不反复重冻相同运行字节。
B/native/private/target未到：只阻对应能力，普通个人安装和历史只读审阅继续，绝不借旧回执解锁执行。
