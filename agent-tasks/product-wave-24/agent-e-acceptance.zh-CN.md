# E：不可降级的证据门槛与最新同包用户验收

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-e`、`codex/g3-product-acceptance`。
合并最新origin/main，先读实际AGENTS、START-HERE、product-spec/README与[本轮说明](README.zh-CN.md)。
同时读 [UI检查点0062](../../docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md) 与[验收及交付0063](../../docs/rfcs/WP-16/0063-wave-24-admission-and-product-closure.md)。
建立或沿用覆盖整包的goal，不设token预算；三个可运行里程碑后继续独立阶段。
仅拥有 `tests/product-acceptance/` 的独立断言/工具/证据，状态写 `tests/product-acceptance/reports/wave24-status.json`，生产/root/锁/HTTP/UI归main，迁移归A。
保留原目录/分支、全部dirty与历史runs、source/tar/ledger，不以清目录制造clean或刷新预算。

旧四missing/contradiction gate已独立4/4关闭，不再补派这些已修问题。
准确a9b208PASS/0FAIL/15NT与162required普通范围、595历史完整161required、真实consumer哈希和foreign拒绝均保留。
0ede及最新main UI字节另需准确同包结论；ordinary installed通过不代表native/fullproduct/value通过。

## E1 固定完整真实正对照与新门槛范围

固定当前HEAD、原a9b完整run及595历史完整scope，记录测试源码/checkedAt/包tuple与全部required。
当前a9b正对照使用完整162required；595按当时161required重验，只排后来新增的诊断项，不削减旧安全/controlled集。
四项旧反例可直接引用已过独立结果，新增变异仍须先有完整真实positive，不合成whole green。
把module/controlled/ordinary-installed/recovered/native/value分开，真实完整旧观察不因新工具校验缺口而抹掉。
验收：正对照在记录时间内通过，当前复验时间与旧运行时间分列，不把历史报告伪装新run。
本包优先收两个残留例外与真实新包，不重复全部旧测试凑数量。

## E2 能力例外必须绑定不可变产品事实

修已支持digest的a9b可自报packageDigestSupported=false/digestScope跳过观察的缺口。
能力支持来自准确不可变subject的可信事实/实际包内能力，不能由同一待验evidence自行降级required。
已支持包必须提供原healthDigest与复用后sameDigest；删字段、显式false、伪造unsupported均准确拒绝。
真实不支持的历史包可保留限定scope，但要有独立来源与明确适用subject，不能泛用到当前包。
只改验收工具，不在E新建生产capability registry或要求D篡改运行时来满足旧断言。
验收：真实a9b完整positive后，缺字段、自报unsupported、跨包能力事实各自单独拒绝。
必要公共能力契约需求交main，接口未到先保留严格拒绝，不自动采用宽松fallback。

## E3 scopeReview严格消费公共schema

使用实际共享DTO/schema或等价完整验证，拒绝负withheldSourceCount、非安全整数、越界计数与错误null/缺失语义。
验证protocol、authorization none、partial、有限且有效的distinct reasons与状态一致性，不只检查数组存在。
默认response不加诊断字段；仅合法opt-in返回诊断，重复/非法query与不支持组合准确拒绝。
未知计数允许协议定义的null，不从缺数据估0；diagnostic从不成为授权或正文可读证明。
对真实完整a9b报告分别单改负数、越界、错误reason/重复reason、authorization和缺字段，准确拒绝。
第一里程碑交完整positive、能力降级反例、公共schema变异与必要tuple/consumer必填控制。
发布可运行工具后继续E4–E10，不等待新UI包才修自己的独立门槛。

## E4 准确target与包内consumer字节

优先验证D不可变0ede11d/build1eb8733c8b1729bc/sha d0398897...；必要main后继出现则按其新tuple独立测。
每required绑定source/tarSHA/bytes/build/schema/platform/ABI/mode/operation，producer/数据subject/consumer分别记录。
从实际tar读取consumerentry/fileSHA/bytes，与canonical输入比较；缺field、来源origin或hash不符准确拒绝。
完整新target positive后，用真实另一包consumer替换单一输入验证拒绝，不只用随意字符串负例。
不能借checkout UI/API补目标包缺失实现，也不能把a9b报告改source贴0ede或新main。
验收冻结字节在最终E结论之前；docs-only不反复冻结，main交source不等E绿灯。

## E5 独立资源门槛与危险探针隔离

在D登记前窗口、精确child身份、完整token/root边界、信号前重读未独立通过前，不运行其live矩阵工具。
先用完全注入观察校准完整own positive、prerecord未知、childstart不符、sibling根、PID复用与重复finally。
缺记录/观察不明不得变成CLEAN空集合或删除state；UNKNOWN材料保留且结果失败。
需要真实资源时只创建本次private根，独立证明自己出生PID/start/UID/root/config/operation后才有有限清理权。
不以同父、同UID、共享install、路径前缀或字符串状态作为实际停止证明。
验收门槛通过后只扩必要新增窗口；D未到仅阻危险live项，安全字节/gate/UI准备继续。

## E6 最新UI与CLI的真实用户流程

只在实际包含最新0062检查点的同包字节上验来源诊断UI，记录console静态资源与API同一source。
通过界面查看来源状态、展开原因/遮蔽信息并核原文结果；不把后端返回成功当界面已显示。
合法新签窄路径/增加排除/失效后，界面与实际Scope/body/receipt守卫一致，不显示不应读取的正文。
默认普通读取保持原shape，诊断不开新授权；已知空/未知/失效状态有准确用户反馈，无实现细节泄露。
包内CLIhelp可找到review-restored/重复project/start/reopen；帮助不创建state、credentials、queue或daemon。
桌面与窄屏只覆盖实际变化表面，留截图、console错误和真实入口身份，不重做全站视觉审计。

## E7 同一原Store的两条独立snapshot恢复

消费A原producer/独立reader和C唯一有界、身份绑定的consumer，固定实际版本与数据source，不在E复制生产数据权威。
同一Store含原Broker Q/A、Work、attempt、native_applied及SDK候选；断言真实ID、字段、answer digest和关联。
默认workflow1与显式2分别create/verify并经真实consumer恢复到两个新目标根，不能只数family或比数据库SHA。
每条包内prepare/start均覆盖未选择403→选择后candidate/history/frozenbody200、业务422、queueheld、provider不增。
原完成请求不重发，原Q/A/result身份可独立读取；fixture、normal、recovered、vendor分层保存。
第二里程碑交准确新包UI/CLI与两根完整用户流程；缺真实接口准确NOT_REACHED，不手写SQL造结果。
开发驱动作为明确来源验收输入即可；实际产品consumer必须来自目标包，不能要求每个测试脚本都成为runtime。

## E8 普通安装、复用和升级

对准确候选在全新private根测有限cold/no-executor/multi-state，依赖外部B/native不阻这些ordinary流程。
same-file REUSED需原PID/start/实际health一致；不同选择、根、端口、登录必须观测明确拒绝且保持旧实例。
已支持能力不能降级成unsupported；拒绝项缺观察/未知终态/不同选择RUNNING均不得PASS。
安全旧包→候选与16→18核actualexit/status/pointer/operation/data；保留升级后写入，不用旧备份掩盖回滚问题。
每新窗口有合法positive、deadline和精确自有资源处置，危险旧路径仍mock，不无限扩live故障矩阵。
验收所有required贯穿同一candidate tuple；跨机器/跨ABI未测保持未测。

## E9 有界SSE、刷新、重开与资源归还

同包连续执行SSE读取、刷新、并发只读、stop后重新prepare/reopen，观察候选/来源/诊断与UI状态一致。
核旧queue和provider不增长、完成请求不重发、FD/连接/子进程归还到准确基线；未知资源不从集合删掉。
support脱敏/0600/拒绝覆盖，失败保留可追溯private材料；不读其他账户credential或扫描全局socket。
每场景和整组都有deadline，外部agent依赖只等待有限时间后转独立队列，不用长等待隐藏失败。
短序列不称长期soak，截图不代替网络/进程/数据事实；视觉范围只覆盖真实新UI。
验收记录实际动作/退出/来源/观察结果，case状态和细节矛盾必须拒绝。

## E10 第三个结果里程碑与分层required结论

第三里程碑交准确新包完整required结论、同包consumer绑定、两snapshot实际路径、UI/CLI及有界稳定性证据。
分别报告module/controlled/ordinary-installed/recovery/native/value，B/private/target/value未达只阻对应能力。
保留a9b208/0/15和162required、595历史161及旧e4e失败，不重标source或将部分positive称fullproduct。
更新完整wave24-status、可重复有限命令、失败归因与剩余风险；仅拥有路径推原origin分支。
wholegoal未达继续独立阶段；checkpoint不是停工点，测试数量与静态派工PASS不授release。
真实vendor/model/native0；BUNKNOWN不可花，Epilot24turn/200000token/USD5/oneflightBLOCKED，不reset/topup/refund/补样。
十二组5180/8796至5191/8807与全部state/profile/tar/ledger/dirty/runs保留，无新Driver/CAC/desktop/autoaccept。

## 独立备选队列

D安全工具未过：继续puregate、字节/provenance、准确UI准备，不执行危险live脚本或借用户进程清理。
main最新UI包未到：0ede准确普通范围先测；source可先交，变化运行字节freeze后才做最终新包结论。
A/C或B/private/target/value未到：安全ordinary安装/只读/有限可用性继续，缺项如实未达，不刷新模型预算。
