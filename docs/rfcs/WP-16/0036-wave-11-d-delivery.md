# WP-16/0036：第十一轮 D 多实例隔离、schema16 闭包与便携交付

日期 2026-11-12；基线 `fe01c3c`，合并 main `ed8b520`（含 4140cac context-use、98a50ca A 端口）。仅动 `apps/launcher/`、`tools/distribution/`、`packages/portability/`。真实模型/native turn 0；九组用户实例 5180/8796–5188/8804 未启停。

## D1/D2 请求根统一归属（P1）

- 新增公共 `apps/launcher/lib/identity.mjs#requestedScopeCheck`：所有命令统一校验 requested install/config/data 与 record/真实进程。state 是硬边界；install 对 start/reuse 为硬边界，对 stop/status/doctor/upgrade 为记录信息（升级 CLI 二进制可以来自 target）。
- `stop/status/start/doctor` 在跨 state 时返回 `requested_root_mismatch`，不 signal、不删 record、不切 pointer；upgrade/rollback 屏障同样拒绝。
- `stop` 新增未知 listener 判定：记录端口上命令行**命名本 state/install** 的活进程返回 `unknown_live_resource`；无关服务只记录为 `foreignPortOccupied`，不误判。
- argv 身份比较改为按参数边界消费原始命令行，支持含空格/中文的路径；非法尾部参数仍拒绝。
- main 只读 probe `probe-wave11-delivery.mjs`：3/3 PASS（matching orphan 正例、跨 state 拒绝、冻结 tuple 校验）。多 state 矩阵 8/8 PASS：双 state 活实例、跨 state stop/status、matching 停自己、launcher 死/API 活、stale record、PID 复用、缺 record、空格/中文路径；未操作 state 的 PID/API/DB/record 均保持。

## D3 真实故障窗

`PA_UPGRADE_FAULT=crash_after_stop_kill|crash_after_switch_kill` 让 upgrade 进程真实 SIGKILL；journal 是唯一见证，重入须 `upgrade_recover_required`，`upgrade --recover` 后 journal terminal 且运行实例可验证。矩阵 E13/E14 覆盖；19/19 PASS（含 E1–E12）。

## D4 schema16 备份闭包

`verify-backup-schema16.mjs` 仅用 A 公开入口：`verifyDatabase`/`readWorkflowEvidence`/`ProductStore`/`applyMigrations`。校验 schema16、A 族清单（含 `assistant_context_bindings`）、备份→新根恢复后证据摘要一致、损坏 bundle `archive_invalid`、未来 schema（fixture registry 写 17）被 `state_schema_newer_than_binary` 精确拒绝、schema13 bundle 经 A Store 打开迁移到 16。D 不写 SQL、不复制账号/旧库/凭据；restore 保持只读 marker。

## D5/D7 便携闭包与 personal 冷安装

- 搬到含空格/中文路径，HOME 隔离、cwd 在 checkout 之外，doctor 无 FAIL、start/stop/support 正常；配置根 0755 被 doctor FAIL 且 start 拒绝；PATH 无 node 时显式失败（不崩溃）。其他平台/ABI 明确 NOT_TESTED。
- personal 冷安装 7/7：cold first-run、doctor gates、真实 personal 模式零 turn、备份、只读恢复新根（证据摘要一致）、搬迁后启动。

## D8 双 binary

wave-07/wave-08 两个真实 schema13 构建：升级 `CONFIRMED` 后运行 build 为 wave-08、A 证据不变；`rollback-install` 切回 wave-07、journal terminal `binary_rolled_back`、数据不静默回滚；重复 rollback 如实报告 toggle/幂等或 `rollback_unavailable`。6/6 PASS。

## D9 材料消费者与脱敏支持包

- 材料 recipe 直接消费 A 公开 `RecoveryTargetInventoryReader`：空 schema target 的 `inventory-readonly` PASS（52 tables、issues 空、`startupAvailable:false`），仍不自造 activation。
- 新增 `pa support --out`：只含白名单状态/版本/摘要/错误码/端口；不导出会话/回复/prompt/key/native session/IPC nonce/账号目录/argv/绝对路径/文件内容；0600、拒绝覆盖。单测覆盖泄漏负例。
- main 的 activation/host 许可握手未发布：激活保持 blocked，材料/空库/旧备份不自授权。

## D6/D10 冻结与限制

target：build `3311a04bd20ed7f9`、source `a22d3a4`（clean）、schema16、tar sha256 `a10f6274…d2cb`、20,132,388 B、6,697 files；baseline wave-06 schema13 与 dual pair 保留。冻结字节复跑：矩阵 19/19、personal 7/7、backup 6/6、portable 5+1 NOT_TESTED、dual 6/6、material PASS、smoke 52/52、launcher 60/60、portability 52/52、probe 3/3。

未测：跨平台/ABI、真实个人计费 turn、逐步 SIGKILL 全枚举、main activation、E 独立 verdict。历史 tar/report/ledger 未改。
