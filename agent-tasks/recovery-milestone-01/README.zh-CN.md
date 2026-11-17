# 里程碑01：同一个原 Work 恢复到交付

2026-11-17。替代 wave36 的新增扩线派工，保留此前成果、未达项和证据。任务变大指持续负责到集成与复验结束，不再增加交付线/微阶段；没有当天截止或时长承诺。当前完整方案B不含CAC。

## 唯一产品出口

同一个原 Work 在协调器故障后，由原 Store/Application/QuestionBroker 接管，保留原 attempt/合同/问题/命令/原生会话；不重复 begin、不重发 UNKNOWN 业务效果；继续原检查、currentCandidate、显式人工接受到 delivered，并证明原2/4调度槽和完整资源安全归还。原生/物理证据未达时保持未达，不能用组件或虚拟资源补足。

**main端到端负责这个出口。** B/I/H只为这条原链提供生产支持、通信和独立故障消费者；A/C维持原数据/来源权威；D/E完成已有固定安装包的独立出口；F/G/J维护现有能力并提供本里程碑证据。此出口关闭前不开扩线wave。

## 已具备与先修缺口

- main `42f6daab` 已从真实 Native.launch 返回对象绑定三类callbacks，原HTTP Work问答→检查→人工接受→产物重开受控通过，撤销授权零效果；17+13测试/严格检查过。不是故障恢复、真实原生进程或原槽证明，见[0095](../../docs/rfcs/WP-16/0095-main-original-running-callback-composition.md)。
- B四文件控制已成套接入；旧自然terminal收尾/C同步superseded与digest/EqueryUNKNOWN修复成立，不重复派工。
- 新阻断：B工具重登记第二snapshot刷新birth、I host误删借用父状态树、G错误entry/空argv仍晋级身份；D selected audit有5条旧hash。详见[验收](../../reports/releases/wave37-admission/README.zh-CN.md)。这些候选工具未扩大主线授权。
- C决定绑定的默认create接线仍未闭；它不成为本轮新增功能线，仅在原恢复确需时由main接。F/G/J不继续扩新面板、指标或模板。

## 分工与连续执行

| Owner | 完整责任 | 任务 |
| --- | --- | --- |
| main | 原 Work 故障接管、原 Broker/检查/接受/槽位的整链集成 | [main](main.zh-CN.md) |
| A | 原数据、ACK、非空重开与原bytes连续性 | [A](agent-a.zh-CN.md) |
| B | 原执行/控制、不可变spawn资源边界及恢复支持 | [B](agent-b.zh-CN.md) |
| C | 原来源/决定在恢复期间的当前资格与历史保真 | [C](agent-c.zh-CN.md) |
| D | 已有W36准确来源、交付与E同包支持 | [D](agent-d.zh-CN.md) |
| E | 已有W36独立安装结论及原产品断言 | [E](agent-e.zh-CN.md) |
| F | 原问题/交付/unknown工作台维护 | [F](agent-f.zh-CN.md) |
| G | 身份诊断缺口修复及现有support维护 | [G](agent-g.zh-CN.md) |
| H | 原实际消费者、故障窗口和槽/资源的独立证据 | [H](agent-h.zh-CN.md) |
| I | 唯一通信层、借用状态树保留和恢复协同 | [I](agent-i.zh-CN.md) |
| J | 原项目/check配置缺口定位与交付支持 | [J](agent-j.zh-CN.md) |

分别转发[十段话术](forward-prompts.zh-CN.md)。沿用[原root/branch/ownership](../product-wave-36/dispatch.json)；[固定输入](workspaces.json)只记录本轮身份，不新建checkout/chat。早交可运行source，随后持续联调、修复、复验与自己包内独立队列。依赖阻断只记录第一处实际缺口；不重复长soak或用更多报告填满任务。不声称已向外部chat发送。

## 固定安装 cohort

已有W35由E完成安装/配置/恢复/升级子集；保留其347PASS/22NT的混合cohort scope。当前独立目标锁 **W36 source087a598e5b6f357bd2cc40556cbf693257febc66 / build14a6b457ea285988**，Node24.21.0/ABI137/schema18/darwin-arm64。

Inner：`/Users/hh/Desktop/joker/pa-artifacts/wave36-target/wave36-target-14a6b45.tar.gz`，20625055B，SHA256 `13798190ae43b28628eaf7131dfb8192bdb786b9bcfe4e1e0b6f9217ab33a8af`。
Outer：`/Users/hh/Desktop/joker/pa-artifacts/wave36-preview-14a6b45/PersonalAgent-Preview-14a6b45.zip`，63565262B，SHA256 `43e06d5bc7606e8283c1c5f58463f402018d4c9c9b223a2c7c021d429ccb8995`。

D纠正外部selected source audit不重包。E先完成这个包的准确结论，不追42f6及后续移动HEAD。只有运行字节确需修复/主线选定恢复版本才明确冻结后继，不能改名继承旧PASS；Dfreeze先于Efinal，无反向等待环。

## 授权、保留与计分

用户已明确确认：本阶段不推进独立复核价值试点、依赖它的第二协议复核及路由收益研究。价值未测；原协议/fixture/报告/ledger原样保留，不重置/退款/补样/研究价格。自动real vendor/model/native和真实信号均0，Bcap4UNKNOWN不可花，不新Driver/CAC/desktop/autoaccept/动态DAG/第二生命周期。

十二服务5180/8796至5191/8807及原state/profile/tar/dirty/history/runs不操作。完整原spawn不可变birth及资源计划先验、每signal前fresh；UNKNOWN保留，不global discovery/substringkill/借凭据/绕产品拒绝清理。主线共享root/contracts/lock/HTTP/App，A唯一生产迁移，E唯一产品断言，I唯一通信；B排除I、main排除Ftrial。

source/controlled/installed/native/recovered/value分别报告。现有76/100与55.7/95=58.6%保留为历史最近评估，不因研究退出、任务数量或本次正常链自动上调；里程碑结束按原12项重新评估。
