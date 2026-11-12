# B：真实产品命令、持久控制与多槽位

原目录`/Users/hh/Desktop/joker/superagent-agent-b`，分支`codex/g1-runtime`，原B拥有路径不变。读README/0037，合并最新main，保留原runtime.json差异。cap4余额UNKNOWN不可用；模型/native0。只用受控协议fixture，不运行厂商agent模型任务。

## B1 完整输入拒绝与默认脱敏

跑`probe-wave12-runtime.mjs "$PWD"`，顶层function/Symbol同样在reserve之前拒绝；补getter/嵌套/循环/BigInt/克隆后不可表达值的明确策略。公开binary/versionError/reasons及嵌套字段均不泄露绝对路径/账号/凭据，includePrivate才允许私有诊断。保持exactOptional和真实消费者编译，交首个source。

## B2 校正B13证据并找到实际生产入口

保留旧b13原始结果，但改正PASS范围：b13_command/b13_epoch没有驱动Runner，epoch写在kill之后，同父进程reopen不等于协调器恢复。列现有ProductRuntime/Store/queue/registry/auth proof实际调用链，新增测试必须经过这条链；不能用新测试表/ledger充当发送权威。

## B3 真实begin与协调进程重启

独立协调进程使用A现有SQLite和队列发起实际受控Runner begin，Runner记录可观察begin次数/attempt/session。协调器在入队/发送/ACK/事实提交窗口SIGKILL，由全新进程恢复；验证同一原请求不重复begin，unknown不猜成未发送。缺生产接口给最小RFC和复现，禁止加名为recover的方法迎合旧测试。

## B4 问题与回答持久传输

受控Runner产生实际question，走原QuestionBroker/answer delivery，覆盖记录/传输/ACK前后崩溃和重开。绑定question/version/native RPC/attempt/session，旧RPC不能指向新会话；跨项目或旧epoch回答拒绝，unknown保留。验证最终回答次数与原持久receipt，不以独立假台账计数代替。

## B5 真实停止与完整资源屏障

在begin之前、运行中、子进程退出/ACK前后停止；认证proof、当前binding、完整资源清单和start身份共同决定。closed/terminated和unknown含义保留，旧proof不能释放新attempt。模拟协调进程死亡与Runner仍活，不全局杀进程或把未知资源过滤成空集合。

## B6 steer与重连状态

用同一实际传输实现steer、丢ACK/断线/重连/重放，准确区分supported/unsupported、delivered/unknown和失效会话。epoch必须来自既有生产持久绑定；若缺owner接口，交明确RFC，不能新增测试权威表。阶段3–6交第二个源码/可运行矩阵。

## B7 2/4槽位与队列行为

固定任务数量做2、4槽位，交错问题/输出/停止和一个进程失效，验证其余任务可推进、身份不串、队列顺序/背压、输出与时限上限。记录资源峰值、收尾后FD/子进程和未决项；只停止本次可证明自有资源，测试有总deadline。

## B8 当前产品的退化与诊断消费

交D/main可直接消费的准确driver/profile/runtime诊断，缺执行器/版本不兼容不能默切fixture或授权新工作。main owns启动/HTTP/UI；B提供typed事实和故障fixture。再用实际产品消费者编译/运行证明，不以export存在算完成。

## B9 恢复target屏障与B/E拒绝协议

消费main已交target prepare及后续activation检查点，证明旧active/indeterminate writer仍阻断，新generation不抹旧资源。B/E只关闭flat-envelope/缺grant/缺bound准确no-send，fake发送0；不重做费用或recipe调查、不扩Driver/预算。

## B10 回归与精确交接

执行B拥有包回归、main strict/exactOptional consumer、生产控制矩阵，维护`tests/native-acceptance/reports/wave12-status.json`。每个案例列实际协调进程/Runner/DB/原request/epoch/发送计数及故障窗口；fixture/native分开，未达项如实保留。只push原分支。

## 独立备选队列

- 输入/脱敏/断线/输出上限和当前认证proof负例独立于激活。
- begin/question/stop生产矩阵使用已存在Store与队列，不等费用研究。
- 缺某一epoch/target接口时交最小RFC，继续其他传输、槽位和资源收尾。
