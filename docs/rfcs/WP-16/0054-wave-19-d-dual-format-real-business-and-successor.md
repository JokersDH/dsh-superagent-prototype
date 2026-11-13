# WP-16/0054：第十九轮 D 双格式真实业务搬根与后继包

日期 2026-11-13；基线 `9a0f1a0`，合并 main `ee2297e`（含 9856124）。仅动 D 路径；真实 vendor/model/native 0；十二服务未动。

- 固定输入：b9117aa/build6a45633067501dd2/sha4a81380a… 仍作为 E 先验 subject；651 作为安全升级基线；97 仅 mock 失败对照。helper/API/CLI 均来自被测不可变包。
- b911 同包证据保留（非空 personal 11 步、decision confirm/replay、无执行器 work 拒绝、restored rebind fixture-limit）；本轮不重修旧 child。
- main985 双格式：在真实 B/A normal 业务数据上实际调用 `readWorkflowEvidence` 默认/1（workflow-evidence/1、13 families、同 digest）与 2（/2、21 families）；非法版本 TypeError 且不建 DB。`createBundle`/`verifyBundle` 实际调用，manifest 为 personal-evidence formatVersion2，bundle formatVersion1；两个协议不互相代替。
- 真实业务搬根：B normal producer 保留数据（Work/Broker/question/answer/native_applied，vendor/native 0）backup→第二 root restore→recovery_readonly HTTP；snapshot works≥1、业务写 422、源 digest 不变、old queue 不重放；source prepare/confirm/audit 仍 data-only。恢复以 restore report 的 fixture mode 运行，不冒充 personal；历史 Work actor 授权/候选/source 403 保留为 fixture-limit，待 main 显式只读绑定。
- 冻结后继：build `90e81429079a7d50`、source `ee7fbd8` clean、schema18、tar sha `b0990149…7ecc`、20,236,793 B、6,742 files。b911/651/97 原样保留。
- 冻结复跑：real4/4、nonempty11、matrix19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、source5/5、651→new 3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、launcher60/60、portability52/52。
- 限制：restored-personal rebind、历史 Work 授权、A v2、跨平台/ABI、真实计费 turn、逐步 SIGKILL、main private activation/target。E 配方 `tools/distribution/recipes/wave19-e-acceptance.zh-CN.md`；状态 `tools/distribution/reports/wave19-status.json`。
