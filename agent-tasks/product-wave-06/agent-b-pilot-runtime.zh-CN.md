# Agent B：现有Codex控制与有界试点运行整包

继续`/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`，保留`6b4e4ab`及已有修改，合并最新origin/main。读本轮README、0023及旧wave05任务。拥有execution/catalog/policy-preparation/driver-kit/testing、runner、drivers和native-acceptance；不改coordinator/console/contracts/root lock或E的病例/评分/断言。

## 交付目标与预算

为E提供可审计的现有Codex作者/续会话/新会话试点运行能力，补齐当前原生控制与恢复缺口。**本包不实现第二协议Driver。** E原24 turn/20万token/USD5 grant由E调用，不授权B额外付费smoke。B仅能核对并使用原wave03-b-native剩余额度关闭已有控制缺口；历史账/unknown保留，不从旧摘要推定余额。

## B1 更新基线、控制证据与精确身份接口

先更新当前交接，避免使用仍写wave03的旧execution-status作为wave06证据。核对原grant所有reserved/used/unknown与对应begin/attempt来源；不一致先阻断真实发送。

复验现有exact ExecutionProfileRef resolver、Catalog/政策快照、schema400/业务拒绝、重复命令和控制身份。提交main/D/E可消费的窄接口与零模型例：native/model/driver/SDK/配置指纹、可用能力与证据层、明确缺口。认证文件存在只能作为提示，不能宣称认证可用或native兼容通过。先push稳定检查点继续后续。

## B2 E可调用的真实会话与运行边界

复用已安装Codex和正式SDK/原生协议能力，不自建LLM循环。提供可验证的作者checkpoint、真实续会话、全新session、报告收集、取消与未知发送核对；每次运行绑定稳定case/arm/turn身份和明确材料摘要。

接口可采用inspect/createAuthorCheckpoint/continueAuthorReview/startFreshReview/reconcile/cancel等操作，但必须在源码/例子里明确实际签名和副作用。构造/inspect不得隐式启动模型；所有可能发送业务的路径都先经E的持久预留钩子，缺钩子拒绝，不能从直接CLI/SDK绕过。新session不得继承作者或其他review历史，续会话不得用拼接“作者推理”冒充。

交真实会话身份/turn/checkpoint的脱敏证明方式，保留私有原始轨迹不入Git。若当前版本无法实现某一能力，给出明确能力缺口及可复用替代方案的证据，不假造session或自行换provider/模型开始试点。

## B3 一次性胶囊及宿主边界

默认从已冻结材料全量复制到一次性目录，排除.git/共享objects/remotes/hooks/逃逸symlink/hardlink和共享inode，记录manifest。允许指定scratch写，原候选材料改动则input_mutated/invalid；测试不能被改后拿来证明原candidate。

单独验证宿主文件/工具、作者目录、账号home/凭据、工具环境和网络/数据外发限制。副本或cwd不是沙箱，prompt不是权限；只禁止写用户项目而仍能读凭据/外发源码不能称隔离通过。允许必要原生传输凭据使用，不允许把其内容交给模型工具或报告。不要重置用户账号或升级全局runtime。

交main/E可运行的零模型拒绝/逃逸/输入变异/清理负例，sealed_copy证明和manifest绑定具体材料/运行身份。native严格只读可为备选，不强迫原生禁止写可丢弃scratch；不设计通用容器平台。

## B4 价格、usage与单turn硬边界

为当前pricing_unavailable给出实际provider/model/别名映射、可核对计费来源和runtime可提供的usage字段；找不到就记录unavailable，不套另一个产品价格或把订阅填0。价格资料供main/E核对，不修改E的评分或账本。

证明每次发送前能保守预留所有计费输入/输出/reasoning/cache和可能的多轮工具推理，运行可在剩余配额内停止。墙钟timeout、cancel已发送、max_output_tokens单字段或最终才收到usage，均不能单独证明整个native turn费用有界。不能证明就blocked，不能先发再估。

用受控peer覆盖预留成功/失败、未知发送、重复回调、进程终止、cancel未齐、缺usage和账本恢复；未知发送沿原身份核对，不另起turn、不退款冒充未发送。价格、身份、材料或执行上界变化使旧预检失效。

## B5 现有原生控制/问题/恢复收口

零模型先覆盖真实受控进程的begin前后、问题持久/答案待投、报告返回、writer停止与恢复窗口。保留一个recovery transport/proof实现，不复制WeakMap或另建生命周期。

确需真实原生控制时，只在原grant剩余额度内按预留和确切目标执行；证明活动writer上的停止、逐target问题投递、epoch/attempt漂移及未知发送核对。没有出现目标窗口就NOT_TESTED，不能无限重跑碰运气，也不能将受控停止作为真实vendor停止证明。E试点不扣这笔账，本包也不测试新协议。

## B6 E联调、D诊断与最终证据包

与E用零模型peer联通预留→运行→usage/停止/核对→报告路径，main核验后由E独自执行pilot。向D提供可读且不含秘密的版本/能力/缺口诊断消费例；缺认证或能力保持明确降级。

更新`tests/native-acceptance/reports/wave06-status.json`及拥有模块的接口说明：branch/base/source、实际导出、版本与source绑定、native/controlled分层、原grant及未知账、每项缺口owner。交付可执行recipe，不能只交协议调研。

## 验收出口与遇阻继续

- E可证明作者续会话和独立会话不同，运行无预算钩子不能发送。
- 预留/usage/未知发送/取消边界可由main/E复跑；真实能力缺失明确blocked。
- 胶囊与宿主限制分别给证据，scratch可写不影响作者材料。
- 原生控制按真实已测/未测准确交接，旧账不刷新。
- 价格或真实session受阻时继续受控协议、隔离反例、恢复与诊断；不转而建第二Driver或扩大模型调用。

```text
继续第六轮Agent B整包。保留当前目录/分支、原生账号与全部预算账，合并最新origin/main，读agent-tasks/product-wave-06/README.zh-CN.md和agent-b-pilot-runtime.zh-CN.md、WP-16/0023。
完成B1-B6：精确身份检查点、真实session/checkpoint运行接口、密封副本与宿主限制、费用/usage/硬边界、已有控制恢复、E/D可运行交接。先交接口再连续完成整包；本包不实现第二Driver，不代E消耗pilot grant，不改coordinator/contracts/E断言/root lock。
```
