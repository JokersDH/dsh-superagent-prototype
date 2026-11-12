# WP-16/0040：第十三轮 D 可证明归属与当前 main 个人安装

日期 2026-11-12；基线 `0ac2b58`，合并 main `30ecd70`/`e1e0c97`（real history/source UI/HTTP、A18 replyResults）。仅动 D 原路径。模型/native turn 0；十组用户实例未启停。

## D1–D4 归属与 unknown 语义

- 记录写入绑定 `configRoot`；legacy 记录不再凭复制根 `launcher.json` 自证，必须由自身 `launcherArgv` 精确命名 `--config-root/--data-root/--install` 才接受，缺失即 unknown。
- `stop` 先核对每个存活登记的 PID/start：launcher/API/console 任一缺 start、不可读或与记录不一致即 `unknown_live_resource`，零信号、记录保留。
- `accountRegisteredResources` 只把经 PID+start 验证的树计入候选；journal/spawn 缺 start、PID 复用、ps 快照失败都进入 `unverifiable`/`scannerOk=false`，全局路径命中仅 `unregistered` 诊断。
- `proven` 统一谓词：remaining=0 且 unknown=0 且 scannerOk 且无 pidReused 且无 unverifiable；任何未知绝不降级为 STOPPED/REVERTED 或空集证明。所有 stop/upgrade/recover/rollback 分支消费同一谓词。
- `recoverSwitch` 先验证 requested/recorded install 都是 journal old/new 角色（确认分支还要求 requested 角色），torn journal 补写 plan from/to；错角色/第三角色确认返回 BLOCKED，不写 confirmed/pointer、不清理不明 PID。
- 证据：`probe-wave13-delivery` 6/6 mock（复用、缺 start、空证明、扫描失败、错 requested install、复用 API record），`probe-wave13-delivery-legacy` 1/1 自有真实 legacy 复制记录拒绝；launcher 60/60；矩阵 E1–E14 19/19 复跑。

## D5–D10 真实进程、当前数据与冻结

- 真实矩阵：multi-instance 8/8（含复制记录/跨 state/空格路径）；cross 3/3（未登记真实 stranger 阻断且存活→自有清理后 16→18 CONFIRMED→旧 binary 精确拒绝新 schema）；真实 SIGKILL 窗口沿用 19 段矩阵。
- 当前数据：`verify-schema18-data` 经 main product prepare/send + 有界 fixture provider（零模型发送）产生 A18 完成回复与 binding；用 main 新 read port 消费 history（1 条）与 frozen sources（2 个），A snapshot+artifact 搬根后 reply/binding/history/sources/证据摘要保持；损坏/未来 schema 拒绝；16→18 由 A ProductStore 迁移。5/5。
- 冻结 target：build `3ead6a26161f4c72`、source `99832f6`（clean）、schema18、tar sha256 `b7e9dec7…d2cb`、20,167,862 B、6,713 files；旧 `020af82` 保留但明确缺新 history API，不重标 current full。
- 冻结字节复跑：matrix 19/19、multi 8/8、cross 3/3、data 5/5、backup 6/6、portable 5+1 NT、personal 7/7、dual 6/6、material PASS、smoke 52/52、launcher 60/60、portability 52/52、mock 6/6、legacy PASS。
- 支持包仍脱敏/0600/不覆盖；main activation/host 许可未发布→激活保持精确 blocked；材料/空 DB 不自授权。E 配方：`tools/distribution/recipes/wave13-e-acceptance.zh-CN.md`；状态：`tools/distribution/reports/wave13-status.json`。

未测：跨平台/ABI、真实个人计费 turn、逐步 SIGKILL 全枚举、main activation、E verdict。旧 tar/ledger/用户 state 未改。
