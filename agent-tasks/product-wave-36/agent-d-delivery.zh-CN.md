# D：完整 installed 使用与可维护发行子系统

2026-11-17。继续 `/Users/hh/Desktop/joker/superagent-agent-d`，原分支 `codex/g3-local-distribution`。
先读 AGENTS、START-HERE、product-spec/README 和 [本轮 README](README.zh-CN.md)。
读 [0092 主线历史消费者](../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)。
读 [0093 本轮验收架构](../../docs/rfcs/WP-16/0093-wave-36-reviewed-architecture.md)。
读 [0094 完整子系统闭环](../../docs/rfcs/WP-16/0094-wave-36-whole-subsystem-closures.md)。
建立或延续一个 whole-subsystem goal，持续覆盖下面四个更大的端到端产品闭环。
聚合并延续旧九成果，扩到生产实现、默认consumer、同版本重复使用和维护交付，不再9→12堆阶段。
source早、中、晚发布后继续所有闭环、联调和独立队列，不逐fix等待派工。
不承诺工时、时长、同日完成或token；source-ready、一次green或一次包装不是结束条件。

## 准确输入与已交范围

- D固定输入 `397332d55799784cf676dba41e6c570f66d91db0`，保留全部dirty/history/data/ledger。
- W33 `048f/f880/46e` 是E已经真实测到outer/recovery/upgrade子集的固定旧cohort。
- W35 source `edfe5e14f2f8fbc7f395a84520c781c7f07ce9e7`，build `599de3e98c02de0b`。
- inner SHA `11027a375848c25c2d2ae8e18755f65fa77272db533dcee7bb9ff27ba8ba50db`，20598155字节。
- actual inner在 `/tmp/w35art/wave35-target-599de3e.tar.gz`；交接用实际位置，不猜永久目录。
- outer SHA `39c0fff0e13d61c59198f8a55f0ed692b887194aaa4e2782b2b3e9cbd623f6c5`，63536701字节。
- outer永久路径为 `/Users/hh/Desktop/joker/pa-artifacts/wave35-preview-599de3e/PersonalAgent-Preview-599de3e.zip`。
- 6883inner/6891outer库存、CRC、Node/LICENSE、真实GUI与launcherfix字节已独立核对。
- 主线verifier已显式接纳旧8de31和新339bd两份已审wrapper，W35实际VERIFIED_STATIC。
- 不再把allowlist滞后称D包漂移，也不重做Nodewrapper或重冻相同字节。
- D已交installed模型保存/权限拒绝、不同alpha/beta项目受控Work及数据读取，保留PASS_SCOPE。
- alpha/beta目前是同state上两次单项目runtime、同fixture profile/check，不是默认双原项目全链。
- E仍实测R1基础+W33子集，336PASS/21NT、普通204/功能205，不能贴为W35独立通过。
- 当前W35 raw `upgrade.json` 是BLOCKED，不得借旧W33原成功rollback认证W35 CONFIRMED。
- main正在接新的completion history；准确source发布后才消费，不把ContextHistory当Work历史。

只拥有 `apps/launcher/`、`packages/portability/`、`tools/distribution/`。
main拥有共享contracts/config/lock/HTTP/provider/App/transport/bootstrap集成；A独占生产迁移。
E独占required/assertions/oracle，D不改E gate，不造第二安装器、daemon、review或业务账本。
状态写 `tools/distribution/reports/wave36-status.json`，按四闭环/actualsubject/source分层。

## 产品闭环一：准确当前安装的双原项目与配置日常

完整出口：同一个准确安装实例配置后，能反复处理两个原项目的需求、委托、检查、接受与重开。
将旧模型配置、原项目、实例隔离和多次使用合为一个用户产品，不分别交几个按钮或helper。
actual consumer是选定包的原App/模型配置POST/项目登记/preview/form/Application/verification/Workreader。

