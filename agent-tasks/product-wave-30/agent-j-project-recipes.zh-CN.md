# J：生产可用的项目模板与事实治理

2026-11-15。继续 `/Users/hh/Desktop/joker/superagent-agent-j`，原分支 `codex/g5-project-recipes`；固定验收输入 `bd027a4450e43dde09d5b18b4659e5028664d911`。
保留全部历史/dirty，fetch并合并最新origin/main，读AGENTS、START-HERE、product-spec/README和[本轮README](README.zh-CN.md)。
读[0077实际组合](../../docs/rfcs/WP-16/0077-main-workbench-product-composition.md)、[0078本轮事实](../../docs/rfcs/WP-16/0078-wave-30-reviewed-architecture.md)、[0079完整成果](../../docs/rfcs/WP-16/0079-wave-30-outcome-packages.md)。
只拥有：packages/project-recipes/、tools/project-recipes/、docs/project-recipes/、reports/project-recipes/。根契约/HTTP/App/transport由main唯一组合，A迁移、E断言独占，原所有权不变。

这轮按四个完整子系统成果执行，不机械增加小阶段数。整包可连续跨多个工作日推进，不设当日deadline或token预算，不承诺耗时。
建立/沿用覆盖整个结果的goal，四次可运行source交接后都继续整包与独立队列；交一个helper/文档/小修不算成果。状态 `reports/project-recipes/wave30-status.json`。

## J1 当前事实与模板重用的完整一致性

目标：以main0077实际注册root→J→工作台建议→原form为真实消费者，修完通用freshness/输入兼容，再交稳定模块。

实现范围：

- 旧atom兼容/同配置Application已关，不重做prefix授权；保留.、尾斜杠和原excluded/expiry，main仍最后授权。
- 新P2：assertDraftCurrent同内容future observedAt可通过now校验，补future/invalidnow/configversion/schema/expiry边界；不能靠调用方不传now假称已核当前。
- 观察身份digest与稳定contentDigest分开，timestamp不授权限，旧草稿缺新增provenance字段的兼容策略明确版本/拒绝。
- runtime/CLI/source/dist只有同一matcher与observer，公开selection无root，返回draft不意味着工具已安装或可执行。

实际消费者：当前main已实现0073/0076/0077，使用同一准确source及原公开接口；缺候选feature时标未达，不以模拟返回代替。

验收：同一config/真实root的新旧观察、future/stale/changedmetadata、malformedcurrentconfig及合法reobserve均准确；main既有5+工作台用户流不回归。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## J2 真实项目的有界读取与版本治理

目标：围绕真实项目反复读取、文件被替换和缺能力完成可靠Node模块，不编新scanner或安装系统。

实现范围：

- 原inode/size/mtime前后检查与NOFOLLOW保留；root/file替换、shortread、权限失败/非普通/links/文件和总预算都有明确结果。
- MetadataLimits本身也校finite/safe值，不能配置负值/NaN/无限预算绕过；脚本名/lock读不等于脚本正文可以执行。
- monorepo不猜成员，未知manager/stack/version有准确needs_input/unsupported；只引用已登记check/profile，不自动换agent。
- 将partial/digest输入集合/省略项可解释地交main，不用空列表假装完整来源；无秘密原文或私有路径。

实际消费者：项目/配置/模块/运行包身份均来自本次明确输入，继续复用原产品与已有owner实现，不新增平行权威。

验收：用户重复预览当前Node/npm/pnpm/monorepo项目时确定性稳定，异常保持原文件/DB/registry不变，源和限额可复现。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## J3 模板到用户工作结果的完整多项目消费

目标：以三个实用模板和当前原Application/Workspace/CheckRegistry完成两个不同项目的实际委托输入。

实现范围：

- 分别覆盖回归修复/有限变更/验证跟进、同名不同ID、相异profile/check/原scope、已过期/归档/blocked；不是只UserCommand schema。
- 用户goal编辑只改变goal，scope/criteria/profile保持原当前预览；更多排除/缺检查/冲突选择不能在F受限callback里无声消失。
- 与main/F对齐新实际ProjectRecipePreview/Fields和suggestion映射；不重造完整fields或用hash当grant，不伪造模型Proposal。
- 当前已闭未知创建响应samecommandID逻辑保留，J不接管command ledger/SQL/native循环。

实际消费者：相同原Work/项目/source和用户明确操作，通过真正入口观察结果，旧source/fixture/installed/native分层保留。

验收：Node库→实际main预览→原表单编辑/确认→原check/currentcandidate/manualaccept在两个项目可重复，取消/preview零业务写。

交接：提交最小完整运行source、public interface/例子、命令exit/实际动作和未达范围；推原origin分支，发布后继续下一完整成果。

## J4 完整可打包产品模块与同事开发交接

目标：交付真正可安装的runtime/CLI/docs/API与main/D/E同包使用，减少每次接线追问。

实现范围：

- contracts→project-recipes的构建/exports/import闭包和readme/sample/fresh caller齐，根workspace importer/lock只main改。
- D新包必须含实际Jsource/dist和0076/0077主线入口，Einstalled只按相同tuple，不把历史1fba或旧packdryrun当最新包。
- 文档给功能/支持限制/错误码/重用预算/版本策略和实际source操作命令，不写只测过的猜测。
- 主线必要接口变化给最小RFC+真实consumer，不新增runner/verifier/ledger/gate或后台授权。

实际消费者：main/D/E/F与该模块的实际接口和准确运行字节相对应，独立验收不修改断言使之通过。

验收：库/工具、用户模板、运行闭包、应用验证与准确指南齐备；未测平台/native/value单列，source发布不等于停工。

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
