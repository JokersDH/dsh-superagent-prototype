# Wave18：wave17固定交付验收

2026-11-13。审查基线d494212/6050b4b，固定A6dc4bc5/B1e1f82a/Ca07e660/D94ee3c6/E48f73f6。报告：[A/C](context.json)、[B](runtime.json)、[D/E](delivery.json)。后续main e438安全切片另见[0050](../../../docs/rfcs/WP-16/0050-snapshot-schema-admission-checkpoint.md)和[integration](../wave18-integration/README.zh-CN.md)。

## 高信号结论

- A/C旧8项关闭，A196/C305包、strict/build及实际source确认通过；A真实旧v1非空binding却被A新verifier拒绝，整包legacy不准入。
- B实际产品/原Driver/子进程/A失败事实2是进展；脚本语法与协议失败，仍未prepared/begin/Q。main另给合规本地诊断作为起点，不计B提交。
- D新651冻结包安全helper5/5，旧97同测2PASS/3FAIL；6737项字节通过，current source确认两个受控消费者通过。
- E原exit/pointer等旧3通过；但installed-alpha PASS实际给旧97借了最新D源码安全结果，跨subject gate仍接受，不能采信该放行。旧普通对话/数据scope保留。
- A/C目前分开的第二根数据与同根readonly结果，尚非一条统一第二根流程，不把source确认已实现再列缺失。

完整引用/边界见[0051](../../../docs/rfcs/WP-16/0051-wave-18-admission-and-product-exits.md)。下列探针都是有限复现，报告新绝对路径/0600/no-overwrite；D/E完全mock、不跑任何live生命周期。

```sh
PA_ADMISSION_REPORT=/tmp/pa-wave18-ac-rerun.json node tools/bootstrap/probe-wave18-context.mjs /Users/hh/Desktop/joker/superagent /Users/hh/Desktop/joker/superagent-agent-a
PA_ADMISSION_REPORT=/tmp/pa-wave18-d-rerun.json node --experimental-test-module-mocks tools/bootstrap/probe-wave18-delivery.mjs /tmp/pa-wave18-delivery-audit-lWXHuK/install /tmp/pa-wave17-delivery-audit-0guO8q/install
PA_ADMISSION_REPORT=/tmp/pa-wave18-e-rerun.json node tools/bootstrap/probe-wave18-release-gate.mjs /Users/hh/Desktop/joker/superagent-agent-e /tmp/pa-wave18-delivery-audit-lWXHuK/install
PA_ADMISSION_REPORT=/tmp/pa-wave18-b-normal-rerun.json node tools/bootstrap/diagnose-wave18-b-preparation.mjs /Users/hh/Desktop/joker/superagent-agent-b
```

main v1配方在e438保持不变，A probe可继续复现真实旧摘要兼容边界。D第二个root是旧97的已核对解包；换root需先核验完整tar/manifest/file hashes。新651包5/5、旧97包2PASS/3FAIL、E跨subject1PASS/1FAIL、A legacy1PASS/1FAIL分别记，不用工具整体exit代替scope。

B最后命令为main诊断，已跑prepared→begin1→Broker Q1/A事实4，creditedToB=false；原B受审脚本仍语法/version exit1。不得将main提供的反事实/诊断结果重贴为B已交付或实际native兼容。

十二组服务、全部state/profile/tar/账本、B脏report/untracked、C lock及E74+旧runs保留，真实vendor model/native0。新版[完整长包](../../../agent-tasks/product-wave-18/README.zh-CN.md)与静态分工校验不授release/native/target权限，完成度不按轮次和测试数增加。
