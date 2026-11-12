# 第十二轮固定源码独立验收

日期2026-11-12。结论、source和下一消费者见[0037](../../../docs/rfcs/WP-16/0037-wave-12-admission-and-product-delivery.md)。旧报告未覆盖，以下新负例只约束对应候选，不撤销现用main已测范围。

| 检查 | 结果 | 实际范围 |
| --- | --- | --- |
| A旧包 | storage87/workflows88 PASS | A121ab84，真实SQLite与其既有用例 |
| [A新probe](storage.json) | 1PASS/3FAIL，exit1 | 排除尾部、重复事件、派生work；无启动权 |
| B旧probe | 11/11，strict/exactOptional，focused68 PASS | B4a40920，固定旧probe逻辑内存禁写报告 |
| [B新probe](runtime.json) | 0PASS/3FAIL，exit1 | function/Symbol，公开路径；fake发送，无账本 |
| B13 | 6PASS/1NT，exit0 | 仅测试台账/fixture进程，不是生产恢复 |
| C旧probe/四包 | 17/17；101/32/79/44 PASS，四包typecheck PASS | C553983b，旧probe内存禁写报告 |
| [C新probe](context.json) | 0PASS/8FAIL，exit1 | 新检索/manifest/审阅/history/candidate实际exports |
| [D新probe](delivery.json) | 2PASS/4FAIL，exit1 | 自有API；全局inventory/signal为mock，0实际全局信号 |
| D材料 | 11/11，portability typecheck PASS | 原惰性材料slice，不是launcher全包准入 |
| [D实际tar](artifact.json) | hash/size/source/HTTP字节一致 | schema16，确含context-use，不代表新schema18安装 |
| E当前context | 6PASS，回复持久性NT | Efa45457的独立HTTP/context层 |
| E旧安装报告 | 139PASS/1FAIL/18NT | 原cf7a3cf/schema15；没有重标为新tar/main |

## 可重跑命令

```sh
node tools/bootstrap/probe-wave12-storage.mjs /Users/hh/Desktop/joker/superagent-agent-a
node tools/bootstrap/probe-wave12-runtime.mjs /Users/hh/Desktop/joker/superagent-agent-b
node tools/bootstrap/probe-wave12-context.mjs /Users/hh/Desktop/joker/superagent-agent-c
node --experimental-test-module-mocks tools/bootstrap/probe-wave12-delivery.mjs /Users/hh/Desktop/joker/superagent-agent-d <已解包的明确install根>
```

D最后一个参数是完整已验证的冻结安装根，不是checkout。原运行使用本轮独立解包的a22d3a4/schema16字节。probe只读该根，其进程/state另建temp；不会启动安装版或停止用户资源。mock限定fake PID，绝不调用真实全局ps/kill；负例失败为预期exit1。所有probe写入本目录新报告，重跑会替换本轮文件，不覆盖历史wave11。

在候选worktree重跑时可用`PA_ADMISSION_REPORT=/tmp/pa-wave12-probe.json`将报告留在临时目录，避免修改共享报告。修复后source会作为新source写入，不重标本轮固定结论。

主线实际代码集成与288项回归见[wave12-integration](../wave12-integration/README.zh-CN.md)。本轮真实模型/native0，未修改任何费用账本，九组用户实例未重启/迁移。下一轮派工已写为[分别转发文本](../../../agent-tasks/product-wave-12/forward-prompts.zh-CN.md)。
