# 里程碑01：同一个原 Work 恢复到交付

2026-11-19续交。继续同一个里程碑，不新建wave。任务粒度扩大为同一个生命周期从实现到main采用、独立复验和收尾完成，不按单fix结束，不增加功能线。当前完整方案B不含CAC。

## 唯一产品出口

同一个原 Work 在协调器故障后，由原 Store/Application/QuestionBroker 接管，保留原 attempt/合同/问题/命令/原生会话；不重复 begin、不重发 UNKNOWN 业务效果；继续原检查、currentCandidate、显式人工接受到 delivered，并证明原2/4调度槽和完整资源安全归还。原生/物理证据未达时保持未达，不能用组件或虚拟资源补足。

**main端到端负责这个出口。** 当前主动仅main/B/H。D/E固定W36安装验收本项已结束，转按需待命；其余六位继续待命，没有原恢复的具体阻断不自行找维护任务或扩接口。

当前main **e2261ef5**（终态source83b3ece3）已有三种受控原Work故障窗口：原问题等待、原回答写出但resolution尚未返回、terminal事实已ACK但尚未交付；均同原ID/一次写到检查/接受/三产物重开。缺terminal receipt及原四拒绝对照保持。原receiver实际begin/answer body计数已断言，不仅用turn/start。40相关测试/strict过，物理reconcile仍只核对/停止。

本轮B真实Runner EOF/旧stdout关闭的fake-driver传输4PASS/1NT已在main entry复验；入口此前已有EPIPE处理，新增未使用wrapper不计默认产品修复。H单Work独立正例与正常关闭反例2PASS。原2/4容量现按原Store未ended绑定计数，UNKNOWN保留、另一Work自己的屏障释放后第3/5项前进两场景过，无新scheduler/ledger。

11-19验收：H的nextWork gap来自测试factory拒绝继任者为原排队Work首次spawn，生产已实际放行。main **6d309128**在自有integration消费者修正这一限制，原target仍禁止重spawn，累计Runner为capacity+1；按Work/currentCandidate/assignment绑定证据。2/4同run均完成owner退出→原Work检查/接受/三产物→目标自身槽归还→原第3/5项前进，UNKNOWN其他槽保留，42测试/strict通过。无需放松生产容量。[准确验收](../../reports/releases/recovery-milestone-01/admission-2026-11-19.json)、[H独立复现](../../reports/releases/recovery-milestone-01/h-admission-2026-11-19.json)。

主线已接入B postcommit组件并通过受控验证：原cancel/inspect→Store `confirmOwnedQuiescence` 提交→完整B manifest digest和同confirmationId finalize。B组件已直接strict、UDS纯负例和entry窗口通过；主线相关回归通过。剩余只有finalize响应丢失后的同ID调和、H消费者UNKNOWN材料清理和真实native/物理层。按[0095约定](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)继续同一个结果，不扩平台/队列/ledger。

## 已具备与先修缺口

- main `42f6daab` 已从真实 Native.launch 返回对象绑定三类callbacks，原HTTP Work问答→检查→人工接受→产物重开受控通过，撤销授权零效果；17+13测试/严格检查过。不是故障恢复、真实原生进程或原槽证明，见[0095](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)。
- B四文件控制已成套接入；旧自然terminal收尾/C同步superseded与digest/EqueryUNKNOWN修复成立，不重复派工。
- 已登记缺陷：B工具重登记第二snapshot刷新birth、I host误删借用父状态树、G错误entry/空argv仍晋级身份；D selected audit有5条旧hash。详见[验收](../../reports/releases/wave37-admission/README.zh-CN.md)。默认未采用的候选保持禁用，修复并非恢复主线前置；只有实际依赖需要采用时才激活对应修复。D来源报告更正直接服务当前固定包。
- C决定绑定的默认create接线仍未闭；它不成为本轮新增功能线，仅在原恢复确需时由main接。F/G/J不继续扩新面板、指标或模板。

## 分工与连续执行

