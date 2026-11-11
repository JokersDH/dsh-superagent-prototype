# 第十轮独立准入记录

审视基线main `2caee2e`，产品source `32fc7ae`。结论及后续边界见[0033](../../../docs/rfcs/WP-16/0033-wave-10-admission-and-product-closure.md)。所有探针真实模型/native0；fixture transport次数不是模型次数。旧用户八组服务保留。

| 记录 | 准入结果 | 限定范围 |
| --- | --- | --- |
| [storage.json](storage.json) | 1 PASS/3 FAIL | A原7f7e83e reader，原相关测试10/10；三个反例未变 |
| [runtime.json](runtime.json) | 3 PASS/4 FAIL | B新公共模块与实验helper；68 owned通过、B11 10通过/1未测；不等于当前main权限漏洞 |
| [context.json](context.json) | 1 PASS/3 FAIL | 仅未消费helper和推荐recipe；C已接入来源边界仍通过，main实际HTTP14项通过 |
| [distribution.json](distribution.json) | 1 PASS/6 FAIL | D材料合法DTO、目录生命周期及只读资源归属；不执行有风险的候选stop |

复跑命令：

```sh
node tools/bootstrap/probe-wave09-target-inventory.mjs /Users/hh/Desktop/joker/superagent-agent-a --output reports/releases/wave10-admission/storage.json
node tools/bootstrap/probe-wave10-runtime.mjs /Users/hh/Desktop/joker/superagent-agent-b /Users/hh/Desktop/joker/superagent-agent-e
node tools/bootstrap/probe-wave10-context.mjs /Users/hh/Desktop/joker/superagent-agent-c
node tools/bootstrap/probe-wave10-distribution.mjs /Users/hh/Desktop/joker/superagent-agent-d /Users/hh/Desktop/joker/superagent-agent-e
```

这些候选当前预期exit1；修复后才应通过，不修改probe降低断言。各JSON保留exact commit、源码摘要、命令、观测与限制。Aprobe新增`--output`以保留wave09历史记录。

例外需要准确区分：C脚本的两项recipe是固定旧实现复现，不会随新adapter修复变绿；`--helper-only`仅动态核对helper并另写context-helper.json。新adapter到达后main需写实际导出消费者准入，旧recipe记录保留历史作用。

D相关测试11/11、E费用runner selftest66/66实际复跑通过。D两份tar实际SHA/大小匹配，但未重跑完整安装矩阵；E仍旧schema13组合，不宣称新schema15/current-main安装准入。当前个人main已测路径不因实验helper失败被撤销。

下一上下文binding共享schema本次新增，契约222项/构建/生成一致性与main product类型检查另行通过；它尚未提供实际上下文发送功能，不计产品交付。
