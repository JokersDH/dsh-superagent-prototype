# WP-16/0038：第十二轮 D 精确进程归属与当前 schema18 个人安装

日期 2026-11-12；基线 `ebcebe1`，合并 main `14688f2`（530085c replyResults/schema18/备份族/真实runtime SIGKILL）。仅动 `apps/launcher/`、`tools/distribution/`、`packages/portability/`。真实模型/native turn 0；九组用户实例未启停。

## D1–D3 归属闭合（P0）

- `requestedScopeCheck` 现要求 **config/data 硬绑定**：记录写入时持久化 `configRoot`（复制/二次写入到别的 config 保留原绑定）；legacy 记录只有 request config 自身 `launcher.json` 指向同一 config 才接受，否则 `requested_config` 失败。`stop` 额外要求 install 精确匹配；upgrade/recover/rollback 的 CLI 二进制可与记录 install 不同，但状态/config 必须一致。
- `stop` 对复制 record 到其他 config、错误 install、错误 data-root 均 `requested_root_mismatch`，不 signal、不删原记录。`recoverSwitch` 的 starting/current/target_stop_unproven/cleanup/rollback 在副作用前执行同一核对，返回 `BLOCKED requested_root_mismatch` 且不写 confirmed/pointer。
- `accountRegisteredResources` 身份token仅 `config + data`；cache/logs/workspace 命中不再认领。全局扫描只作 **unregistered 诊断**，不进入 `owned`/不发送信号；`stopRegisteredResources` 只停 record/journal/spawn 证明的树。upgrade 屏障**先 accounting 再 stop**：发现未登记活进程在停止本 state 前即 `unknown_live_resource`，保持实例/pointer/数据不变。
- 证据：main probe `probe-wave12-delivery.mjs` 6/6（matching 正例、data-root、install、复制 config、共享 cache 全局PID、recover starting），全程 mock scanner/signals、0 真实OS扫描/信号；launcher 60/60；multi-instance 8/8。

## D4–D5 真实故障与 schema18 数据

- 19段矩阵（含真实 SIGKILL E13/E14）在 schema18 target 上 19/19；stop 统一按记录所属 install 执行，错误 install 明确拒绝。
- `verify-cross-schema-upgrade.mjs`：未登记同state进程阻断升级且保持运行/pointer；清掉自有 stranger 后真实 16→18 `CONFIRMED`、旧binary在新schema上 `state_schema_newer_than_binary` 且数据不变。3/3 PASS。
- `verify-schema18-data.mjs`：通过 main product `assistantContextPrepare/Send` + 有界fixture provider 产生真实完成回复与 context binding（无模型/native发送），A `replyResults/contextHistory` 可重开读取；A `backupDatabase` 快照搬根后回复/绑定/证据摘要保持；损坏 bundle、未来schema、16→18 迁移全部精确。5/5 PASS。

## D6–D10 当前字节与交接

- 冻结 target：build `1a2f34ac359a5739`、source `020af82`（clean）、schema18、tar sha256 `96d32fb55a0d8fa9a02f4a5497c54774e84176b42c5727da449343fb3913bfe5`、20,147,268 B、6,707 files。`a22d3a4`/`cf7a3cf` 原标签保留。
- 冻结字节复跑：matrix 19/19、multi 8/8、personal 7/7、portable 5+1 NT、backup 6/6、schema18-data 5/5、cross 3/3、dual 6/6、material PASS、smoke 52/52、launcher 60/60、portability 52/52、probe 6/6。
- 支持包 `pa support --out` 保持脱敏（正文/argv/key/nonce/账号路径/绝对路径不导出，0600 不覆盖）；材料与空DB仍不自授权，main activation/host 许可握手未发布→激活精确 blocked。
- 旧同schema双binary scope 保持 wave-07/wave-08 schema13 对（6/6）；不重标为 current。E 配方：`tools/distribution/recipes/wave12-e-acceptance.zh-CN.md`；状态：`tools/distribution/reports/wave12-status.json`。

未测：跨平台/ABI、真实个人计费 turn、逐步 SIGKILL 全枚举、main activation、E 独立 verdict。历史 tar/report/ledger 未改。
