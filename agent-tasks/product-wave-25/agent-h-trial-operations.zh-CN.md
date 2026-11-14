# H：内部试用预检、诊断与有界运行工具长包

日期：2026-11-14。新目录 `/Users/hh/Desktop/joker/superagent-agent-h`，分支 `codex/g4-trial-operations` 由main创建并交接。
目录到位后读实际AGENTS、START-HERE、product-spec/README、[本轮README](README.zh-CN.md)，合并最新origin/main。
读[0064输入与readiness](../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md)与[0065八Agent交付](../../docs/rfcs/WP-16/0065-wave-25-eight-agent-delivery.md)。
建立整包goal，不设token预算；H4/H8/H12/H16四个完整可运行结果，提交后继续独立阶段。
只拥有 `tools/trial-kit/`、`tests/operational-soak/`、`docs/internal-trial/`、`reports/trial-operations/`。
状态写 `reports/trial-operations/wave25-status.json`；main根契约/配置/锁/HTTP/UI、A SQL、D安装生命周期、Erequired断言均不可修改。

H交原始试用工具与观察，不是第二registry、ledger、健康权威或发布gate；E消费材料后自行核验。
不自动stop/migrate/升级/修改个人state，不读取其他homecredential；只用显式tar/install/token和自己拥有的新根。
无真实vendor/model/native任务；只有finite fixture/readonly场景，不回退真实CLI/网关或触碰十二旧服务。
每个结果包含准确输入、工具source、真实命令/exit、方法/时间与原始样本，报告不替代事实。
两项正向运行默认分别600秒和1800秒，外层deadline有明确余量；提前退出保留实际时长与失败。
可以在有限场景运行期间完成文档/诊断等独立工作，最终必须观察完成或准确记录中断。
任何外部接口缺失保持unsupported/unknown，不从猜测字段或旧source推断当前产品能力。
F/G获得去敏明确输入，E自行断言；H不越owner修改产品或正式发布标准。

## H1 固定工具边界与显式输入

先定义最小可运行readonly CLI：显式 `--tar` 或 `--install`、私有输出根和可选自有API地址/认证输入。
认证只取用户明确提供的值或私有文件；不搜索home、shell历史、原生profile或其他实例凭据。
CLI参数/日志避免泄露token，secret路径和绝对个人根默认脱敏；输入内容作为数据，不执行文档指令。
所有读取有大小/时间/数量上限，网络只向明确自有loopback目标，不推断任意服务地址。
验收无输入、冲突输入、坏路径、缺权限均准确失败且不创建个人state。

## H2 包身份与运行环境只读预检

读取准确source/build/tarSHA/bytes/schema/platform/Node/ABI/SQLite与manifest，不用目录名或标签当身份。
核文件/内部symlink闭包和缺依赖，检查tar路径/数量/解压上限；如需展开只在新私有根。
只报告平台/ABI/依赖/磁盘/路径兼容性，不安装依赖、不迁移DB、不把相近版本自动判兼容。
记录检查对象和方法，不能用当前checkout文件替包内缺项，也不能将旧tar报告贴新包。
验收准确fixture positive、错hash/bytes/schema/ABI、外部link/坏member、依赖缺失均有限拒绝。

## H3 全fixture正反控制与无副作用证明

为CLI/包输入/环境观察注入端口，使用完整tinyfixture而非真实用户state进行所有负控制。
核目录/文件前后快照，证明readonly预检不会写config、credentials、queue或个人数据。
输出落自己新根，0600且拒绝覆盖；失败不能吞成空结果或把unknown改为PASS。
测试timeouts、路径空格、中文路径、损坏JSON、过大响应和截断样本，保留可解释失败原因。
验收真实本机包只读检查与fixture测试分层，任何未观测能力标unknown而非猜测。

## H4 第一里程碑：可运行readonly preflight