| Owner | 当前投入 | 责任/触发条件 | 任务 |
| --- | --- | --- | --- |
| main | 主动 | 原Work业务接管到交付和原槽归还的整链 | [main](main.zh-CN.md) |
| B | 主动 | main原恢复consumer所需Runner/控制修复 | [B](agent-b.zh-CN.md) |
| H | 主动 | 同原Work故障链的独立实际消费者 | [H](agent-h.zh-CN.md) |
| D | 本项完成，按需 | 固定W36来源已纠；不重包不追main | [D](agent-d.zh-CN.md) |
| E | 本项完成，按需 | W36七项独立子集已验；待恢复consumer | [E](agent-e.zh-CN.md) |
| A | 按需 | 原恢复出现实际持久化/ACK缺口 | [A](agent-a.zh-CN.md) |
| C | 按需 | 原恢复出现实际来源/决定授权缺口 | [C](agent-c.zh-CN.md) |
| F | 按需 | 原恢复/固定包默认界面出现用户阻断 | [F](agent-f.zh-CN.md) |
| G | 按需 | 两条实际路径缺必要诊断；未用identity候选暂不修 | [G](agent-g.zh-CN.md) |
| I | 按需 | main/B原attach-channel出现通信阻断；未用host暂不修 | [I](agent-i.zh-CN.md) |
| J | 按需 | E/main原项目check/profile声明阻断当前验收 | [J](agent-j.zh-CN.md) |

沿用[原root/branch/ownership](../product-wave-36/dispatch.json)和[固定输入](workspaces.json)，不新建checkout/chat。[转发说明](forward-prompts.zh-CN.md)已改成主动/按需两种模式，不再让十位同时开整包。主动任务交source后持续解决当前consumer的集成/复验；没有剩余实际阻断即可待命。按需任务只接已复现的问题，完成该问题就交回，不扩独立队列；仅当它直接阻断出口时升级为主动。未向外部chat代发。

进度看三个可观察结果：①同原Work故障后业务继续；②该Work交付且原槽/资源归还；③固定包的独立结论。任务、接口、测试、文档数量不作为进度。若尚无结果且没有更具体的失败定位，先复盘同一路径，不加派新wave。交接只需最小source/命令结果/原ID/剩余缺口，不生成新的成套状态镜像。

## 固定安装 cohort

固定 **W36 source087a598e5b6f357bd2cc40556cbf693257febc66 / build14a6b457ea285988** 的本项验收已结束，Node24.21.0/ABI137/schema18/darwin-arm64。D199/199来源hash真修、归档字节不变；E七项同包case覆盖实际配置/非空恢复/受控检查接受/三kind点击。聚合354PASS/22NT、219ordinary/220functional不是全同W36，full221native仍拒。[准确范围](../../reports/releases/recovery-milestone-01/install-admission-2026-11-18.json)。

Inner：`/Users/hh/Desktop/joker/pa-artifacts/wave36-target/wave36-target-14a6b45.tar.gz`，20625055B，SHA256 `13798190ae43b28628eaf7131dfb8192bdb786b9bcfe4e1e0b6f9217ab33a8af`。
Outer：`/Users/hh/Desktop/joker/pa-artifacts/wave36-preview-14a6b45/PersonalAgent-Preview-14a6b45.zip`，63565262B，SHA256 `43e06d5bc7606e8283c1c5f58463f402018d4c9c9b223a2c7c021d429ccb8995`。

D/E此项结束待命，不为oracle残余或移动main继续扩队列。当前包不认证d624恢复source；只有主线选定稳定恢复版本或该包真实阻断才明确调用D/E，Dfreeze先于Efinal，不能改名继承旧PASS。

## 授权、保留与计分

用户已明确确认：本阶段不推进独立复核价值试点、依赖它的第二协议复核及路由收益研究。价值未测；原协议/fixture/报告/ledger原样保留，不重置/退款/补样/研究价格。自动real vendor/model/native和真实信号均0，Bcap4UNKNOWN不可花，不新Driver/CAC/desktop/autoaccept/动态DAG/第二生命周期。

十二服务5180/8796至5191/8807及原state/profile/tar/dirty/history/runs不操作。完整原spawn不可变birth及资源计划先验、每signal前fresh；UNKNOWN保留，不global discovery/substringkill/借凭据/绕产品拒绝清理。主线共享root/contracts/lock/HTTP/App，A唯一生产迁移，E唯一产品断言，I唯一通信；B排除I、main排除Ftrial。

source/controlled/installed/native/recovered/value分别报告。现有76/100与55.7/95=58.6%保留为历史最近评估，不因研究退出、任务数量或本次正常链自动上调；里程碑结束按原12项重新评估。
