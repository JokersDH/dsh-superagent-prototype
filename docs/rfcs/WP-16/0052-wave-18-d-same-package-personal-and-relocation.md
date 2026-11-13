# WP-16/0052：第十八轮 D 同包 personal 候选、搬根与 source 事实

日期 2026-11-13；基线 `94ee3c6`，合并 main `5ef8bf1`（含 e438ab5）。仅动 D 路径；模型/vendor/native 0；十二服务未动。

- 资源门保留：frozen helper 5/5（完整父、registered child、未登记 same-UID、wrong-start、actual recover）；child 修复 scope 不重复派旧 sameUID。旧 97 只 mock 审计，不 live。
- 同包 personal：私有本机 fake OpenAI endpoint + 私有 model config，discussion-only 无执行器。实际 context prepare/send → 非空 propose_work/propose_decision；candidate GET/prepare、explicit reject、decision confirm、同命令 replay；work confirm 被 422 unsupported_capability 拒绝；原请求 requestContext/sourceMessageId 与 source message 一致；native/vendor 0。
- 搬根/source：同 personal state backup→新 root restore→恢复只读 HTTP；原文/业务拒绝/source prepare/confirm/audit（not_granted、startupAvailable=false）真实通过；非空候选/历史 source 读受 main restored-project rebind 未实现限制（403，明确 fixture-limit），不伪 PASS、不 copy credentials、restore 后0 model 请求。
- e438ab5：合入 main schema guard；保留真实 v1 非空 binding digest 与旧 snapshot/evidence 兼容；A v2 未准入，本包不声称支持。
- 冻结：build `6a45633067501dd2`、source `b9117aa` clean、schema18、tar sha `4a81380a…4c1a`、20,231,965 B、6,742 files。旧 65102f7/97cace7 原样保留。
- 冻结复跑：probe5/5、nonempty 11 步、matrix19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、source5/5、same18 3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、launcher60/60、portability52/52。
- 限制：restored-project rebind、A v2、跨平台/ABI、真实计费 turn、逐步 SIGKILL。E 配方 `tools/distribution/recipes/wave18-e-acceptance.zh-CN.md`；状态 `tools/distribution/reports/wave18-status.json`。