- 保留W35模型GUI真实save1、0600、secret不回显、0command/0model的已证范围。
- 配置保存只校验与持久化，configured/连接实测/native admission分开，HTTP需明确同意。
- 使用用户自己显式选定文件，不能复制作者key/auth/HOME/native session或覆盖旧配置。
- 同版本的private设置、允许模型切换、坏格式/链接/宽权限拒绝、重开状态要形成完整路径。
- 已入包的8cd目录竞争修复继续验证，不用旧EEXIST重试记录冒称W33也已修复。
- 同一实例公开两个真实registeredroot和不同project ID；不靠轮换两个单项目factory凑并行产品。
- draft必须真正可应用，apply只预填，编辑后明确create，checks/profile/Scope与服务端字段一致。
- 两个原Work的合同、attempt、候选和人工接受属于对应项目，不能统一落project-atlas。
- 等available accept及原verification ready；保持机器FAIL/trustedreview/resourcebarrier，不另建review。
- selected-project7/30、工作/会话返回与原Work重开要来自对应项目，不借open200充scoped403。
- 原candidate/accepted/history与所有引用artifact bytes保持，不能换ID重建旧工作来补洞。
- 已有alpha/beta受控数据是合法基础，向默认consumer扩展时scope要明确，不抹其真进展。
- 原模式没有多项目dispatch/applicability时给main最小接口依赖，不用fixture越权或新Driver绕过。
- 同tuple重复打开复用，不同build/root/config/模式/端口明确拒绝，不能抢旧实例。
- 显式private roots消费缺失时给main约定，不重设HOME或借旧十二实例state做验证。
- 必要negative从合法正向派生，覆盖配置变化、取消、迟到、unknown原ID重试、机器FAIL和错项目。

实现交接：先交可编译source和真实公开consumer，main/F/J/E按ownership联调，不等十枝齐交。
验收交接：同cohort准确entry/hash/命令exit、两项目原IDs/bytes与独立正负，不只“可启动”。
source早发布后继续其他闭环；共享原项目入口HELD只阻该面，不停止独立配置/兼容工作。

## 产品闭环二：真实非空持久数据、恢复与当前target管理操作

完整出口：真实使用增长的数据可以备份、搬根、授权只读、升级/回退，并保留原身份和新写入。
将旧nonempty/readonly/upgrade/rollback作为一条持续业务生命周期，不重复交已证非空或空库smoke。
actual consumer是原业务链、所选安装的backup/verify/restore/upgrade/journal/pointer及授权reader。

- 保留W33两Work/两accepted/36artifact、八引用bytes和旧成功rollback receipt/exit0。
- W35读取/备份旧W33数据证明兼容；W35-born alpha/beta数据和旧数据分别记录，不混source。
- 在同cohort正常新增业务后重复备份，记录每个snapshot的原游标、manifest和artifact graph。
- 所有引用bytes逐项核，不只前三个样本或总digest；错误counter不列Work不能抹已证实际行。
- 原CLI使用backup --out、verify-backup --bundle、restore --bundle --to，输出/目标不覆盖。
- 新根必须readonly，不继承执行grant/认证/session，不消费旧queue，不自动运行target。
- ordinary候选投影review200/write422已有真实证据，保留其准确metadata范围。
- 更强原Work/来源正文读取需原principal/project/message/Scope授权；Store直读和HTTP允许分层。
- 有真实pending/effect原行才验held/no-resend，不能用停机后历史question声称活动native continuation。
- v1/v2 workflow、personal bundle和安装tuple分协议核对，不能改标签或忽略family凑兼容。
- W35当前raw upgrade BLOCKED要保留；若重试成功另交该target原receipt/exit/operation/pointer/data。
- 没有W35成功回执就诚实HELD，不能拿W33原成功或W35 reader可读充管理切换完成。
- baseline-origin业务、升级后新写入、回退后内容都由真实版本读取，不用旧快照覆盖新写入。
- binary rollback、数据恢复和A生产migration分别处理，不降schema，不私造迁移/授权表。
- wrongtarget/ABI/health、活跃state、未知资源、缺/改artifact、错误映射和未来schema保持拒绝。
- 不杀外围shell、不删record、不globaldiscovery或substring认领进程来绕原资源guard。
- 任何资源query失败/超时都UNKNOWN；借工具时也必须全set fresh，不把没有观察当没有child。

实现交接：参数化真实数据producer/reader与同版本管理入口，必要公共read接口给main/A/C精确输入。
验收交接：原raw成功与失败、前后pointer/tuple/业务IDs/全bytes及资源观察完整可重做。
共享授权或生产迁移缺项只阻该项，继续格式、registry、产物与重复使用的数据保护。

## 产品闭环三：Mac M同事搬迁、独立私有配置与可维护运行

完整出口：同事用自己的Mac M、目录、工具和配置操作当前产品，出错能安全保留并自行诊断。
聚合可搬迁发行、配置安全、支持、兼容和反复使用，不再交一个作者机器专属临时ZIP。
actual consumer是现有outer/bundledNode/原CLI、main显式root与配置入口、原status/doctor/support。

