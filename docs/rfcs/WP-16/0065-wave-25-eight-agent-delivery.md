# 0065：第二十五轮验收与八Agent完整交付

2026-11-14，main基线4e805de，新增实际输入source `fdb3f160b1d867f7167fb034d96a5c13bd16cdfb`。固定A e60e130029f377edb3b02a2c8762c3d990016004、B4af2a3eb6cb84195a8f7f774b0c836f2cfc4b1ee、Cd9ada879226c3b72f84f59b48adac7f107ccac80、Dbcd4d4c4f1a06ee78ddb4a7eaad7f3ff4273f6fd、E6c44c3f81f25df7fcf2a6c027b9a9d3d6fc859fb。证据见 [验收目录](../../../reports/releases/wave25-admission/README.zh-CN.md)。

## 验收结论

A原subject/required集合/UoW前后核验和成本2/2通过，C实际A模块/新进程/双恢复及工具9/9、相关strict通过。独立准确0ede包真实fresh启动、只读数据、验证stop通过，provider2→2、最终STOPPED。旧A主体问题关闭。C缺launcher PID和API start仍verified的私有遗漏反例未关；实际正向不撤销。A清单、双restore与packageconsumer已分别可跑，但尚未进入同一次manifest-driven链。

B完整command tuple的三独立负例、真实大页48KBclamp和已知ref的135540byte五块payload准确还原通过，strict/exactOptional0。当前facts大首frame仍inline超cap，不能先发现ref再推进；payload新路由未绑定producer，foreign source可读chunk。length把decoded bytes报base64字符是P2；RFC对feed/beginonce/pendingexactlyonce的过强描述需校正。真实三类重绑、统一dispatch、双client/SIGKILL/恢复交付仍未交，新通道继续不进默认产品。

D立即登记、旧child start/兄弟根/全null unknown修复有实证。剩余probe safety P1：TERM后KILL前没fresh，纯控制换PID start仍捕获KILL；child config与捕获argv未核。mixed valid/null丢UNKNOWN亦待补。这些是新live工具边界，不是已证明普通产品权限绕过。精确信号负例未过前不跑广泛live矩阵。

E capability自报降级、负/越界count和unknownreason等旧P2真关；准确0ede完整162required、223PASS/0FAIL/16NT、四consumer真实hash和跨新3b拒绝通过。新gate漏掉实际plain.optIn HTTP200，删观察或改500仍通过。保持完整真实positive，工具schema合法不替代实际HTTP成功。

## 新准确产物和数据范围

D新 `3b2ff68b4785e79757fc1dcd14b17f5dd84d0c62` / build470738fd33b22ff4 / schema18，tar SHA f04abb1b4c4ae47a52f6bc1aa172d70c4a113219f443f354aee0ebffc8a00494，20248077bytes，6748项=6727regular+21internal symlinks全验；closure87/87。包内main4b范围UI/backend静态存在，CLIhelp1/1，不等于浏览器或E新包交互准入。E最终仍为0ede，不贴3b或本轮readiness。

D现在有两份snapshot各自material/bundle/restore与原Work/Q/A读回，超出以前单bundle字节等价范围；A reader和C实际包同Store调用也有报告。但C未直接消费A manifest、两格式同包原native_applied/browser仍有未测范围，复制已静止输入时删WAL/SHM不能外推在线备份。最终链必须绑定producer/expected subject/实际root mapping/consumer。

## 八个外部Owner与main

用户明确增加F/G/H三位开发资源。保留A–E五原工作树；main创建F `/Users/hh/Desktop/joker/superagent-agent-f` / `codex/g4-trial-experience`，G `/Users/hh/Desktop/joker/superagent-agent-g` / `codex/g4-usage-insights`，H `/Users/hh/Desktop/joker/superagent-agent-h` / `codex/g4-trial-operations`，基于上述main实际source，不复制用户状态或native profile。没有自动创建用户聊天或代发外部消息。

F获明确新UI/test/e2e trial三个子树及用户指南/独立报告；main对console的所有权排除这些新子树，仍控制App/transport/全局CSS和API/授权。G获usage-insights新纯分析包/CLI/报告。H获trial-kit、operational-soak、内部文档/报告，提供原始只读预检/诊断/有限观察，不变成第二registry/ledger或E发布权威。

每人由原十阶段/三checkpoint扩为十六阶段/四可运行结果，phase4/8/12/16发布后继续。四结果覆盖实际接口→真实消费者→完整流程与故障→交付、文档、资源归还；外部依赖未到执行独立队列，整个goal未齐不按partial结束。工作量由真实产品结果决定，H有限600/1800秒运行不假称48h。

## 已发布的实际共同输入

[0064](0064-trial-readiness-and-parallel-inputs.md)已实现鉴权GET /v1/readiness、共享TrialReadinessSchema/独立生成产物、typed console consumer和四导航action type。复用现有configuration readonly投影，输出配置事实/计数/unknown/fixture/readonly，authorization none，无模型/SQL写入/probe/native。F/H直接用该端口，G从既有outcomes/timing/attention/evidence和明确输入开始。

主线28项干净source合同/HTTP/恢复/传输组合、232contracts、product/http/console strict、generated通过；真实A Store和Node HTTP读无事件/模型增量，独立窄review3/3无实质问题。Runner wire hash不变。没有F/G/H产品完成或新安装包发布声明，三新工作树是已准备的开发资源。

## 依赖和最终门槛

普通UI/安装/F/G/H观测不等B/private/target/BLOCKED试点；B实际port先给main，A清单给C唯一driver，Gsummary给F，D准确bytes给E，H原始观测给E独立断言。main每个稳定检查点持续择小接线，不等九个整包全部结束。

运行字节变更先freeze再E终验，docs-only不重冻，旧0ede/3b和新main不互贴结论。E独占product-acceptance assertions，A独占迁移，rootcontracts/config/lock/HTTP/provider/授权仍main独占。无新Driver/CAC/桌面/autoaccept/动态DAG/第二ledger。

八位加main自动vendor/model/native0。B历史cap4 UNKNOWN不可花，E原pilot24turn/200000token/USD5/单在途BLOCKED，无reset/topup/refund/补样/价格配方研究。十二旧服务与所有state/profile/tar/ledger/dirty保持，只有精确独立自有资源可逐次fresh后信号，unknown留现场。
