# 第十四轮成果独立验收与第十五轮输入

2026-11-12，审查基线6d24519，主线实际产品新检查点697efdc。固定输入A3121ec4/Bcfe6a3a/C2e1c095/De9f8aff/Ed0d1159。完整边界见[0043](../../../docs/rfcs/WP-16/0043-wave-15-production-composition-and-admission.md)，新派工见[wave15](../../../agent-tasks/product-wave-15/README.zh-CN.md)与[分别转发话术](../../../agent-tasks/product-wave-15/forward-prompts.zh-CN.md)。不授整体release准入。

## 独立确认的结果

| 范围 | 实际结果 | 精确限制 |
| --- | --- | --- |
| A source | 旧4/4，storage87/workflows105、build通过 | 数据范围；已按最小4源文件/reader测试接main，不整包覆盖 |
| B helper/正常纵向 | 旧4+旧5、strict/exactOptional、68；B13 source loader下6PASS+1NT | 初始直接导入失败是陈旧contracts dist，不算源回归；vendor未调用 |
| B14新恢复 | 5PASS/1FAIL/1NT，原报告保留在[b14-reported.json](b14-reported.json) | 有独立认证服务存活/inspect重连；begin/answer receiver0，delivery仅receipt，不能按报告PASS扩大准入 |
| C | 旧6/6、124+35+82+44=285、strict/build、current-main组合11 | 未读SSE；默认factory/非空候选仍main欠项；typed私有输入可集成 |
| D旧probe | 返回6PASS | 未mock新processUid，UID一支因不可读拒绝，有一次fake PID的只读UID查询；raw counter0不代表这一查询不存在 |
| D新完整mock | 1PASS/3FAIL | 完整身份正对照与独立post-signal路径，实际OS扫描/信号/启动0 |
| E旧probe | 五变异被拒绝 | 空evidence共同前置，不能单独当五字段正确关系证明；等价foreign source控制2PASS |
| E新证据 | 2PASS/5FAIL | 保留actual evidence/canonical case；原current-install BLOCKED，未来需coherent成功正例及逐项失败原因 |

## 主线本次实际实现

[0042](../../../docs/rfcs/WP-16/0042-logical-source-preflight-checkpoint.md)：实际runtime恢复inspect/prepare消费A完整逻辑source，同一UoW内状态/摘要参与原指纹，没有event的业务变化也会拒绝原预检；不完整源无法prepare。新增8项与旧恢复共66PASS，contracts228/storage87/workflows93、strict和生成契约check通过；冻结wire hash不变。原marker/queue/binding不改，confirm/许可/target启动仍未实现，输出继续not_granted/commitAvailable=false。

这次不是只新增派工：A/E已有实际HTTP消费者可以继续组合。代码已推origin/main，旧十一组服务未重启/迁移，没有为本次后端预检另建空预览或发真实模型。

## 具体剩余问题

- B `tests/native-acceptance/fixtures/b14-coordinator.mjs:41/:86`写receipt替代begin/delivery；`b14-runner-service.mjs:25`没有实际子writer。epoch5/current1误配已由[诊断](runtime-epoch.json)隔离，不是当前命令真的stale；最后行crash输出丢失先前error。
- D `apps/launcher/lib/upgrade.mjs:709`实际producer只产pid/start/time，`:518/:524/:526`可选校验，调用者不传operation；实际recover走同一路。`:433/:596`二值alive把signal后stat未知当dead。新工具3负例+1正例见[delivery.json](delivery.json)。
- E `tests/product-acceptance/lib/release.mjs:369/:376/:387/:788`仍允许BLOCKED/null、fixture模式、copy无exit/code、fault只有step PASS、foreign ABI/platform/arch。见[release-gate.json](release-gate.json)。
- C `packages/proposals/src/reply-candidates.ts:311/:328`未知输入先解引用，3TypeError/1合法控制见[context.json](context.json)。这是P2防御性问题，非已准入权限绕过；typed内部集成不必等它。

## 冻结包

[artifact.json](artifact.json)：新114b73c/builda7df2b225a8c5c42，tar SHA`246fd80ded7b5d2445890a7854dbc6261a71c1c4456f3ee2f41404b9b6e3c785`，20177745 bytes；6693文件+21内部链接，67286171展开字节全部hash/size/manifest/closure通过。实际schema18、Node24.21.0、ABI137、SQLite3.53.4、darwin/arm64，M1/DiscussionEffects/context/history/source/replyResults存在。本轮只核验字节，没有启动安装daemon。

E当前161PASS/0FAIL/17NT仍test source ab73af5、旧99832f6/build3ead6a26161f4c72，installed-alpha因current-install NT保持FAIL。它不能认证新114b73c；新114b73c也不包含本次697efdc的逻辑预检。D安全修复改变运行字节后再冻结，文档变化不强迫重新打包；普通M1安装不等恢复activation或研究。

## 复现和保留

新工具：`probe-wave15-context.mjs <C>`、`probe-wave15-release-gate.mjs <E>`、`probe-wave15-runtime-epoch.mjs <B>`以及`node --experimental-test-module-mocks tools/bootstrap/probe-wave15-delivery.mjs <D> <已核验解包根>`。前两类边界及D预期exit1；epoch工具exit0仅证明误配根因，不证明业务恢复。所有输出都可用PA_ADMISSION_REPORT指向/tmp，不覆盖历史。

B旧两份report差异、C lock差异、E原65个runs及新增数据未清理；所有十一组用户实例、state/profile/tar/预算保留。新D工具完全mock，B诊断只有本次私有inert服务并已清理。自动真实模型/native0，旧cap4 UNKNOWN及BLOCKED pilot不刷新。完成度保留旧69/100与50.8%冻结估计，实际产品新增与P1各自陈述，不靠测试条数自动加分。
