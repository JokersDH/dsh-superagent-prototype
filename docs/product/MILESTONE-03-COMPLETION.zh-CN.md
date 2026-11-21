# 里程碑03完成汇总：日常可用版

2026-11-21。**冻结六项6/6关闭**，在下述平台、版本与样本范围内可个人试用。不是完整方案B/Beta或跨机长期稳定性认证。所有agent待命，不自动开启新wave或新增模型任务。历史失败、UNKNOWN、原grant/ledger及十二用户实例保持原证据。

## 交付与使用

当前交付形式是ZIP内的Node运行时、Start/Stop命令和浏览器工作台。包内产品代码来自固定source 83f79e8249efd68f429f2b6828ea233278071737，build d3ba0ec6dccc5eac；本轮新增的是验收工具与文档，未改包内代码或重新打包。

安装包：[PersonalAgent-Preview-d3ba0ec.zip](/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip)，63575237B。SHA256：163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b。

Inner：/Users/hh/Desktop/joker/pa-artifacts/m03-target/m03-target-d3ba0ec.tar.gz，20631227B，SHA256：52eee9083b4d2256a58189327c93605c157e38f5cd44894482a82c6198f56123。

先支持M系列Mac。Node24.21.0/ABI137已随包提供；Git和已登录的Codex CLI0.164.0是本机前置。不要因新版CLI存在就宣称兼容。跨机尚待同事自己的Mac实测，当前结论为同机独立安装。

1. 解压完整ZIP到自己保留的目录，双击Start.command，保留其终端窗口；浏览器地址由启动器打印，不使用旧5180–5191实例充当最新版。
2. 在网页“偏好设置”填主对话模型端点/模型/key。保存只写本机配置，不表示已联网验证。Codex开发执行使用自己的Codex登录，与对话key分别配置；没有对话模型也能明确委托原生开发任务。
3. 导入有提交、工作树干净、有现成检查的Git项目；先用无额外依赖或已支持依赖准备的Node项目。输入明确目标，点击“委托执行”核对项目/范围/检查后创建。
4. 原问题到“待我决定”回答；查看某个Work或历史补充时，选择该Work并切到“当前工作”。主对话普通发送用于讨论；运行中“当前工作”发送才是给该Work补充要求。
5. 检查通过后审阅完整patch与输出，再接受当前候选；下载patch在自己的项目审阅应用。接受不自动merge/push。结束双击Stop.command；正常重开保留消息/Work/产物。

详细用法：[使用指南](../ASSISTANT-GUIDE.zh-CN.md)。包内冻结手册可能显示历史检查点，本页与仓库当前指南记录本次准入结论。

## 六项证据

| 项 | 结论 | 实际范围与证据 |
| --- | --- | --- |
| ①正常首次使用 | PASS | D固定包、E真实安装就绪与GUI保存、main独立无认证退化/保存/停止；保存与连接验证分别呈现，未静默切fixture |
| ②两个真实项目 | PASS，限定样本 | E两仓库的零依赖token-engine子包Git备份，一项人为注入回归修复、一项纯函数功能；原package/test/基线保留，不声称两个完整业务工程已验证 |
| ③工作台控制 | PASS，实际能力范围 | 本次准确包上的真实item/commandExecution/requestApproval→仅本次允许→native_applied；另一真实Work运行中同attempt/turn steer→按补充执行→原Stop/物理屏障归还 |
| ④检查与人工接受 | PASS | E两原候选的检查/接受/patch均核；main在独立导出重应用patch，分别6/8测试通过；本次审批Work也经原检查和明确人工接受到delivered |
| ⑤正常重开 | PASS | E原两个交付Work、main本次两控制Work均经正常stop/start，原身份/候选/产物/接受或补充记录可读，重开无新增turn |
| ⑥准确同包旅程 | PASS，同机 | source/build/内外SHA一致，产品从包内入口/Node运行；E双项目安装实例与main控制安装实例使用同一冻结包、各有独立state，未将受控peer当真实Codex证据 |

本结论是同一包多个隔离实例的测试组合，不把不同state说成同一次运行，也不借历史R1/W36或Milestone02替代本次真实控制。原生结构化澄清仍有plan模式限制；本次验证的是普通模式可触发的逐次命令审批，不宣称认证流/全部审批类型/所有模式已覆盖。常规正常启动/重开及原恢复里程碑范围分别保留，不新增故障注入。

## 本次两条真实控制链

独立私有根：/Users/hh/Desktop/joker/pa-artifacts/m03-main-live-onYKfU。实际使用过UI/API53213/53214（搭建失败，0 Work/0 turn）、53325/53326（真实执行）、53588/53589（正常重开），均非十二用户实例。自有实例最后正常STOPPED。