- 保留正确Node/完整LICENSE/依赖许可，outer不含运行state、账号目录、key、native profile或旧grant。
- 原包放固定位置，空格/中文/移动后的identity和权限核对仍正确，运行时不偷偷迁移旧state。
- 打开工作台无需全局Node，不等于开发任意Git/npm/pnpm项目不需要自己的工具与依赖。
- 模型配置与开发执行器认证分开；版本不符/认证缺失明确退化，不真CLI fallback或复制账号。
- 同事自己的配置保存、更换/撤销、旧接口/无配置、权限拒绝和重开要实际可操作。
- 未签名/未公证、组织安全策略现实写清，不自动更改系统策略或替用户安装/升级全局工具。
- 同机copy、不同用户、第二台Mac、其它平台和长期稳定分别测或未达，不能互相借scope。
- 多实例隔离、端口冲突、旧包并存、不可用执行器和坏配置负向保持无覆盖、无泄密。
- UNKNOWN整份install/state/model/config资料保留，产品拒绝和工具cleanup结果分别呈现。
- support新路径0600/白名单/no-overwrite，保留具体错误、unknown和operation，不读其他账号文件。
- 用户操作、fixture、SDKmock、native与研究收益分层；自动vendor/model/native仍0。
- 失败复现要能回到准确source/安装/输入，不把作者/tmp目录或隐式HOME变成运行依赖。

实现交接：实际consumer、平台/许可/权限/维护recipe和明确失败保留policy。
验收交接：合法同事式使用positive及必要独立negative，跨机等外部依赖不阻本机维护队列。
source中期发布后继续全部闭环，不把这条当一次安装演示完成整个goal。

## 产品闭环四：唯一closure、可信runtimeidentity与稳定版本独立交付

完整出口：source、构建、运行、产品能力和E结论可以对应到一个稳定不可变版本，并可持续维护。
将manifest/sourceclosure/identity/support/后继handoff合并，不增加平行数字权威或第二安装器。
actual consumer是原build/stage/freeze、main静态verifier、当前运行启动身份和E固定cohort loader。

- W35实际包/CRC/库存/新wrapper已独立静态通过；主allowlist已修，不再重派旧阻断。
- 保留旧8de31与新339bd已审hash，actual必须等于声明且受明确allowlist约束，不能由manifest自授。
- current canonical192已列路径hash真通过，但新ModelConnectionForm/model-connection来源未列入该清单。
- 以实际生产依赖图完善新GUI source集合，或准确标成selected audit set；不把192当硬目标凑数。
- full runtime库存、source集合、编译sourcemap、声明身份、正在执行与实际能力consumer是不同事实。
- source/dirty/build/inner/outer/hash/bytes/schema/ABI/entry/license一起绑定，不能只拿GitHEAD当运行版本。
- W35tar真实位置仍在/tmp，稳定交接需准确持久化已有字节/位置与sidecars，不因整理重冻新tar。
- E当前仍锁W33，W35需要其准确新subset独立验收；204/205 mixedtier不能重贴W35全套。
- main的新completion-history待真实source发布后才消费，旧ContextHistory不是原Work history。
- 只有真实runtime被选入组合才形成必要后继，docs/tests/清单报告修正不refreeze。
- 当前W33/W35与必要新历史consumer后继分别保留tuple，E一次锁一份，不追movingmain。
- D只交产品实现/材料，不改E assertions；main共享root/contracts/HTTP/App接线不由D越权。
- cross-artifact/陈旧consumer/错误source或entry/外链等独立negative必须真拒。
- 发布稳定source、实际默认consumer与完整材料后继续其他闭环/独立维护，不在handoff停工。

验收：main/E能从唯一事实源使用准确当前产品，后继也有清晰差异、真实能力和独立结论。
晚期交接：四闭环的source、实际consumer、正负/raw/tuple、维护说明和真实余项，不以PASS总数涨分。

## 全goal的独立队列、预算与保留

每闭环都要有生产实现→默认consumer→同版本正负→维护/交接，不拆成更多fix阶段。
外部依赖只阻相应scope；先交最小可编译约定与owner复现，继续其它已授权工程。
只交source记SOURCE_READY；无真实原项目/安装/数据positive记NOT_REACHED，不用PARTIAL停整线。
自动vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5pilot仍BLOCKED。
不reset/top-up/refund/补样/价格研究，不把用户后来主动使用算入本轮自动验收。
保留全部state/profile/archive/ledger/history/dirty/runs/五日志及十二5180/8796至5191/8807实例。
仅完整独立birth/PID/start/UID/fullargv/root/config/op/fullset可入自有处置；全set先验、逐signal fresh。
任何query/身份/集合未知均retain；禁止globaldiscovery/forcecleanup/路径认领/借凭据/未知删除。
不新增Driver/CAC/subteam/桌面壳/自动接受/writer racing/动态DAG/第二review或生命周期/账本。
只提交显式owned路径到原origin，不upstream/reset，不回滚用户或其他Agent内容。
一个whole-subsystem goal持续所有四闭环和可做的独立队列；发布与阶段绿灯不是终点。
