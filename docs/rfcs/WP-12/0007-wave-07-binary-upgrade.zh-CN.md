# WP-12 / D 第七轮：覆盖配置根初始化、双二进制切换与数据保护

日期：2026-11-11。基线 main `436dc02`（含 0027/0028）。本文只描述 D（launcher / distribution /
portability）的发行、二进制切换与恢复消费证据，不是 main/E 准入、不是 installed-alpha。真实模型调用 0。

## 1. 覆盖配置根的可信 release 初始化（D1）

`pa build --config-root X` 把 `release.json` 写进 X；安装物自身只在 `var/config/release.json` 里带
一份。E 用 `PA_CONFIG_ROOT`/`--config-root` 指向新私有根时，之前 `pa start` 正确拒绝
`release_missing`，但文档流程无法自愈。

现在 `pa first-run` 在本机发行入口（存在 `<install>/install.json`）时，从安装清单采纳该 manifest：

1. 校验 `install.json`（`pa-install/1`、buildId、source commit、appRoot 指向本安装）；
2. 校验安装内 `var/config/release.json` 的**字节与 sha256**（同长度漂移也拒绝）；
3. 校验 release 的 buildId/source 与 install 清单一致，且所有 artifact 路径落在安装根内且存在；
4. 与目标 config root 比较：相同则幂等；不同则 `release_source_conflict`（列出双方 buildId/commit/digest），
   只有显式安装切换（`pa upgrade`）才允许替换；
5. 原子写入 0600 并回读校验。

源码/裸 `app/` 目录没有安装清单：不采纳、不伪造，返回 `provenance=unverified`、`buildId/commit/digest=null`，
并提示改用 `<install>/bin/pa` 或先 `pa build`。main 0028 报告的 fresh-source `null.commit` 崩溃已修复，
并有 4 个真实 `firstRun` 用例 + 2 个 CLI smoke 步骤覆盖「空根 / 已有源码 release / 完整发行根 / 漂移发行根」。
`pa doctor` 新增 `release_binding`：绑定 PASS、缺 release WARN、源码构建 WARN、来自其它安装的 manifest FAIL。

## 2. 两个真实不同源码的冻结安装物（D2）

| | baseline | target |
| --- | --- | --- |
| buildId | `7e8f6ce6fa2e2633` | `3e7f046e03f2ce5d` |
| source | `e10bfdb`（wave-06 D head） | `5adf00b`（wave-07 D2/D3） |
| 文件 / workspace 包 | 6603 / 21 | 6627 / 21 |
| tar sha256 | `0fe0ed53…c7631` | `c5ea704f…2e02` |
| 平台 / schema | darwin/arm64、schema 13、Node 24.21.x、ABI 137 | 同上 |

两者均从 `source.dirty=false` 的干净提交构建，tar 与 install/release/closure 摘要、依赖闭包、平台矩阵记录在
`tools/distribution/reports/wave07/artifacts.json`（产物不入 Git）。只改 tag 的重打包被排除在证据之外。

## 3. 二进制切换与数据保护（D3）

新增 `pa upgrade --to <install> [--backup <path>] [--no-backup] [--no-stop] [--recover]`、
`pa upgrade-status`、`pa rollback-install`。

顺序与保证：

1. **先验目标**：逐文件 sha256/大小校验安装清单，release 与 install buildId/source 一致、artifact 都在安装根内。
   任何不一致 → `target_tampered` / `target_manifest_invalid` / `target_incomplete`，当前实例不动。
2. **只停已验证实例**：记录存在但无法 verify 且 pid 仍活着 → `instance_record_unverified`（不杀、不切）；
   `--no-stop` 时运行中切换 → `upgrade_requires_stopped_instance`。
3. **升级前备份**：默认必须 `--backup`，写失败则 `upgrade_backup_failed` 且不切换。
4. **指针切换**：保存 `release.previous.json`，写 `install-switch.json` 日志，再采纳目标 release；
   `PA_UPGRADE_FAULT=crash_after_switch` 可复现「切换后崩溃」，`pa upgrade --recover` 幂等恢复或回退。
5. **启动核验**：目标在相同 state 根上启动，必须自报目标 buildId、通过实例 verify 与 `/v1/health`；
   失败则停掉目标、回退指针、写 `reverted_after_failed_start`，**不碰数据**。
6. **重复请求**：已运行目标 build 再升级 → `upgrade_already_applied`。

实测（`tools/distribution/reports/wave07/binary-upgrade.json`，11 段全 PASS，冻结产物对）：切换
`7e8f6ce6… → 3e7f046e…`；升级后写入的新 project/work/artifact 在**二进制回退**到 baseline 后仍可读，
证据摘要不变；schema-12 旧构建拒绝 schema-13 state（`release_artifact_missing`，状态字节/schema 不变）；
tampered target、运行中切换、未验证活进程、目标不健康、切换后崩溃+恢复、重复升级各有独立负例。

**二进制回退 ≠ 数据回退**：`rollback-install` 只改 release 指针，`dataRolledBack=false`，不降 schema、不删
升级后数据。用户显式选择备份恢复才走 `pa restore`/`pa rollback --bundle`，且保留原 state、标为数据恢复。

## 4. 恢复激活（D4，部分）

main 已发布只读 `GET /v1/recovery/inspect`、`POST /v1/recovery/prepare`，以及内部契约
`RecoveryActivationIntent` / `RecoveryActivationFacts`；尚无 HTTP commit / 已提交回执。

D 只做到「消费准备」：新增 `pa recovery-activation-check --intent <main intent json> --target-root <新 state>`，
按 main 已发布字段与本机事实评估：协议、字段、5 分钟窗口、过期、source/target 必须物理不同且私有非软链、
marker/fingerprint/machine/resource-policy 漂移、目标业务表非空、残留 instance/credential/native session/激活记录、
重复 activation/command。它永远返回 `authorization=not_granted`、`commitAvailable=false`、`started=false`，
并在没有 main 已提交事实时以 `main_source_intent_committed` 阻断；smoke 证明它不改恢复库/marker、不准备目标目录。

main 需要发布后才可继续：commit/回执路由、目标 descriptor 交付位置与生命周期、崩溃重放语义；D 不自定义授权
JSON、不建第二套认证、不删除 marker、不重放旧 queue。

## 5. E 可运行 recipe 与证据

- `tools/distribution/recipes/wave07-e-two-binary-upgrade.zh-CN.md`
- `tools/distribution/verify-upgrade-artifact.mjs`：只用两个 tar；解压到 E 自己的新 root，跑
  first-run/doctor/start/静态工作台/backup/upgrade/status/doctor/upgrade-status/rollback-install/旧 binary 重启/backup，
  7 步 PASS，且不依赖作者 checkout、只清理自己的 root 与进程。
- 本机复跑结果：`tools/distribution/reports/wave07/artifact-upgrade-acceptance.json`。

## 6. 未测与剩余阻断

- **NOT_TESTED**：跨机器/其它平台与 ABI、个人 native 端到端、schema 变化的真实二进制对、
  每个切换步骤的 SIGKILL、E 独立验收。
- **main**：恢复 commit/激活（D4 部分）；B：执行器能力接口。
- 六组用户服务 5180–5185 / 8796–8801 未启停；所有探针使用隔离临时 root/端口。
