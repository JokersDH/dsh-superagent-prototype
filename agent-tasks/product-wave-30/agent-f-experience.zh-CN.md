# F：完整日常工作台与真实委托体验

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-f`，原分支 `codex/g4-trial-experience`；固定验收输入 `901090ac6a3e818e28e4bf348a59e6a4cc38293f`。
保留全部历史/dirty，fetch并合并最新origin/main，读AGENTS、START-HERE、product-spec/README和[本轮README](README.zh-CN.md)。
读[0077实际组合](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078本轮事实](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079完整成果](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md)。
只拥有：apps/console/src/trial/、apps/console/test/trial/、apps/console/e2e/trial/、docs/user-guide/、reports/trial-experience/。根契约/HTTP/App/transport由main唯一组合，A迁移、E断言独占，原所有权不变。

这轮按四个完整子系统成果执行，不机械增加小阶段数。整包可连续跨多个工作日推进，不设当日deadline或token预算，不承诺耗时。
建立/沿用覆盖整个结果的goal，四次可运行source交接后都继续整包与独立队列；交一个helper/文档/小修不算成果。状态 `reports/trial-experience/wave30-status.json`。

## F1 当前项目到原交付的完整体验

目标：以main0077真实suggestions→受限callback→原NewWorkForm为唯一委托入口，从项目/模板选择到预览应用、编辑、创建、提问、检查、候选和明确接受完整走通。

实现范围：

- 旧blocked/discussion/expiry/exclusion方向已真关，不重复派旧修；收口新声明scope与preview.allowedPaths不一致而仍applicable的P2，所有展示与实际点击范围相同或明确拒绝。
- 不重建完整scope/criteria，不让追加exclusions在受限回调里无声丢失；消费main当前严格fields和原表单，不能以UI判断授予权限。
- 给main原工作台导航/数据接口的最小可编译props，root App/transport由main改，F不另写HTTP或新表单。
- 两个真实项目实际问答/检查/证据/人工接受/重开和未知同ID重试，取消零业务写，source/controlled范围清楚。

实际消费者：当前main已实现0073/0076/0077，使用同一准确source及原公开接口；缺候选feature时标未达，不以模拟返回代替。

验收：能由E在相同source从工作台完成两个项目交付；正向、跨项目、旧输入/已过期、范围矛盾和网络未知均有可重复记录。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## F2 反复使用的工作/待决定/交付视图

目标：围绕用户每天扫描和返回原工作的流程完善试用工作台，不新增第二调度器或把页面做成演示仪表板。

实现范围：

- 项目、会话、工作、候选与原问答归属清楚；从待决定/交付/统计返回原对象时保留草稿和当前审阅状态。
- 消费main0076真实7/30接口与配置/项目/时区key，不再报告主线缺30天；partial/unknown/行样本/币种/证据层逐项保留。
- 空项目、旧API、无模型/执行器、只读恢复、鉴权过期、连接重开和错误路径均可退出/重试，原四导航不退化。
- 记录减少重复输入/找信息的实际操作观察，不称人力节省或因果收益，不启模型/价值试点。

实际消费者：项目/配置/模块/运行包身份均来自本次明确输入，继续复用原产品与已有owner实现，不新增平行权威。

验收：连续执行多个任务、切换两个项目和关闭重开后仍可用；不同视图的等待/错误不把另一来源的旧数字或草稿当当前。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## F3 精密工作台的可访问性与移动品质

目标：沿impeccable和原DESIGN做局部统一，设计质量服务反复操作，不换视觉世界或装饰card。

实现范围：

- 在自有trialCSS统一已有token、紧凑信息层次、长中文/路径/计数换行；可变内容不改变固定工具尺寸。
- 键盘可聚焦、可见焦点、菜单/表单/抽屉返回、screenreader名称和7/30 pressed语义正确；selected不靠disabled低对比表达。
- 390窄屏、桌面、长错误/多项目/加载/hover/空与真实数据集中验证，不只截图；原移动抽屉互斥与底栏保持。
- 需要根CSS修复给main具体source/viewport，不并改全局文件；视图后端权限不由文案/颜色推断。

实际消费者：相同原Work/项目/source和用户明确操作，通过真正入口观察结果，旧source/fixture/installed/native分层保留。

验收：真实浏览器能完整操作，关键内容不重叠/截断；源码、截图和交互事实绑定准确，未测reader/浏览器明确记录。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## F4 同一安装包的用户交接与长期用法

目标：消费D最新source/build/tar/hash/schema/ABI/mode，给E可重复的完整用户journey与用户指南。

实现范围：

- 先核包确含0073模板/0076窗口/0077工作台再测，不把旧1fba或1ba报告贴最新入口；docs-only不要求D重冻。
- 指南从实际入口写项目导入、模板委托、集中回答、验证接受、重开/只读查看和问题诊断，用户界面不堆架构教程。
- 保留失败/缺能力时的原手动流程，不猜真实native准入、自动接受或共享他人权限。
- 以当前功能完整性/错误恢复/跨会话可用性结束整包，不以截图数量/阶段数或用户离线时长作为完成。

实际消费者：main/D/E/F与该模块的实际接口和准确运行字节相对应，独立验收不修改断言使之通过。

验收：main/F/D/E对同一运行字节的可用动作和未达说明一致；源码、指南、实际用户结果与剩余缺口齐备。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## 独立备选队列

外部依赖只阻对应结果：先完成本owned模块真实consumer/兼容/错误/预算/文档及必要实现，早发布可编译接口让main渐进消费。
不无限轮询、无意义重跑长soak或复制另一owner实现；队列穷尽才交准确NOT_REACHED和最小依赖，不把PARTIAL叫wholegoal完成。
J旧future-facts/P2和Fscope-preview矛盾等按真实新source闭合，已有通过范围只保回归，不重复当新成果。原main0073模板和0076窗口已实现，不长期报告缺入口。

## 整包完成条件

四个成果都有可运行实现、真实consumer、完整合法positive/独立negative、必要兼容、准确source/包元组和明确限制，才结束整个goal；checkpoints不是等待点。
全部自动vendor/model/native0，B原cap4UNKNOWN不可花/E原24turn/200000token/USD5/单在途pilotBLOCKED，无reset/topup/refund/补样/价格配方研究。
保留十二服务5180/8796至5191/8807和所有state/profile/tar/ledger/B旧diff+b16/C lock/E runs/五用户日志。完整独立birth/UID/start/fullargv/root/config/op与资源计划先验，每signal fresh，UNKNOWN保留；无global发现/substring强杀/其他credential/真实CLI回退。
无新Driver/CAC/桌面/autoaccept/writer racing/动态DAG/第二生命周期；仅显式owned paths推原origin分支（main HEAD:main），不upstream/reset/清旧状态。静态任务/测试数不提供runtime/native/release准入或上调完成度。
