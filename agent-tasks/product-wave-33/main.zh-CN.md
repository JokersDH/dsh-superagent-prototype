# main：十路真实消费者与原生命周期持续集成

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent`，原分支 `codex/g2-execution-integration`，保留全部dirty/history并fetch/merge origin/main。
读AGENTS/START-HERE/product-spec/README、本轮[README](README.zh-CN.md)、[0083已交接线](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)、[0084验收边界](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)、[0085整块程序](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。

wholegoal覆盖下列三个完整工程成果，每个包含实现、实际consumer、必要正负与可运行source交接。source早中晚发布后继续当前目标/联调/独立队列，不在小fix停工，无工时/token/同日deadline承诺。

## 成果一：已交依赖与后续真实恢复接线

1. fc38bf65已发布原RunningAttempt.attachPort独立clone、B新caller与4realStore回归、F六源和实际recipe retry/support。旧等待this.handle/端口未供给已解决，不重新设计registration或误称full recovery。

2. 继续在原ProductExecution/NativeProductAttempt/runner registry上消费B的真实feed与reverse callbacks：原Work/合同/attempt/producer/原Questions、实际Store事务ACK、immutable payload和原fresh guard共用。

3. 同进程重接先走通；再用原持久登记在新coordinator取回原run。恢复只读marker、当前项目/身份/版本/授权不满足就拒，不自动重放unknown业务，不复活旧allowed。

4. 本地接口如需新增transport命令，只允许原RunnerCommand与现有权限边界内的加法方案，经共同RFC后由main冻结；不新建coordinator、candidate表、ledger或执行生命周期。

验收/交接：合法路径和独立负例都消费真实接口，给准确source、命令exit、原对象和证据层。候选未合/未安装就注明，不把helper/文档/全绿测试单独叫成果完成；公开可运行接口后继续下一成果。

## 成果二：默认产品能力与当前配置/数据的一致接入

1. 渐进消费A有界历史/byte事实、C明确决定/选定上下文、G支持报告、J迁移重识别；先给稳定可编译port和实际消费者，再补整链负例/兼容，不等十枝齐交。

2. 补齐模型连接的可信本机配置体验和明确委托上下文：key写入仅本机认证入口、0600原配置、不可回显，修改不自动发模型/重试。接口/APP仍main唯一owner。

3. 明确项目决定用于新工作时绑定原来源/范围/版本和原用户确认，不将候选知识当权限；更改来源/配置/过期须重验，不静默改旧合同。

4. 支持/安装身份由当前受验证运行事实提供给公开DTO和F，只读display不授权限；缺身份保持未知。原root锁、公共schema/生成和frozenRunner hash保持可核。

验收/交接：合法路径和独立负例都消费真实接口，给准确source、命令exit、原对象和证据层。候选未合/未安装就注明，不把helper/文档/全绿测试单独叫成果完成；公开可运行接口后继续下一成果。

## 成果三：同一工程版本的用户旅程与验收

1. 维护实际App/core/Broker/SQLite/Workspaces/check/accept的真实consumer，覆盖两原项目、问题/补充/修订/取消、候选、全产物、同Work重开及恢复。

2. E是唯一产品oracle owner；main不改其断言使之绿，H抢跑currentCandidate错误不可误修产品gate。source/受控/native/安装/恢复/收益逐层汇总。

3. D并行维护发行完整子系统，选定source后冻结；E锁准确字节验，不追移动main。打包只作为集成与最终交付，不回到临时ZIP冲刺。

4. source早发布、验证有界、保存真实失败及修复，不重置用户state/预算，不因测试或分工数量上调完成度。CAC仍排除，研究blocked不阻独立工程。

验收/交接：合法路径和独立负例都消费真实接口，给准确source、命令exit、原对象和证据层。候选未合/未安装就注明，不把helper/文档/全绿测试单独叫成果完成；公开可运行接口后继续下一成果。

## 独立备选队列

外部输入只阻相应项；先发最小稳定接口/consumer让main组合，然后推进owned错误/兼容/数据完整性/必要验证/操作文档。不无限轮询，不重复长soak，不复制第二reader/状态机或另一owner源码实现。根契约/HTTP/App/transport不足先RFC给main。

## 所有权与运行边界

仅owned：`root/contracts/config/lock/HTTP/provider/App/transport/globalCSS/跨模块集成`、`tools/bootstrap/`。

状态 `reports/releases/wave33-integration/status.json`；显式owned路径推原origin分支，main HEAD:main；不upstream/reset/清状态。A唯一生产迁移，E唯一productassertions，I唯一通信核心，B排除I，main排除F trial。

自动真实vendor/model/native0；Bcap4UNKNOWN不可花、E原24turn/200000token/USD5/oneflightpilotBLOCKED，不reset/topup/refund/补样/借凭据或价格研究。十二5180/8796至5191/8807及全部state/profile/tar/ledger/dirty/runs保持。

完整独立原spawn birth/UID/start/fullargv/root/config/op/fullresources先验，每signal fresh，UNKNOWNretain；不global发现/substringkill/绕产品拒绝清理/真实CLI回退。无新Driver/CAC/桌面/自动接受/writerracing/动态DAG/第二生命周期；CAC是后续独立实验。

## 整包完成条件

三个成果都有生产实现、真实consumer、必要正负、可复现source交接和准确限制，才结束整块goal。外部installed/native/研究未达保留为该层未达；有独立工程队列就继续，不能借缺外部结果停止整条责任线，也不越owned范围补它。
