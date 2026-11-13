# B：准备协议到真实产品恢复的完整长包

继续原B目录/`codex/g1-runtime`及原owned paths，保留两份旧report差异和untracked b16-real-begin（它不是已提交交付）。读README/0049合并最新main。8d7ddce真实spawn Runner收到begin1和两事实已承认，不再套用B14零receiver；当前仍receiver half。真实模型/native0。

## B1 先闭合真实准备契约

直接处理已定位根因：codex-fake entry关闭eager preparation且选的Driver不发policy.prepared，main NativeProductAttempt必须等它再feed begin。保留原CodexProductDriver与准备/授权守卫，用B-owned fake executable实现它实际调用的version/app-server/准备协议，不删guard、不伪造prepared事实，也不让测试调用落到真实Codex。

## B2 Application加入现有Runner

从原create_work/Application/Effects/NativeProductAttempt/RunnerLink起，实际policy.prepared→begin→原source facts落到A Store与当前binding。sink不能只在内存回persisted:true。检查Work/Ticket/effect/fact/dispatch/assignment和真实receiver关联，fixture本身无approval时不要称已有question。阶段1–2交第一可运行source。

## B3 真正question与子writer

fake executable产生支持的真实approval或澄清，由原Broker记录；启动受现有Runner管理的受控子writer，独立观测其PID/start/UID/attempt/资源manifest，不用控制服务本身代替writer。对资源注册前后和未知保持真实身份，所有进程仅为probe出生。

## B4 最小真实业务重连port

在已有认证proof/transport和A持久binding上实现main可调用的恢复port/RFC，当前before-write回调必须保留。无新ledger/coordinator/lifecycle/wire私有版本；需共享变化交main定契约。不以单纯inspect服务或begin半条链说明业务恢复已完成。

## B5 原begin故障窗口

预留/发送/receiver/ACK/receipt窗口有限中断，新协调器连接同一Runner/子writer。原command/attempt不变、实际receiver次数和recovered exit明确，已接收不可重发；不确定不换ID补发。

## B6 Broker回答与停止恢复

真实question/answer经原Broker和before-write守卫送到当前session/request/attempt/epoch；写前/写后/ACK丢失及cancel逐项断言真实receiver/逐target状态/物理资源。阶段3–6交中期组合和main/E可执行recipe，外部回调未到只标对应项。

## B7 有效旧epoch与资源栅栏

current至少2/old至少1且schema有效，同条件current成功。旧合同/question/session和迟到ACK不得写当前目标。cancel ACK不是资源quiescence，任何缺失/孤儿/部分unknown必须阻止新writer。

## B8 恢复后完整交付

同一原Work/Ticket恢复后走注册机器检查、当前candidate/artifact及人工accept；normal与recovered分别测，不能用旧normal6PASS补证。无自动接受/合并/发布。fake厂商协议不升级为真实native兼容声明。

## B9 2/4槽位归还

在真实已接Application链上先2后4槽：单任务unknown、控制优先级、bounded输出/背压以及FD/子进程/queue归还。每例有deadline和完整归属清理，不用等待或重复空循环凑时长。

## B10 最终状态

写`tests/native-acceptance/reports/wave17-status.json`，第三checkpoint按真实准备/业务表/receiver/question/资源/recovered exit逐项交付。未提交real-begin只有在独立核对、正常提交并push后才算source；不可顺手全量stage旧report差异。检查点不是停止点。

## 独立备选队列

- main恢复接线未到：先做原ProductDriver准备、本机fake child、normal产品/Q&A、资源和有效epoch，交实际port。
- 预算为0：从不调用真实CLI/SDK账户或用户网关烟测；旧UNKNOWN不可用。
- 不再写第二个receipt-only演示，不弱化main preparation守卫解释测试通过。