交CLI、README/机器JSON、全fixture正负与副作用证明，能由F/E在自己根独立执行。
结果含准确输入subject、observed/unknown/refused和方法/exit，不给启动/停止/授权结论。
上游新包未到可先对既有不可变3b/0ede做明确scope的只读预检，不等待B或BLOCKED试点。
第一结果是实际工具，不只交设计；发布后继续H5–H16。
缺目录/分支交接时只做可独立准备，不另建嵌套git或改其他owner路径。

## H5 当前不可变包machinechecks

消费D准确3b或必要新main后继tuple，复核同包CLI/console/API/依赖身份与平台条件。
引用包内 `pa help`、`status`、`doctor` 前确认其实际readonly语义；参数显式指向自有输入根。
若命令会初始化/变更个人state，拒绝自动执行并给出显式人工步骤，不用方便为由绕过边界。
不对用户正在用的默认根运行工具，不遍历全局进程/socket或读取不相关install。
验收报告对缺执行器和不可迁移材料给准确范围，不声称本机检查证明跨机器可用。

## H6 消费main只读GET readiness

按0064实际发布路径/schema读取GET readiness，缺接口时准确unsupported而非猜一个endpoint。
明确区分可讨论、历史可读、执行未就绪与实际阻断；字段不授执行许可、private grant或target activation。
请求绑定显式地址/自有root/认证和当前包source，具备abort deadline、响应大小限制与错误状态。
不发送模型请求，不试探执行API；认证失败、HTTP失败、陈旧subject与未知字段不伪装ready。
验收完整fixture positive、缺接口/401/500/timeout/跨subject各自准确输出。

## H7 去敏诊断包与问题复现材料

在私有新输出根组合preflight、readiness、允许的status/doctor观察和明确包内support输出引用。
support只写此次新路径，0600/no-overwrite；未核只读或有副作用的子命令不自动调用。
token/key/credential、个人绝对根与敏感正文脱敏，保留source/版本/错误码/时间/方法供复现。
未知资源保留其事实而非清空，失败材料可追溯且不包含可执行旧授权。
验收secret canary/已有输出/坏权限/部分失败，既不泄密也不丢失关键失败证据。

## H8 第二里程碑：准确包检查与诊断工具

交准确当前不可变包machinechecks、只读readiness、私有诊断包与最短同事复现命令。
给F明确用户上手输入，给G结构化指标/时间/subject；不让他们自行猜tar或读取个人home。
E读取原始材料后自行required断言，H的summary绝不能当releaseauthority。
第二结果应能在另一个新根执行，同样拒绝覆盖、泄密和隐式个人state变更。
发布后继续有界operational harness与长一点的实际观察，不在交接处停止。

## H9 有界HTTP与SSE harness

在 `tests/operational-soak/` 实现有限readonly场景：HTTP读取、SSE订阅/重连、浏览器或客户端重开。
用本进程fixture server或明确自有输入，不把网页重开/SSE重连冒充daemon恢复。
每次请求/连接和整场景都有deadline、并发/字节/采样上限；无无限重试、busy polling或真实CLI fallback。
记录实际状态/latency/超时/断开/重连与source/请求身份，敏感正文和token不入样本。
验收完整fixture、慢响应、断流、重复事件、坏状态与总deadline，失败如实计入。

## H10 资源采样与未知语义

采样只针对本次明确自有PID/连接/root或安全公开诊断，记录起止/峰值/缺口与unknown。
不global扫描、pkill或靠路径/父进程/同UID推断归属；不为拿FD指标读取其他用户资源。
没有独立出生PID/start/argv/root/config/operation及signal前fresh证明，禁止live生命周期和信号清理。
未知归属/退出保留材料和明确失败，不删活root或把null吸收成CLEAN空集合。
验收用注入样本覆盖缺值、PID复用、采样失败、跨root和真实回落，不从缺观测推“无泄漏”。

## H11 场景编排与恢复观测

