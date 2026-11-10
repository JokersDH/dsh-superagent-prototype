# Agent D：个人试用发行与第二执行器诊断

沿用D目录/分支，拥有launcher/distribution/portability。最终候选`bf85594`自报45步smoke仍是候选，尚未经main整包准入。模型预算0。先合并main并读取第五轮README/0020。

## D1 关闭恢复项目绑定阻断并复验旧整改

main已为recovery_readonly保留恢复项目范围，并禁止Runtime.start业务effects；带native-projects.json的独立进程回归已通过。合并后更新自己的repro为“成功启动只读、项目可读、命令拒绝、旧队列不消费”，不继续把旧错误复现成功写成新实现通过。

复验活跃/未知writer回滚拒绝、精确state/mode/access/ports/build/startupMode复用、孤儿PID/开始身份、同大小漂移、HTTP bundle标记与stage闭包。包内通过仍与main/E准入分列。交checkpoint继续D2–D5。

## D2 当前源码的可搬迁个人发行物

更新staged install覆盖最新main、A/C、routing/第二Driver新增包及实际执行入口，按真实依赖闭包/许可/原生ABI记录；不依赖原checkout、外部node_modules或Vite。启动校验实际执行字节摘要，失败不回退fixture。

新目录启动时让原checkout不可用，核对模块/动态资源全部来自install；缺Node/ABI/agent/认证/端口给稳定诊断，不升级全局runtime或重置native账号。未测平台/跨机器准确标未测。

## D3 多执行器first-run与doctor

消费B公开探测/准入结果和main配置入口，清楚展示作者/复核执行器的版本、能力与缺口。未找到第二执行器仍可用原已准入作者，附加复核不可用不得伪装已完成；必需复核模式缺能力明确blocked。

模型key只通过main现有/新增的可信私有设置入口保存，不建第二份秘密配置、不回显给网页/日志/bundle。若main first-run接口未到，交明确消费RFC并继续零模型诊断fixture，不自行实现产品HTTP或账号代理。

## D4 新证据的完整备份恢复与升级

消费A公开快照/引用索引，把route advice、review reports、profile/policy快照与完成patch纳入完整bundle并逐字节校验；库可打开不等于证据可读。坏/缺文件、版本不兼容、路径注入和IO中断失败不假成功。

恢复默认只读，旧profile/原生凭证/session/writer证明不能自动成为新授权；新目录重绑定/复验后的授权由main负责。D不能删除marker绕过。升级失败/回滚保留原state，活跃或未知state在任何rename前拒绝。

## D5 普通同事路径与E消费

交版本化安装物、manifest/支持矩阵和一条可复制流程：安装→配置/doctor→启动→静态工作台→停止→完整备份→新目录只读恢复→诊断/允许后才新授权→升级回滚。main尚未开放的恢复新授权步骤准确BLOCKED，不能因提供了CLI就称完整个人Alpha。

让E在自己新root独立使用同一安装物，不修改E断言。保留旧报告，新增wave05-status绑定源码和实际产物摘要/平台/测试层级。根锁main所有；只提交自有路径。
