# Agent E：可信发布门槛与完整个人版独立验收

沿用E目录/分支，仅拥有tests/product-acceptance。候选`6dee03f`的controlled正常流程/浏览器/有限稳定性证据保留；full-product gate已复现假通过。先修工具，再独立验main/A/B/C/D，不能修改生产实现或降低断言。

## E1 发布工具反例先行

主线复现：full-product七个case全标controlled-fixture、native.executed=false、source.dirty=true、无逐case源码绑定、必需证据为空对象，evaluateRelease仍PASS。运行`node tools/bootstrap/review-wave04-admission.mjs --acceptance-root <你的checkout>`可重复。

把每个原因拆成独立变异测试：wrong layer、未执行native、dirty/missing source、过期/跨commit、空/错误证据、缺case、断言失败、缺下载bytes/patch应用、重复ID与unknown。原生必需项声明exact actual-native layer、已执行/版本/attempt/command/原始证据引用；不能依赖case自贴layer绕过。

full-product/更高tier必须包含全部较低tier必需安全用例再加发行/原生要求，而非只挑7项。小范围tier名称和说明准确，NOT_TESTED不能靠--allow-gap变成完整发布PASS。早期提交修复检查点，继续E2–E5。

## E2 独立验当前主线增量

消费main公开conversations与verification恢复接口：持久新建/搜索分页/CAS重命名/归档恢复、混合项目/旧纯聊天、空授权、活跃归档仍可见；草稿会话隔离、重载持久、桌面/手机操作可达。

验证blocked→明确recheck→同候选验证→人工接受→重开；旧blockedId、重复命令、换载荷、过期授权、旧候选、资源清单变化、machineFAIL均不能新开writer或绕过。schema合法业务反例与400解析拒绝分别计数。

截图对照既有DESIGN，主要验证新状态/错误/窄屏/焦点/滚动与下载字节；不重设计UI或无限截图。每批汇总可复现缺陷及owner。

## E3 助理端到端与事务破坏测试

先验C三项失败和修复，再在main公开接口到达后测真实A持久端口→明确来源决定→授权上下文预览→结构化mock提案→人工确认/拒绝→原子命令/回执→重开→撤销/失效不再采用。

注入不可信源码指令、另项目/会话/actor、旧合同/摘要、撤销grant、超预算、confirm后崩溃、事务失败、同ID重放；确认前无业务效果。模型调用0，不请求真实网关。接口未到先写同schemafixture，报告NOT_TESTED继续其它阶段。

## E4 安装与恢复独立验收

D修复后测试真正staged安装物，在新目录运行且原checkout不可用。覆盖first-run、HTTP bundle而非fixture回退、缺依赖/ABI/端口、精确实例复用、同大小内容漂移、PID复用和state前缀碰撞。

保持活跃writer时rollback必须在移动任何文件前拒绝；恢复带旧队列的库首次启动必须只读且零业务发送。未重绑定/未知writer不能因旧证明变ready。完成交付的patch/证据在恢复后按bytes/hash读回；密钥/native home/session/socket不进入bundle；损坏/穿越/版本不合/升级失败均可复现。

只测新目录不能写跨机器PASS。native证据消费B已提交账本与结果，不代B发任务；更高tier缺原生/迁移证据必须非零。

## E5 有界周期与最终矩阵

集成commit上最多30周期或45分钟任一先到的混合工作/问题/失败/停止/重开；首次未解释不变量破坏即停，记录seed、attempt/begin/dispatch/receipt及可测资源，不靠端口数证明无泄漏。

源码与证据分开dirty定义但不能排除测试实现本身；报告绑定已提交精确代码和分层真实范围。交支持/失败/未测矩阵、非零完整发布gate、普通同事安装/恢复路径的独立结果。自身所有suite PASS只证明suite，不替代仍缺的必需能力。模型预算0，显式暂存自有目录并push本分支。
