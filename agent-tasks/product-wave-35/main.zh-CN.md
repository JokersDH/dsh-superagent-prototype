# main：主架构与实际产品集成的三连续工程包

2026-11-16。原目录 `/Users/hh/Desktop/joker/superagent`，原分支 `codex/g2-execution-integration`，固定输入 `8cd709ca57acb0ba8064e2ec3cc98f4369a46c60`。保留dirty/history/state，fetch并merge origin/main，不reset。

先读AGENTS、START-HERE、product-spec/README、本轮[README](README.zh-CN.md)、[0089主线](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[0090验收](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)、[0091工程程序](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。

建立/延续一个覆盖三连续工程包、九个完整生产成果的whole goal；上轮未闭整链在这里继续，不将修一个反例算一个成果。比上轮六成果扩大到九个，每项必须实现+实际consumer+必要正负+source交接。早/中/终source发布后持续全部包/联调/独立队列，不逐小fix等派工，无同日/时长/工时/token承诺。

## 工程包一：原执行与原恢复

### 成果 M1：原RunningAttempt实际回调激活

实施：从原launch返回running消费既有attachPort/attachCallbacks，保留原stdio命令和stop/quiesce，先等一次实际bind；不合有unboundlease风险的raw控制、不另造data port。

实际消费者与验收：原ProductExecution/Store创建Work→原运行factory→三callback，fact/payload/fresh guard来自同一对象；缺/foreign/terminal0effect。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 M2：原QuestionBroker答案与unknown调和

实施：沿nativeFence→原command index→allowAnswer→send→原running.feed，原question/target/session/contract/epoch不换；原ACKunknown查询调和不自动重发。

实际消费者与验收：一个实际原Work中问题→明确回答→native_applied/indeterminate→原Store回执；等价guard或反射endpoint组件不充完整采用。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 M3：同原任务恢复与原调度资源

实施：与B/I完成原登记重接、控制协议兼容和完整资源先验，原check/currentCandidate/actions.available/manualaccept到交付、原scheduler2/4与等待项归还。

实际消费者与验收：原ID/产物/原queue/bindings/barrier实际consumer，禁止memorySlotScheduler成为第二权威；不安全live条件缺则相应HELD。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

## 工程包二：数据进入原产品流程

### 成果 M4：真正可用的Work历史

实施：消费A修好的production history，小步接原evidence界面/认证reader，公有DTO严格投影、principal/project/Scope签名cursor、总bytes/零进度独立检查。

实际消费者与验收：原历史binding与当前eligibility分开；原timeline不复制另一ledger，五kind及oversized/blocked/partial语义准确，先非空实际浏览再扩大。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 M5：选定决定进入新Work确认

实施：C canonical shape/Scope/来源/时间重验通过后，接原preview/prepare/assert/create前选择，用户明确确认；内容/来源撤销/过期需重预览。

实际消费者与验收：原form取消/编辑/迟到/unknown commandId、旧合同冻结，data-only valid不当grant，source bytes当前与历史各自可读。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 M6：项目重识别与新登记消费

实施：接J最小rebind/module/draftCurrency到原项目注册与NewWorkForm，数据状态不改变原授权或恢复readonly marker。

实际消费者与验收：两个原项目换根/变配置/新ID同content和原history导航，真实原检查/接受，display/effect使用同serverfields。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

## 工程包三：完整日常体验与固定交付

### 成果 M7：模型配置完整生命周期

实施：本轮4cde5883已交原App/Fform→认证POST→原Provider私有原子保存，后续补版本化当前配置/中断/旧服务/secret guard的实际日常行为，保存不自动发模型。

实际消费者与验收：StrictMode/身份切换/HTTP显式同意/0600/坏文件保留/同设置重开已过；用本机选定配置，模型验证与保存状态分开。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 M8：日常工作台与可解释支持

实施：持续接F实际history/source/多项目任务/错误保草稿/访问体验，G可信身份缺证保持unknown，支持文件按scope/窗口且无secret。

实际消费者与验收：原App不换壳，desktop/mobile/键盘/错误/旧接口有限真实回归；有界验证，不无限抛光或重复soak。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

### 成果 M9：固定版本整体交付与维护

实施：把选定源码与8cd709ca目录竞争修复交D冻结必要successor，E先保留W33已测范围，不因docs/test重包；更新使用/架构/创新/进度。

实际消费者与验收：同准确包的普通项目日常/非空迁移/升级支持与独立oracle，source/受控/安装/native/恢复/value分层，不靠99计划成果涨分。 不靠文档或孤立helper通过；正向和负向须在同原接口成立，范围/版本/未达保留准确。

交接：提交最小可运行生产源码和依赖、actual consumer命令/exit/原对象与证据层；main/F/H/D/E按其ownership消费，已交source后继续后续成果。

## 独立队列与完成条件

外部输入只阻对应项；发最小真实RFC/consumer后继续本owner兼容、错误、数据边界、日常使用和source交接，不无限轮询/重复长soak/复制另一owner状态机。上轮通过的真实正向保留，旧修复不重新派；新反例只是完整结果内部的必要修复。

仅owned：`packages/contracts/`、`packages/application/`、`packages/questions/`、`apps/coordinator/`、`apps/console/`、`agent-tasks/product-wave-35/`、`tools/bootstrap/`、`docs/rfcs/WP-16/`。main共享root/config/lock/HTTP/provider/App/transport/globalCSS/集成，排除Ftrial；只导入审过片段，不改候选树。A sole生产迁移、E sole产品断言、I sole通信，B排除I；共享contracts/HTTP/App/root只由main修改。

状态 `reports/releases/wave35-integration/status.json`；显式owned路径推原origin分支，main HEAD:main，neverupstream/reset/清状态。九项都有生产行为、真实consumer、必要正负、source交接才结束整goal；source/controlled/installed/native/recovered/value分开，未达不借其他层补齐。

自动真实vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不重置/补额/退款/借凭据/price-recipe研究。十二5180/8796至5191/8807以及全部state/profile/tar/ledger/dirty/history/runs/五用户日志保留。

完整originalspawn/privateimmutablebirth/PID/start/UID/orderedfullargv/root/config/op/fullresources先验且逐signal fresh；UNKNOWN保留全部材料。不globaldiscovery/substringkill/绕产品拒绝清理/真实CLI fallback。完整方案B/CAC后置，不新增Driver/desktop/autoaccept/writerracing/dynamicDAG/第二生命周期或账本。