审批Work f371b80a1edb01e06f6ef2735003245c，attempt-2450135b-c905-4295-b983-098c4ed52cc8。真实Codex在工作区内请求一条读取package.json的只读命令逐次审批。工作台点击“仅本次允许”，原question/target/nativeRequestId/answer command一致，version1答案快照保留；回答后问题升级为answered version2，native_applied一次。原检查PASS，原currentCandidate及humanAcceptance绑定同一assignment/digest，手动接受后delivered/绑定ended。

运行控制Work 4993e3df70d579476aeb55804299fa75，attempt-f4029cad-5e8d-4600-a9ef-22dd9ae06069。Codex先实际执行工作区内有界等待脚本；工作台在turn尚未终态、资源活动时投递锚定同Work的补充，原Driver实际turn/steer获接收，begin仍1。模型按补充写STEERED并进入第二段等待；main观察到工具PID31430仍运行后点击停止。停止UI命令16:32:52.408，原资源quiescent/原barrier16:32:52.609，绑定ended；无先行turn.ended，工具及两个真实Codex子进程随后定点观察均不存在。额外PID观察只读，资源归还权威仍是原登记资源/Store屏障，不是PID差集或“按钮成功”。

正常重开后切到“当前工作”，两原Work/attempt、审批产物和补充消息均可见，实际发送仍2次。main另只读核对原Store/版本/合同/问题目标/答案/dispatch/检查接受/资源屏障及全部本次artifact摘要。当前非ended绑定0、讨论模型回复0，本次没有额外主对话网关请求。

## 额度、工具与历史

- 原Milestone03 grant：4/4保持耗尽；其中最后真实控制尝试未触发问题/steer、终态后才stop，原FAIL及其ledger不改写。v2依赖搭建在原生发送前阻断，仍单列未发送。
- 用户本次新grant m03-main-closeout-2：最多2次，实际SENT_TURN2、UNKNOWN_TURN_WRITE0；一个审批Work、一个运行控制Work，原begin各1，steer不另开turn/start。本次此前启动保持问题发生于创建Work/发turn之前，修复后正常继续，不计消费。
- 计数原始日志：private/actual-sends.jsonl；操作/原命令ID：private/lifecycle.jsonl；状态与工作区工具出生观察：private/state.json。截图approval-question/approval-delivered/steer-running/steer-stopped及两份reopened图均在上述private目录。原Store/Runner journal/产物保留在该根home的产品私有数据目录。
- 工具：tools/acceptance/m03-installed-closeout.mjs从正常包入口与UI执行；m03-budget-forwarder.mjs仅作外部测试观察器，按原顺序转发真实CLI参数/stdio并计实际发送，不新增Driver、coordinator、LLM循环或原生请求。外部浏览器/观察器属于验收工具，产品运行模块来自冻结包，原生循环由真实Codex提供。原proto和执行授权未替换。
- 转发器零模型自检验证参数顺序、中文帧完整和两次上限；实际过程中未第三次发送、未重发未知业务。未注入OS故障信号，正常产品停止由原Runner执行。旧研究/复核grant均未使用。

## 原十二项重计

| 能力 | 权重 | 前分 | 当前 |
| --- | ---: | ---: | ---: |
| 主对话、流式与工作台 | 8 | 8 | 8 |
| 项目导入、目录与版本设置 | 7 | 7 | 7 |
| 委托与版本合同 | 8 | 8 | 8 |
| 隔离工作区与依赖 | 8 | 7 | 7 |
| 检查、patch与人工接受 | 10 | 9 | 9 |
| 提问、回答与原生控制 | 10 | 8 | 8 |
| 回执、结果与审计持久化 | 10 | 9 | 9 |
| 活动恢复与资源屏障 | 10 | 7 | 7 |
| 备份、搬根与新授权 | 8 | 5 | 5 |
| 安装、升级与多实例 | 10 | 7 | 8 |
| 独立当前版本与稳定性 | 8 | 4 | 6 |
| 无执行器退化 | 3 | 3 | 3 |
| 合计 | 100 | 82 | **85** |

加分只来自当前准确安装包上的真实两项目/原检查/接受/重开和同包真实控制补验：安装+1、当前版本独立验收+2。原生控制原8分已覆盖此前里程碑范围，本次没有因重复验证再加分；仍保留认证流/类型版本覆盖等缺口。完整B不含CAC按原70:15:10/95： (70×85%+15×10%+10×10%)/95 = **65.3%**。工程估算不是测试通过率或稳定性概率。

跨机、长期运行、更多CLI版本、复杂依赖/monorepo环境、执行恢复的全部窗口和真实2/4并发物理范围仍需分别验。多协议/创新收益没有新增证据，已暂停的复核/路由研究不重启。里程碑03关闭不等完整方案B完成；当前可在限定平台和项目范围内个人试用。下一阶段须用户另行决定，不自动派工或调用模型。
