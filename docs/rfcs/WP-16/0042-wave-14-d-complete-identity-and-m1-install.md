# WP-16/0042：第十四轮 D 完整进程身份与当前 M1 个人安装

日期 2026-11-12；基线 `d833d0f`，合并 main `9f5bd76`（含 1453cf2/M1 personal discussion-only）。仅动 D 原路径。模型/native turn 0；十一组用户实例未启停。

## D1–D5 完整身份与 UNKNOWN

- 每个登记资源必须同时满足 **PID + start + UID + argv + config/data root + operation**：同 start 但 UID/argv/operation 不符、journal 指向外 config/data、per-PID stat 失败、畸形 inventory、安装父目录角色全部为 UNKNOWN/拒绝，零信号、记录/pointer 不变。
- `vitality` 三态：kill0 失败=dead；`ps stat=` 失败/空=unknown；`unknown` 进入 unverifiable，proven=false。`ps -axo` 清单严格校验，任一畸形行使 scannerOk=false，绝不成为空集证明。
- journal/spawn 身份含 uid/configRoot/dataRoot/operationId 时逐项核对；全局路径命中仅 `unregistered` 诊断；`proven` 统一谓词贯穿 stop/upgrade/recover/rollback。
- recover old/new 角色只接受 installDir 与其 app 子目录，不再把父目录当角色；确认分支要求 requested 角色，cleanup 分支仅接受 recorded 角色且清理前同样完整身份核对。torn journal 补写 plan from/to。
- 证据：`probe-wave14-delivery` 6/6 纯 mock（SAME_START_WRONG_UID_ARGV_OPERATION、JOURNAL_SCOPE_UID_OPERATION_IGNORED、PER_PID_STAT_FAILURE_EMPTY_PROOF、MALFORMED_INVENTORY_EMPTY_PROOF、INSTALL_DIR_PARENT_ACCEPTED_AS_ROLE、ACTUAL_RECOVER_WRONG_UID_ARGV_OPERATION），0 真实扫描/信号/进程；launcher 60/60。

## D6–D10 真实进程、M1 与冻结

- 真实矩阵：19 段（真实 SIGKILL E13/E14）19/19；multi 8/8；cross 3/3（未登记 stranger 阻断→自有清理→真实 16→18→旧 binary 拒绝新 schema）。
- 当前数据：main product prepare/send + 有界 fixture（0 模型发送）产生 A18 回复/binding，main history/source read 各保持，A snapshot+artifact 搬根后保持；损坏/未来 schema 拒绝；16→18 A 公开迁移。5/5。
- personal：普通冷安装 7/7；无 Codex 时新增 `--discussion-only` 显式入口：仍 personal、`executionAvailability=unavailable(operator_disabled)`、dispatch 422 `unsupported_capability`，不静默 fixture、不读凭据。4/4。
- 冻结 target：build `a7df2b225a8c5c42`、source `114b73c`（clean）、schema18、tar sha256 `246fd80d…c785`、20,177,745 B、6,714 files；旧 `99832f6` 不含 M1，不重标。
- 冻结字节复跑：mock 6/6、matrix 19/19、multi 8/8、cross 3/3、data 5/5、personal 7/7、no-executor 4/4、backup 6/6、portable 5+1 NT、dual 6/6、material PASS、smoke 52/52、launcher 60/60、portability 52/52。
- 支持包仍脱敏/0600/不覆盖；main activation/host 许可未发布→激活精确 blocked。E 配方：`tools/distribution/recipes/wave14-e-acceptance.zh-CN.md`；状态：`tools/distribution/reports/wave14-status.json`。

未测：跨平台/ABI、真实个人计费 turn、逐步 SIGKILL 全枚举、main activation、E verdict。旧 tar/ledger/用户 state 未改。
