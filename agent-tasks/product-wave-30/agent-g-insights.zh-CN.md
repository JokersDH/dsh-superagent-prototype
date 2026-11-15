# G：可信观察与实际用户数据导出

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-g`，原分支 `codex/g4-usage-insights`；固定验收输入 `e7aec80e1c613d427cf550bf927d3d04776d33e2`。
保留全部历史/dirty，fetch并合并最新origin/main，读AGENTS、START-HERE、product-spec/README和[本轮README](README.zh-CN.md)。
读[0077实际组合](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078本轮事实](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079完整成果](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md)。
只拥有：packages/usage-insights/、tools/usage-insights/、reports/usage-insights/。根契约/HTTP/App/transport由main唯一组合，A迁移、E断言独占，原所有权不变。

这轮按四个完整子系统成果执行，不机械增加小阶段数。整包可连续跨多个工作日推进，不设当日deadline或token预算，不承诺耗时。
建立/沿用覆盖整个结果的goal，四次可运行source交接后都继续整包与独立队列；交一个helper/文档/小修不算成果。状态 `reports/usage-insights/wave30-status.json`。

## G1 同一授权窗口的报告与导出闭环

目标：把已有export库变成main真实观察的可消费成果，按原public reader/GETinsights范围工作，不另起collector或统计权威。

实现范围：

- 原export31定点/strict已有通过，保留row/byte bound、截断/unknown/currency/layer语义；真正消费当前main观察而非另一个旧bundle。
- 给main最小Node export interface和实际调用；导出绑定当前项目/7或30天/时区/summary与观察时间，若重新读取明确是新snapshot，不冒充之前显示值。
- 严禁从格式化字符串反推数值/丢currency；若只有displayDTO就定义display-only导出，不贴numeric-analysis身份。
- 未知/partial、缺输入/小样本和UI活动代理在导出里保留，不从价格表/订阅/另一来源补零或声称收益。

实际消费者：当前main已实现0073/0076/0077，使用同一准确source及原公开接口；缺候选feature时标未达，不以模拟返回代替。

验收：同一次明确范围的页面、报告与导出可互相核对；合法正向、超行/byte、坏来源、跨范围、canary和旧snapshot负例有限通过。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## G2 当前产品的稳定指标语义

目标：沿原schema优化source枚举覆盖与每个metric有效覆盖，保持不同证据层、币种和样本定义。

实现范围：

- 实际路由GET /v1/insights，不建错误usage-observation别名；main0076 UI7/30和key已实测，报告及时更新。
- header枚举work样本和row自己的samples区分；sourcecomplete不代表某行有值，partial proxy不意味着所有源没枚举。
- metric key在同metric/layer/currency稳定唯一，任何变更给main可编译compat与适配，不静默更换导致浏览器同一行错配。
- 用真实两项目Q/A/accept/ReviewTiming和原HTTP采集验证重复不累计，未来/边界/同名/撤销/历史新版本来源不混。

实际消费者：项目/配置/模块/运行包身份均来自本次明确输入，继续复用原产品与已有owner实现，不新增平行权威。

验收：main实际消费者在7/30、跨项目/部分/缺失/不同币种下输出可解释一致结果，未知不变零，没有来源权限扩大。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## G3 可日常使用的只读工具与性能边界

目标：交付当前source/dist兼容的CLI/库和脱敏导出，不以大样本模型研究或新后台任务代替实用性。

实现范围：

- requests/pages/works/nested/bytes/接受deadline均有界，拒绝前不中途偷读任意root或原始凭据；流式HTTP累计并abort。
- 明示capture/source/layer/truncation和实际units，报告不打印prompt/rawdetail、私有绝对路径/key或未收集的人体时间。
- 新建0600文件/不覆盖，失败不留下假完整fragment，导出byte/digest校验绑定实际写入bytes。
- fresh Node消费者/build闭包不借别树node_modules；browserentry无node builtin，raw analyzer只Node。

实际消费者：相同原Work/项目/source和用户明确操作，通过真正入口观察结果，旧source/fixture/installed/native分层保留。

验收：同事可按当前CLI完成一次只读观察与导出，重复运行稳定，所有异常有准确code/脱敏信息/限额且不写产品事件。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## G4 主线与同包产品交接

目标：用同一准确D包/实际main端口与F展示完成观察→范围切换→报告/导出→原工作返回。

实现范围：

- 与main合作只改G包/工具/报告；mainHTTP/transport/App/rootlock唯一owner，不复制另一套UI/reader/ledger。
- E独立核实际同包表面和隐私，不用G的summary声明当release或native许可。
- 当前没有真实operator长期历史/模型成本基线则保持NOT_TESTED，不做新的价格配方研究/重启blockedreviewpilot。
- 给最终API不变量、错误/预算、source/包元组、真实例子与未达范围；交后继续独立队列到整包完成。

实际消费者：main/D/E/F与该模块的实际接口和准确运行字节相对应，独立验收不修改断言使之通过。

验收：完整库/工具、main消费、用户可下载数据和同包证据可审查；不以测试数替代效率价值或发布。

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
