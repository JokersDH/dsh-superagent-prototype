# 第十一轮固定源码验收

当前产品基线main7f7bdd7/4140cac/schema16。结论见[0035](../../../docs/rfcs/WP-16/0035-wave-11-admission-and-long-run-packages.md)，新稳定输入98a50ca不是已实现的新功能。真实模型/native0，九组用户服务及旧报告保留。

| 记录 | 实际结果 | 范围 |
| --- | --- | --- |
| [runtime.json](runtime.json) | 7 PASS / 4 FAIL | 新B helper：exactOptional、clone失败、实际B/E拒绝签名、空格路径；B12持久恢复为NOT_TESTED |
| [context.json](context.json) | 8 PASS / 9 FAIL | 实际候选adapter/manifest/projector；不涉及main现用私有adapter或指纹 |
| [delivery.json](delivery.json) | 2 PASS / 1 FAIL | 通用stop requested root错配；只用本次自己的临时进程，旧upgrade/material限定PASS保留 |

复跑上述候选当前应exit1：

```sh
node tools/bootstrap/probe-wave11-runtime.mjs /Users/hh/Desktop/joker/superagent-agent-b /Users/hh/Desktop/joker/superagent-agent-e
node tools/bootstrap/probe-wave11-context.mjs /Users/hh/Desktop/joker/superagent-agent-c
node tools/bootstrap/probe-wave11-delivery.mjs /Users/hh/Desktop/joker/superagent-agent-d /Users/hh/Desktop/joker/superagent-agent-e
```

新probes保存exact source/hash/命令/限制，未覆盖wave10历史。B旧七case复用只更改内存里的报告bookkeeping，不改实现；其较弱“export存在”PASS保留为历史，并新增更强的实际签名case。B12的内存重建限制独立记录，不设置“必须存在recover方法”的未来门槛。

C没有重跑固定旧坏recipe作新准入，所有失败来自真实export；cutoff可用可信reader wrapper维持，作为集成要求。D stop反例是新通用路径，与旧accounting/material不同。D tar解包证明缺当前context-use，E旧scope不重标成最新通过。

本轮另接C确认重放expectedDigest小修复，main proposals26项与真实提案集成10项通过；其余候选仍分段等待。新共享contracts校验/构建/生成和main类型检查单列记录，不当成native、安装或价值证据。
