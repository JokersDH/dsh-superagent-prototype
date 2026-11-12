# 本轮独立验收与进度

日期2026-11-12，main e1e0c97。详见[0039](../../../docs/rfcs/WP-16/0039-wave-13-admission-and-alpha-closure.md)和[完成度评分](../../../docs/roadmap/progress-2026-11-12.zh-CN.md)。首期稳定内测约70%、完整B约50%，是交付加权工程估计，不是发布批准。

| 层 | 本次实际执行 | 保留范围与限制 |
| --- | --- | --- |
| A | storage87/workflows94，旧4例PASS；[新1PASS/3FAIL](storage.json) | 真实history/reply已在main；source reader完整性不准入 |
| B | 旧3/11、strict、68PASS；[新0/5](runtime.json) | B13真实Store/进程/cancel成立，真实产品恢复未证明 |
| C | 旧8/17、四包269/type/build、当前main组合9PASS；[新0/6](context.json) | 不替换main现用Scope/扫描/同步guard；9项未读SSE |
| D | [旧6/6](delivery-previous-boundaries.json)；[新mock0/6](delivery.json)及[legacy1FAIL](delivery-legacy.json) | 新mock实际OS扫描/信号0；legacy只停本次自有API |
| E | [A18进程回复4/4](e-reply-durable.json)；[发布分类0/3](release-gate.json) | 旧143/1/18结果仍a22/schema16，不是新包/当前main认证 |
| tar | [完整字节证据](artifact.json) | 020af82/schema18含回复，缺当前history/source API；未启动安装版 |

## 可重复的新反例

```sh
PA_ADMISSION_REPORT=/tmp/wave13-a.json node tools/bootstrap/probe-wave13-storage.mjs /Users/hh/Desktop/joker/superagent-agent-a
PA_ADMISSION_REPORT=/tmp/wave13-b.json node tools/bootstrap/probe-wave13-runtime.mjs /Users/hh/Desktop/joker/superagent-agent-b
PA_ADMISSION_REPORT=/tmp/wave13-c.json node tools/bootstrap/probe-wave13-context.mjs /Users/hh/Desktop/joker/superagent-agent-c
PA_ADMISSION_REPORT=/tmp/wave13-d.json node --experimental-test-module-mocks tools/bootstrap/probe-wave13-delivery.mjs /Users/hh/Desktop/joker/superagent-agent-d <明确已验证的解包install根>
PA_ADMISSION_REPORT=/tmp/wave13-d-legacy.json node tools/bootstrap/probe-wave13-delivery-legacy.mjs /Users/hh/Desktop/joker/superagent-agent-d
PA_ADMISSION_REPORT=/tmp/wave13-e.json node tools/bootstrap/probe-wave13-release-gate.mjs /Users/hh/Desktop/joker/superagent-agent-e
```

这些命令针对固定候选的新负例，失败为预期exit1。D mock只读冻结根、另建temp roots，所有PID/ps/signals都由mock限制；legacy只使用本次spawn并检查start的进程。不要改为真实全局cleanup矩阵。E probe只核对声明的必测集合，不合成release PASS。

旧探针输出本轮曾误覆盖wave11/context.json，已归档新字节并恢复原历史，验证原文件无diff。`context-previous-boundaries.json`的附带静态包计数属于历史metadata，不是本轮269项回归；新工具已显式命名historical并支持输出路径。

主线业务代码本轮不改，不以引入未消费helper增加完成度。此前505非浏览器/17网页、真实原生正常路径的限定证据保留。所有本轮自动模型/native0、账本保留；十组用户API健康单列于status。下一任务用[五段转发文本](../../../agent-tasks/product-wave-13/forward-prompts.zh-CN.md)，没有向外部Agent聊天自动发消息。
