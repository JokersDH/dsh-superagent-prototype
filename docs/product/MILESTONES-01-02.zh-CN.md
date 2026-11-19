# Recovery 01 与原生控制 02 汇总

2026-11-19。仅此一份完成汇总；实际发送计数与探针原始轨迹保存在隔离根，不生成逐轮派工或验收 JSON。

## Recovery 01：关闭，6/6

① 受控三窗口和 2/4 同次运行通过；② finalize 同确认 ID 调和与 Store 提交顺序通过；③ UNKNOWN 原凭据/引用/状态材料在关闭传输后仍保留，组合消费者 2/4 对照通过。

④⑤ 合并真实实验成功：隔离根 `/tmp/pa-milestone-closeout-fitbjf/recovery-final`，原 Work `cba9fd3ac39e9b8b6695bb028f689d27`，原 attempt `attempt-7b0fb149-7f9d-4974-8e02-4efe065f9b10`。真实 Codex 已运行时，对探针自己启动的 coordinator PID44898 发出一次 SIGKILL；PID45253 继任打开同一 Store，通过原 Application/QuestionBroker/Runner 登记接管，原检查、人工接受和 delivered 成功，绑定 ended，原产物三项。实际 turn/start 1 次、原 begin 1 次，真实 Codex 进程正常退出，原资源屏障确认后归还槽位。端口64042/64052、独立state；十二用户实例未操作。

发送记录：`/tmp/pa-milestone-closeout-fitbjf/actual-sends.log`；生命周期记录：同目录 `lifecycle.log`。setup 失败不计发送额度；结果未知的 begin/answer 不重发。本次只用更正后剩余的 1 turn 与 1 SIGKILL，旧普通交付不作为此实验的替代证据。

⑥ 按原十二项权重重计，分母不变：

| 能力 | 权重 | 原分 | 关闭时分 |
| --- | ---: | ---: | ---: |
| 主对话、流式与工作台 | 8 | 8 | 8 |
| 项目导入、目录与版本设置 | 7 | 7 | 7 |
| 委托与版本合同 | 8 | 8 | 8 |
| 隔离工作区与依赖 | 8 | 7 | 7 |
| 检查、patch与人工接受 | 10 | 9 | 9 |
| 提问、回答与原生控制 | 10 | 6 | 6 |
| 回执、结果与审计持久化 | 10 | 8 | 9 |
| 活动恢复与资源屏障 | 10 | 4 | 7 |
| 备份、搬根与新授权 | 8 | 5 | 5 |
| 安装、升级与多实例 | 10 | 7 | 7 |
| 独立当前版本与稳定性 | 8 | 4 | 4 |
| 无执行器退化 | 3 | 3 | 3 |
| 合计 | 100 | 76 | **80** |

增加的4分来自真实同原Work崩溃恢复与一次性持久结果；不是按测试数加分。完整方案B不含CAC仍用原70:15:10/95：`(70×80% + 15×10% + 10×10%)/95 = 61.6%`。尚非完整发行准入，跨版本、长时间运行、所有故障窗口和全部真实并发物理范围不由一次实验认证；新发现非P0问题进入backlog。

## Milestone 02：原生控制，关闭，6/6

用户明确授权后直接开启，仅main端到端、可直接修改必要B路径；结束后恢复原所有权。最多6次实际真实turn/start，独立于Recovery额度。冻结六项：审批允许/拒绝、澄清原身份继续、运行补充指令或明确降级、物理静止后停止归还、未知结果先核对不重发、原十二项重计分。其他agent不派维护任务，不开新wave。

实际发送5/6 turn，未用的第6次不再启动；每个任务有独立state/project/HTTP端口。使用原App、原HTTP命令、QuestionBroker与真实Codex，浏览器实际操作原工作台，而非仅给组件注入回执。

| 冻结项 | 实际结果 | 隔离任务/证据 |
| --- | --- | --- |
| ① 审批允许/拒绝 | PASS。`item/commandExecution/requestApproval`上浮工作台；点击“仅本次允许”后写APPROVED并交付；另一次点击“拒绝”后真实进程静止、未出现被拒绝文件 | `control-approval-allow-untrusted` / `control-approval-deny`，各1 turn，原UI截图和原命令ID在任务根/生命周期记录 |
| ② 澄清后同会话继续 | PASS。显式plan profile的真实`item/tool/requestUserInput`显示原问题与ALPHA/BETA选择；工作台选BETA并提交，原target/question/command身份一致、native_applied、原attempt继续到交付 | `control-clarification`，1 turn；Work `d6ec86aea2d5c832d23f39081158fff6`，原生plan mode是该CLI的前提，普通模式不保证有该工具 |
| ③ 运行中补充 | PASS。工作台“当前工作”发补充，真实`turn/steer`接受；原attempt/begin不变，模型按补充写BETA并执行后续等待脚本 | `control-steer-stop`，1 turn，另有`turn/steer`，不增加turn/start；Work `d8223e6d4981b5978014f0af689424cf` |
| ④ 停止与物理槽归还 | PASS。工作台“停止工作”，原资源屏障确认、binding ended；独立观察到的运行工具PID54131也已退出/静止，未把点击成功当停止证明 | 同一个`control-steer-stop`任务，原资源观察与wrapper实际Codex退出在原始日志 |
| ⑤ 未知结果先核对、不重发 | PASS。浏览器在原审批答案Store已提交后故意丢HTTP响应；只核对原结果/native_applied并刷新，UI无自动重发，原answer command与原生回复均1次 | 与审批允许同任务，不花额外turn；`lostResponseReconciledReadonly:true` |
| ⑥ 原口径重计 | PASS。原“提问、回答与原生控制”6→8，其余沿Recovery关闭时分数；本机80→82/100，完整B61.6%→63.1% | 不是测试通过率，不等完整发行准入 |

第1个on-request基线任务自动允许工作区内操作，没有实际审批请求，因此不作为①的通过证据，但实际turn照计。随后untrusted profile分别验证审批允许/拒绝；没有重发任何结果未知的原begin/answer。实际总数为该基线1次+允许1次+拒绝1次+澄清1次+steer/stop1次=5次。

为完成这条原生控制链所做的产品修改：私有native profile增加可选plan/default模式并由实际Codex applied model配置plan turn；恢复时模式变化拒绝；工作台single问题显示真实选项；关闭传输时资源仍active/unknown则保留原credential/引用材料，shutdown先核物理停止；主线组合测试断言原UNKNOWN credential关闭后仍存在。预算探针仅透明转发真实协议并记录实际turn/start写入，未创建新Driver、LLM循环、调度器或ledger。

最终同一十二项分值依次为 `8,7,8,7,9,8,9,7,5,7,4,3`，合计 **82/100**。完整B不含CAC仍按原权重：`(70×82%+15×10%+10×10%)/95 = 63.1%`。原生控制仍留2分给未测的认证流、其他批准类型/版本与完整覆盖；一次停止不是所有后代/平台/长期场景的普遍证明。没有重包、安装升级或额外创新收益加分。

最终验证：42项原链/恢复/2&4/端点回归通过；coordinator、product、console、实际Runner闭包严格类型检查通过。源码与原始状态保留，十二用户实例未重启/迁移/清理，历史grant/ledger/外部评审文件未改。两个里程碑关闭，临时B/H修改权恢复原表；所有agent待命，不自动开新wave或下一个里程碑。其余非P0窗口留backlog。