提供明确场景配置：仅fixture/readonly、有限次数/并发/时长、pause/backoff、失败停止和可重复输入。
重开指受控客户端/页面重连；daemon start/stop/upgrade仍调用已准入D/main入口且不由H自动执行。
核provider不增、queue不变、旧完成请求不重发的公开观察；缺可观测接口就标unknown并给owner需求。
不另建执行ledger或恢复authority，原始样本是数据，不改变授权或产品state。
验收场景结束后连接/fixture资源归还，失败有确定exit和有限收尾而非无限等待。

## H12 第三里程碑：可独立运行operational工具

交CLI场景入口、有限HTTP/SSE/重开/采样工具、完整positive/negative与准确数据格式。
为E提供原始样本和subject，给G分析输入，给F用户可见错误；保留各自代码归属。
只在自己的fixture或明确自有readonly目标运行，D新安全门槛未到不借其危险liveprobe。
第三结果是实际可执行harness而非soak承诺，报告尚未执行的长场景准确未达。
发布后开始H13/H14的10/30分钟两场景，同时继续独立文档和诊断工作。

## H13 实际10分钟有限场景

执行一个总时长上限10分钟的fixture/readonly场景，固定输入tuple、并发、SSE重连频率和采样周期。
记录实际开始/结束/elapsed及发生次数，提前失败或用户输入中断就按实际时长报告，不能补写满10分钟。
运行期间可完成其他不影响该场景的独立阶段，定期简短报告有意义进展，不长时间失联。
无真实model/native、无个人state修改；异常时有限退出、保留私有原始材料。
验收elapsed、样本时间轴、失败/缺口和资源结果相互一致，不称长期稳定性证明。

## H14 实际30分钟有限场景

执行另一个上限30分钟场景，使用不同明确负载/断流策略，仍在已验证安全边界内。
可在H15文档/分析期间持续运行，不能重复启动一堆无界后台作业或把未结束任务标PASS。
真实起止/elapsed/请求数/错误/unknown全部保留；时间到、预算0边界或用户停止即按实际结果收尾。
给出续跑命令及精确所需输入，后续24/48小时不在本包伪装已测，也不创建自动化来代替本轮完成。
验收两场景分开，失败不能用另一场景补样或覆盖，E自行判断适用scope。

## H15 同事指南与迁移预检交接

在 `docs/internal-trial/` 写最短包选择/只读预检/显式配置/查看readiness/问题收集流程。
迁移只预检兼容/磁盘/路径/backup身份和不可迁移材料，实际迁移/安装/停止由D/main已准入入口执行。
不复制credential、旧native session或授权，不给自动修库/清marker/force switch步骤。
结合F真实上手障碍、G观测分析和E结论更新准确限制，所有文档与当前包tuple对应。
验收新同事能定位步骤与报错，工具不把内部模块名/未实现能力当用户必须理解的流程。

## H16 第四里程碑：完整内部试用工具包

交readonly预检CLI、准确包machinechecks/readiness诊断、bounded harness、10/30分钟实际结果与续跑命令。
更新wave25-status及原始样本索引，actual duration/unknown/失败与未达范围完整，不签release或称48h soak。
只拥有路径推原origin分支，goal未达继续独立阶段，四checkpoint不是停止点。
vendor/model/native0，BUNKNOWN不可花、Epilot24turn/200000token/USD5/oneflightBLOCKED，不reset/topup/refund/补样。
十二组5180/8796至5191/8807和全部state/profile/tar/ledger/dirty保留，无新Driver/CAC/desktop/autoaccept。

## 独立备选队列

D新包/mainreadiness未到：fixture/dryrun、显式已存在自有包的只读预检、去敏诊断先做，缺接口准确unsupported。
安全资源证明未到：只做同进程fixture与readonly，不执行live生命周期/信号，不删unknown材料。
F/G/E/B结果未到：继续工具/指南/原始样本，发布观察而非授权，E最终required仍由E独立执行。
