# Wave16：wave15固定交付独立验收

2026-11-13，产品基线a64a127/1169535。同期87d548c只有两份用户架构文档，保留原提交，产品字节不变。三个只读审查分别测A/C、B、D/E；报告为[context.json](context.json)、[runtime.json](runtime.json)、[delivery.json](delivery.json)。

## 结论

- A旧source4、storage87/workflows106、实际main/A8通过；新备份family子集降格2反例FAIL，不整包准入新snapshot verifier。
- B重新提交按用户确认的原目录c7f7e77复验，cancel epoch和crash观测已修，旧9/helper68/strict及normal6PASS+1NT保留。B14仍begin0/answer0、业务表全0、合成writer；原生正常链与业务恢复分别看待。持久新探针3PASS/3FAIL，原B14自身6PASS+1NT不等于业务准入。
- C unknown-wrapper4、四包291、当前main候选11/消费者13/factory6通过。纯数据修复成立；C自己新增fixture不替代真实candidate GET/prepare验收，旧缺入口声明过时。
- D旧身份4反例/正对照通过，新tar6719项字节通过；child归属/discovered UNKNOWN新3反例FAIL，广泛live停止/安装/清理未运行。
- E旧五项行为/ABI加两source控制7通过；actual fault recover BLOCKED+exit2仍可过gate。167PASS/16NT对应旧114b73c；installed-alpha仍FAIL。

这些新候选缺口不撤销main已实现M1–M3及早期限定原生正常交付。完整文件锚点、观测和下一任务边界见[0047](../../../docs/rfcs/WP-16/0047-wave-16-reviewed-deliveries-and-long-packages.md)。不是全产品准入。

## 可复验入口

全部probe使用独立新输出，禁止覆盖历史报告。D/E前置使用已经核对的同subject解包根，具体参数见各工具usage与JSON报告。新安全工具只mock scanner/identity/signals，没有实际OS扫描/信号；B仅spawn本机受控fake服务，绝不发厂商请求。

```sh
PA_ADMISSION_REPORT=/tmp/pa-wave16-a-rerun.json node tools/bootstrap/probe-wave16-storage.mjs /Users/hh/Desktop/joker/superagent-agent-a
PA_ADMISSION_REPORT=/tmp/pa-wave16-b-rerun.json node tools/bootstrap/probe-wave16-runtime.mjs /Users/hh/Desktop/joker/superagent-agent-b
PA_ADMISSION_REPORT=/tmp/pa-wave16-d-rerun.json node --experimental-test-module-mocks tools/bootstrap/probe-wave16-delivery.mjs /Users/hh/Desktop/joker/superagent-agent-d /tmp/pa-wave16-delivery-audit-3yalUM/install
PA_ADMISSION_REPORT=/tmp/pa-wave16-e-rerun.json node tools/bootstrap/probe-wave16-release-gate.mjs /Users/hh/Desktop/joker/superagent-agent-e
```

观察工具执行完成不等于期望安全条件通过，读取report每项status/exit。精确新tar source8962d10/build88df6d2eef1feeb7/schema18，SHA11497980a4077e854b64596c71efe45b1e68e058639838acef0b07657d61f54b，20190414 bytes；它含697efdc、不含后来的建议UI，不重命名成当前main包。

十二组用户服务/全部state、profiles、ledger、旧tar及历史reports保留。真实模型/native turn0；预算、BLOCKED试点和最终release权限不变。下一批[十阶段长包](../../../agent-tasks/product-wave-16/README.zh-CN.md)，静态计划校验不提供runtime/native/release证明。
