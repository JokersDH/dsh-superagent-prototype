# WP-16/0050：第十七轮 D 独立子身份与 source 确认消费

日期 2026-11-13；基线 `6f05ab5`，合并 main `45918ed`（含 e32a3fc/6050b4b）。仅动 D 路径；模型/native 0；十二服务未动。

- 子身份：owned 只来自完整出生身份（父 journal/spawn 或 record API/console/children）；祖先+同 UID+路径不再认领。same-UID 未登记 child 保持 unknown、0 信号、父 stop 不 proven；actual recover 返回 BLOCKED、journal/pointer/进程不变。
- producer：onSpawn 记录初始 children；健康后刷新 journal children；fail/recover 用 journal 或瞬时捕获 children 的 pid/start/uid/command 独立核对，故真实 cleanup 仍可证明。
- 纯 mock probe 3/3：完整父正对照、same-UID child helper、actual recover child 反例；均 0 真实进程/信号。
- e32 source 确认：通过真实 backup→restore(marker)→recovery_readonly→`/v1/recovery/source/prepare`→`/confirm`→`/activations/:id` 消费；5/5，authorization=not_granted、startupAvailable=false，无目标/队列/权限。personal/noexec/recovery HTTP 仍 4/4、7/7、3/3。
- 冻结：build `f55470ae14cc4985`、source `65102f7` clean、schema18、tar sha `33d874c9…6340`、20,225,208 B、6,737 files。旧 97cace7/6b6517c4 原样保留。
- 冻结复跑：probe3/3、matrix19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、source5/5、same18 3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、launcher60/60、portability52/52。
- 限制：非空建议候选 fixture 需要 main/C verified body+proposal scope，本包 NOT_TESTED；activation confirm 未实现。E 配方 `tools/distribution/recipes/wave17-e-acceptance.zh-CN.md`；状态 `tools/distribution/reports/wave17-status.json`。
