# Agent E：同源网页、安装与恢复独立准入整包

继续`/Users/hh/Desktop/joker/superagent-agent-e`、`codex/g3-product-acceptance`。读[README](README.zh-CN.md)、[0029](../../docs/rfcs/WP-16/0029-wave-08-product-closure-and-reviewed-inputs.md)及0028。仅product-acceptance，产品实现/B runtime/公共schema不改。

本轮研究执行封存BLOCKED，所有新阶段真实模型发送0，原grant和账本保留。大成果是同一source/artifact的日常网页与安装/恢复独立验收；不把旧source报告映射到新candidate，不重复已完成tier拆分。

## E1 先补账本迁移和身份/费用拒绝漏洞

v1 legacy仅actual turns/tokens为0不足：wrong grant/caps、BLOCKED_UNKNOWN_USAGE、非零reservation/actual unknown不能迁为新零账；验证全部原身份、预算、历史完整性和unknown，无法证明就拒绝。字段缺失不能等于历史为零。

adapter缺model/provider必须拒绝，不能null身份也ok；costUSD缺失不能以0结算，保留占用上界/unknown并阻断发送。fake发送计数必须0，负数/NaN/无穷/重放/并发/历史截断均覆盖。先push这一可运行checkpoint，不改实际原账。

## E2 消费B单一拒绝入口并封存研究

移除E另spawn CLI exec的实际后备执行，消费B拥有的唯一运行入口；E只提供明确grant的持久reservation。不能靠descriptor布尔/字符串或补price文件绕过launch/Seatbelt/整turn上界事实。

当前NO_SUPPORTED_BOUNDED_RECIPE保持不发送，测试缺接口/身份/host/上界/价格/账任一项fake发送0。原实验冻结、预算和0/24结果保留；不换provider/模型、补样本、退款unknown、做付费smoke或继续扩充无限dry-run。此阶段只关闭有限拒绝反例，不阻断E3–E5。

## E3 独立验证最新提案与上下文用户流程

先消费main已交627ef0d的提案prepare/confirm/reject真实HTTP，main网页/context检查点发布后再补browser。不再说C负责HTTP或main无proposal入口；确认前无效果、缺输入、拒绝、同命令重放、source/grant/profile漂移和outer receipt失败皆有断言。

两个真实隔离项目/会话、刷新/响应丢失同命令、旧决定被替代/撤销后的预览、过期context grant不得读provider、caller预算不扩大范围均要测。权限/认证答案不可成为共享知识。controlled数据与真实模型范围分列，网页无入口就明确main blocker，不用库层PASS替代。

## E4 以显式产物身份独立安装升级

去掉固定旧dirty12/wave06包充当“当前候选”的隐含输入。baseline/target tar+sha/source/build/schema作为明确参数，拒绝同tag不同字节/同binary假跨版本。旧source结果保留历史，新verdict只对所测组合成立。

对D当前或后续冻结target实际cold install/PA_CONFIG_ROOT/doctor、模式保持、升级/失败目标清理、活未知PID阻断、升级后新数据/binary回退、准确schema拒绝进行独立测量。release_artifact_missing不能算schema拒绝。源manifest需完整、运行器不能借作者checkout，不修改D断言。

## E5 验证恢复激活与有界可靠性

main target协议真实发布后，结合A生产port/D启动，覆盖source commit前/后、目标准备半写、激活指针/启动后响应丢失，旧queue/marker不变、新state空业务队列且不继承授权。source receipt本身不能启动任意目标。

未知writer/错机器/旧ended/PID缺失不放行；再备份恢复须重新确认。加入有界多tab计时区间并集、跨项目动作/关闭重开与中断恢复；不无限soak，明确次数/时限。缺真实入口记NOT_TESTED并指main，prepare预检不算激活。

## E6 出同源矩阵并清理过期汇总

维护`tests/product-acceptance/reports/wave08-status.json`，source/build/hash/测试代码来源和module/controlled-product/installed-alpha/actual-native-control/review-value逐列清楚。旧两binary升级已测的范围照实保留，但不得替新target结论；旧CONFIG-ROOT失败不能自动套到D修复后的包。

更新externalBlockers/next/untested，避免同一文件前面升级PASS后面又说缺第二产物。真实native无证据仍NOT_TESTED，review-value BLOCKED不是no-go。先E1后连续E3/E4准备，不等研究；只push原分支，不改用户服务/预算。
