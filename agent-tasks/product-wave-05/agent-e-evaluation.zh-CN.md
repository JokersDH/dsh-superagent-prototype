# Agent E：独立准入、复核收益与等预算评估

**先读 [修订01](AMENDMENT-01.zh-CN.md)。** 本轮E的第一优先改为预注册的独立会话小额价值试点，先判断是否值得继续新Driver投入，不能等完整路由平台做完才验证。

沿用E目录/分支，仅拥有product-acceptance。除独立grant `wave05-independent-review-pilot-01`外模型预算仍0；不替B发native任务，不改生产实现或别人的测试。旧gate50项自测与旧产品证据保留范围，不替代新源码复验。

## E1 前置独立会话价值试点与严格tier

消费main的`tools/experiments/review-pilot-01/protocol.json`，先固定8例4缺陷/4干净、隐藏oracle、真实作者checkpoint/续会话与新session、共同预算/盲评/seed和材料隔离证明。只用合成材料与现有Codex，不要求协议异构。不得用伪造作者历史或同session伪装独立性。

main已单独批准该pilot：最多24原生turn、20万全部计费token、5美元，任一到停。单turn可含多次推理，费用按实际/保守预留计算；reasoning/usage/价格无法核算或单turn无法界定就BLOCKED，不能借B余额/认为订阅免费。只一个turn在途，unknown保留预留不换ID重发，实验断样如实报告不补抽样。

三arm用相同冻结候选：不复核（零额外review花费）、续作者真实session自查、全新session独立复核。共同上限不等于实际消耗相等，分别记录历史输入开销/实际用量；自查与新会话相同model/version/工具/输出/时间限制。评分与mutation答案不能让reviewer读取。

先给go/no-go/inconclusive初筛报告，再开始新协议相关评估。8例只筛机制，不宣称统计显著、软件已被修复或异构普遍无用。严格tier和已有R0验收继续，不能以工具写完代替真实试点。

合并main复跑实际已有会话、项目设置、验证恢复、恢复readonly。消费A/C真实SQL消费者，不再沿用“C原三项未修”的旧结论；当前决定重放/同步commit缺口仍需真实验证。D/B候选未接线的项准确NOT_TESTED，别把分支自报变main通过。

在现有fail-closed gate新增advisory-routing、controlled-review、actual-heterogeneous-review的清晰tier；更高tier包含较低必需安全项。actual要求真实不同protocol、执行/版本/identity/budget/isolation/subject证据，不能把替换模型/fixture/schemavalid当异构。独立交该checkpoint，不将它当作价值试点结果。

## E2 推荐与确认负例

先独立验跨项目注意力聚合、真实期限/等待排序、过期问题无发送、分组不合并权限/认证、逐项人工审阅、模型离线可查/答/停。核对readyToAcceptanceMs与activeReviewMs代理、unknown非0、重叠区间不重复，UI采集不作权限/质量证明。

推荐仅实验入口，未过R0默认路径不得出现。独立构造0/1/多候选、缺native admission、身份漂移、旧政策/来源/合同、跨项目/越权、sealed_copy缺manifest/宿主边界、unknown费用/余额等输入。确认前无dispatch；旧建议确认拒绝；unknown不通过换Agent重发。

只有一个候选必须显示only_eligible，不接受假概率/质量排行。parser或schema400与合法过期业务拒绝分开。writer/receipt/profile来源身份要核对，不能只看页面文字。

## E3 冻结候选与独立复核

使用实际main HTTP/SQLite/Runner配受控peer走作者→屏障→冻结→独立辅助review→report→人工审阅。检查辅助Work/Ticket不占作者assignment，不另建作者current pointer；review者完成不能确认作者交付。

默认一次性密封副本，输入修改/逃逸链接/共享Git/作者目录可写都要被工具拒绝或使结果invalid，不能把副本“可丢弃”当无宿主边界。bad report、旧subject/digest、错profile、无隔离证明、权限/认证/取消/unknown、marker恢复均有负例。no_findings不覆盖机器FAIL，required human不被分数替代；旧报告不用于新候选。

## E4 与D的真实安装和错误出口

D提交安装物后在新目录让原checkout不可用，独立测first-run/doctor、HTTP bundle、依赖/版本诊断、多profile缺失、精确实例复用、并发启动/停止、完整备份/新目录readonly恢复/升级回滚。带native项目绑定和旧业务的恢复不能跳过，main本次修复应真实消费。

UI按现有DESIGN验桌面1440/笔记本1280/手机390、焦点/滚动/长路径/断线/旧建议/复核冲突，不重设计页面、不无限截图。故障给owner最小复现后继续独立项。

## E5 等预算对照工具与发布矩阵

汇总E1前置真实pilot与R0/注意力/安装证据，确认go/no-go后才追加后续异构对照。验证工具拒绝评分标准改写、空测试、泄漏、缺usage、不同预算与挑例；未执行pilot不能只交harness称价值已验证。

前置三arm按protocol执行。以后若扩到规则推荐/异构对照，单独明确同预算和新假设，大样本另立预算。分别报告检出/漏报/误报、后续独立质量、返工、人时代理、墙上时间、费用与unknown；第二品牌不自动代表独立误差。

集成后可做最多30周期或45分钟任一先到的受控混合稳定性，首次未解释不变量破坏即停。交精确源码/产物分层矩阵，实际异构或完整发行必需项缺失时完整gate非零；工具做完不等于收益或全产品已证明。
