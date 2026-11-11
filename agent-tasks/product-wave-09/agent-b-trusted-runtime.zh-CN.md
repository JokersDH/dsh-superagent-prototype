# Agent B：可信资源屏障与不可重放发送整包

继续`/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`。读本轮[README](README.zh-CN.md)、[0031](../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)。拥有execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance，不改main屏障/HTTP/schema或E断言。

NO_SUPPORTED_BOUNDED_RECIPE保留，不再调查当前Codex费用上界。原grant余量UNKNOWN不可花，全包真实模型0。大成果是可由main/D消费的可信运行支持；先关普通JSON放行和token重复发送，不能以更多selftest掩盖这两项。

## B1 先使普通资源JSON失去放行权

resource-facts必须消费既有VerifiedRunnerInspection/认证proof边界；禁止另建平行WeakMap或让caller字段拼成证明。缺machine/时效/runner/attempt/epoch/source/writer或注册资源清单任一项保持unknown/拒绝。

requiredAt实际校验，不只存进输出。正对照使用现有可信factory；七个已发现的普通JSON反例全部不得releaseBarrierSatisfied=true。先push最小修复checkpoint，main旧屏障不被新summary替换。

## B2 对齐当前屏障与完整资源语义

与main现有resource-barrier/registry协议对齐：fresh authenticated inspection、完整登记资源及terminated/closed等真正终态；serving不是释放证明，PID缺失/旧ended/新generation不放行。

覆盖重启、epoch/source漂移、过期proof、资源增减/遗漏、运行中停止/失联、已注册子孙进程。展示观测与业务放行分开，JSON/read DTO不持有执行权限。复用唯一既有恢复transport实现。

## B3 限定唯一sender并关闭token重放

B拥有实际launch/transport，签发token绑定不可变请求、grant/reservation身份、subject/material、profile/host政策与固定transport/hook。一次token的并发/重复消费最多一次可能发送；先占用状态再await reservation，unknown不自动退款重发。

不接受E传owner="b"/entry.command或可替换transport来冒充B实现。交可被E直接调用的有限adapter入口；当前缺有界recipe一律拒绝、fake send0。不新增协议/计费代理，不跑模型smoke。

## B4 与E实际拒绝链组合

E只接持久预留hook，不自己spawn另一CLI；显式使用调用方grant，不硬编码B cap4。测试缺身份/预留/费用上界/宿主/材料、reservation复用和签发后修改，穿过实际E消费者而非只检查descriptor。

真实recipe封存BLOCKED，正控制只能用owned fake transport并准确标为fixture。不可仅给布尔或字符串证明就允许真实发送，原native控制继续NOT_TESTED。

## B5 交生产诊断与受控恢复consumer

runtime diagnostics只报告exact binary/profile/version/digest与证据层级；caller capability overrides和null model/provider不能生成billableAdmitted权限绿灯。给main/D可直接调用的只读投影，敏感配置不出公开DTO。

补现有持久stop/answer/steer/recovery受控窗口，使用新可信资源接口核对；不升级全局runtime、不改用户profile、不以诊断名义发送turn。

## B6 冻结可复跑handoff

维护`tests/native-acceptance/reports/wave09-status.json`，source/proof生产者/fixture/原生未测分清，所有旧ledger和NO_SUPPORTED结论保留。交main/D/E实际库导出、调用recipe、结果/限制。

先B1后连续B2–B5，不在文档后停止，不重做协议导出。只push原分支，保留用户七组服务和未知reservation。
