# Wave17：wave16固定交付验收

2026-11-13。固定审查时点main7a2f9e9/产品1169535，A58a22e2/B8d7ddce/Cf56f17c/D6f05ab5/E79e0ab5。三份独立报告：[A/C](context.json)、[B](runtime.json)、[D/E](delivery.json)。后续main已交source确认e32a3fc，见[0048](../../../docs/rfcs/WP-16/0048-actual-source-confirmation-checkpoint.md)及[本轮主线](../wave17-integration/README.zh-CN.md)，不篡改审查时点的原报告。

## 结论

| Owner | 确认的进展 | 尚需收口 |
| --- | --- | --- |
| A | 旧4、87+109及实际候选/问答恢复数据通过 | 混版本降格、缺空required table；readonly HTTP流程尚未证实 |
| B | 新独立Runner begin1真实成立，3PASS+1NT、strict、针对17与旧normal6/1 | 准备契约未加入App/A Store/Broker，未交业务恢复/子writer |
| C | 旧wrapper4、301包及真实GET/prepare/三kind链通过 | nested getter helper边界；恢复只读HTTP/无重发仍需实际证明 |
| D | 旧4、97cace7准确建议包6731项通过 | sameUID child完整独立身份1PASS/2FAIL |
| E | 旧7及BLOCKED拒绝通过 | NO_OP/exit1、缺pointer1PASS/2FAIL；仍旧8962d10安装scope |

详细路径/行号/正对照/边界见[0049](../../../docs/rfcs/WP-16/0049-wave-17-admission-and-continuous-packages.md)。新候选问题不撤销main已实现产品scope，也不将数据、receiver half或tar字节等同整包放行。

## 持久复验

报告需新绝对路径，工具拒绝覆盖。D/E scanner/身份/信号完全mock，不启动任何live安装/停止/清理。解包根是已验证同subject输入，换根须先重新核对tar完整字节。

```sh
PA_ADMISSION_REPORT=/tmp/pa-wave17-ac-rerun.json node tools/bootstrap/probe-wave17-context.mjs /Users/hh/Desktop/joker/superagent-agent-a /Users/hh/Desktop/joker/superagent-agent-c
PA_ADMISSION_REPORT=/tmp/pa-wave17-d-rerun.json node --experimental-test-module-mocks tools/bootstrap/probe-wave17-delivery.mjs /Users/hh/Desktop/joker/superagent-agent-d /tmp/pa-wave17-delivery-audit-0guO8q/install
PA_ADMISSION_REPORT=/tmp/pa-wave17-e-rerun.json node tools/bootstrap/probe-wave17-release-gate.mjs /Users/hh/Desktop/joker/superagent-agent-e
```

固定候选复跑A/C4PASS/4FAIL、D1PASS/2FAIL、E1PASS/2FAIL，均exit1，原完整正对照成立。B新提交的限定命令/真实PID/receiver/facts在runtime.json，未提交real-begin未执行或计交付。

十二用户实例/state/profile/tar/账本、B脏report和C lock、E71+旧runs保留，vendor/native0。下一轮[长包](../../../agent-tasks/product-wave-17/README.zh-CN.md)，静态分工PASS不构成runtime/native/release批准；冻结完成度不按新增测试数增加。
