# 0081 第三十一轮独立验收与架构边界

2026-11-15。验收基线6f385a545d8ae38fcdaa494a0fd0646f45721a15；主线新运行源码303b2c6a974856661c21d0617bd710ebe87374d1。只审已交结果，不把十二成果计划当已完成。

## 固定输入与判定

| Owner | 固定HEAD | 本次真正关闭 | 剩余与下一实际消费者 |
| --- | --- | --- | --- |
| A | 40626989 | 原attempt历史binding与当前eligibility分离，7项和strict过 | C包装必须继续保留上游truncated；原Store读取、恢复历史和完整inventory继续 |
| B | fbc93316 | 唯一remote lease不再把native intent重复发旧stdio，实际12项/strict过；161事实/160页/1821≤2048字节、135540字节5chunk保留 | P1信号工具可从当前快照收编任意直接child且只要部分argv；原Store/Broker同Work恢复到候选接受/2&4槽未达 |
| C | c25c4147 | 已有关联原Completion/三个J流程保持；3项和strict过 | 新P2上游51取50已truncated，包装却称complete；需覆盖保真而非扩大authority |
| D | 1dd70957 | 新829包实际含0076窗口+0077组合，197/197closure/6849项，真实fixture模式证据已正确 | E必须同准确包独立验；D自测window9/J6/F8不能代替E |
| E | b9fcdc77 | 已到1fba：278PASS/0FAIL/19NT，ordinary189/functional190真过；停止前2PID/停止后逐个退出观察补齐；旧globalps/config路径关闭 | 新P1包STOPPED/parent退出早返漏known live child；P2缺ppid拒合法多资源；P2after空对象误过。先pure后新包 |
| F | 876fc970 | display/effect范围和额外排除不一致旧P2关闭，8项和strict过 | 真实日常工作台、草稿/导航/错误/移动/导出可用性，不另造执行状态 |
| G | 1f296455 | 展示导出/分析导出区分，22针对性和strict过；主线已接默认下载 | 验当前public消费者和实际同包，不反解析formatted值，不虚称长期收益 |
| H | 55766f41 | 当前B/I消费者真实存在，mutable record旧P1关闭，9项过 | 新P1出生失败/ps UNKNOWN时spawnOwnProbe仍直接kill；先pure取消危险fallback再实际原恢复 |
| I | 4bce0673 | actual通道与16新增测试过，前旧nonce/guard/adoption关闭 | 只维护唯一通信和actualB consumer，不接业务授权/第二恢复状态机 |
| J | e6400429 | freshness/config/current-version等新输入5源已进主线，75库/26工具/strict过 | 三kind项目边界和真实原表单/迁移项目声明，不执行不可信scripts |

详见[独立报告](../../../reports/releases/wave31-admission/README.zh-CN.md)。上述新P1在测试工具材料安全边界，不冒称主产品授权绕过；也不能因为是测试代码就准许安全live故障运行。

## 两条发行线

**R1固定输入，不再移动：** source82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2/build8296720d8a25f38c，tarSHA04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543，20481470字节，schema18/Node24.21.0/ABI137/darwin-arm64，6849项/197closure。准确路径见delivery报告/dispatch。E修工具/断言后立即同包验，不因测试/文档变更重冻。

**R2新运行源码：** [0080](0080-main-observation-export-and-runtime-checkpoint.md)的观察下载/J输入/实际B-I通信。D先完成R1可用交接，再按确定source冻结后继；E一次只锁一个tar，不能追正在变化的main。R1不借R2功能，R2不借R1独立installed结论。

**R3反复使用与支持：** 基于已经固定通过的R1或R2，做两项目日常工作、同事冷安装、备份只读恢复、支持诊断。不是预先批准第三个tar或新平台。运行字节真变化才冻后继，文档/工具修订不机械再打包。

## 单一权威

原Ticket/Assignment、ProductStore、Application、QuestionBroker、Completion/check/currentCandidate/manualaccept是业务权威。A唯一生产迁移，E唯一产品断言。I唯一通道核心，B负责注册/auth/dispatch/transport/lifecycle，main负责组合原guard；没有第二candidate表/JSON登记表/新Work兜底。

main只合最小已验闭包，不合B/H信号工具、E清理工具、计费review新模块或其他未准入功能。source接入本身不授予原生任务、恢复写或target权限。远程native intent与旧stdio在lease内仅一个owner，freshguard逐intent，observed事实可重送原ID，未知业务效果不新ID重发。

历史事实按原attempt历史binding判断，当前可执行性单列。任何上游覆盖truncated/unknown不能在消费者重标complete。G header的works样本与row样本/层/货币/未知独立保留；导出只是新读取展示快照，非收益/计费权威。

## 准入门槛

普通App/项目声明/观察/安装不依赖B原恢复、private/target或blocked研究。B/H安全工具纯测试通过后，才可在明确自己spawn的原受控run上做必要故障，不运行unsafeSIGKILL或全局发现。

停止/删除前需独立完整spawn意图与出生记录：PID/start/UID/fullargv/root/config/op及全部固定资源；signal前全集合预验，每次升级前fresh观察。UNKNOWN不是exited，parent退出不是children都退出，packageSTOPPED不是忽略known集合的许可。拒绝时保留材料，不能为测试收尾绕产品拒绝。

自动真实vendor/model/native0。B旧cap4UNKNOWN不可花，E原24turn/200000token/USD5/one-in-flight pilotBLOCKED不刷新。十二用户实例5180/8796至5191/8807和所有state/profile/tar/ledger/dirty/runs保留；无global发现/substringkill/借凭据/真实CLIfallback、新Driver/CAC/desktop/autoaccept/writer racing/dynamicDAG/第二生命周期。

source、controlled、exact-installed、native、recovered、operator-value、private/target分列。旧完成度记录不因人数、132个计划成果或测试数增加；独立安装/原恢复/价值未达就明确未达。
