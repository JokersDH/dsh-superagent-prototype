# 第十二轮 E 独立验收：精确进程归属、schema18 数据与当前个人安装

本配方由 D 发布，E 在自己的 root 独立执行。仅证明安装/托管命令/只读材料，不构成恢复激活、真实模型计费或原生通过。

## 1. 冻结 tuple（以 `tools/distribution/reports/wave12/artifacts.json` 为准）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| target（current） | `pa-artifacts/wave12-target/wave12-target-020af82.tar.gz` | `96d32fb55a0d8fa9a02f4a5497c54774e84176b42c5727da449343fb3913bfe5` | `020af82`（clean） | `1a2f34ac359a5739` | 18 |
| legacy16（真实旧包） | `pa-artifacts/wave11-target/wave11-target-a22d3a4.tar.gz` | `a10f627492c0f9ebc709137689fb26ed59f2bb463c7ea93d7c347a682770d2cb` | `a22d3a4` | `3311a04bd20ed7f9` | 16 |
| baseline（历史拒绝矩阵） | `pa-artifacts/wave06-alpha2/…7e8f6ce6.tar.gz` | `0fe0ed53…c7631` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| 同schema双binary（历史scope） | wave07/wave08 tar | 见 artifacts | `76f26a66…`/`9b75c2a1…` | `9120a5ed…`/`cd0ecc29…` | 13 |

target tar 20,147,268 B、6,707 files / 67,149,633 B extracted；`a22d3a4`、`cf7a3cf` 保留原标签，不重标。

## 2. 实际命令

```sh
# 只读归属 probe（mock scanner/signals；无真实 OS 扫描/信号）
PA_ADMISSION_REPORT=/tmp/<role>-probe.json node --experimental-test-module-mocks \
  tools/bootstrap/probe-wave12-delivery.mjs <D> <unpacked-target-install>

# 同install多state + 跨state拒绝 + 空格/中文路径
node tools/distribution/verify-multi-instance.mjs --install <target install> --json

# 19段托管矩阵（含真实 SIGKILL E13/E14；stop 一律走记录所属 install）
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06 install> --target <target install>

# 真实进程归属 + schema16→18 升级/旧binary拒绝
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16 install> --to <target install> --json

# schema18 非空数据：真实 product prepare/send + 完成回复 + A snapshot 搬根恢复
node tools/distribution/verify-schema18-data.mjs --install <target install> --legacy-install <legacy16 install> --json

# 备份闭包（A 族/损坏/未来schema/13→18迁移）
node tools/distribution/verify-backup-schema16.mjs --install <target install> --json

# 便携闭包、普通 personal 冷安装、历史同schema双binary、惰性材料
node tools/distribution/verify-portable-closure.mjs --install <target install> --json
node tools/distribution/verify-personal-install.mjs --install <target install> --json
node tools/distribution/verify-dual-binary.mjs --json
node tools/distribution/verify-target-material.mjs --trusted-parent <0700 私有父目录> --json
```

## 3. 预期与禁止

- 期望：probe 6/6；matrix 19/19；multi 8/8；personal 7/7；portable 5+1 NOT_TESTED；backup 6/6；schema18-data 5/5；cross 3/3；dual 6/6；material PASS；smoke 52/52。
- 归属：requested install/config/data 与记录/进程不一致时 `requested_root_mismatch`；复制 record 到他 config、旧 install、data-root 均拒绝且不 signal/不删记录；recover 的 starting/cleanup/rollback 同一核对；未登记 PID 只作 unknown，不进入 stop。
- 数据：完成回复/context binding 在 Store 重开与 A snapshot 搬根后保持；损坏 bundle `archive_invalid`；未来 schema `state_schema_newer_than_binary`；16→18 由 A 公开入口迁移。
- 禁止：pkill、按共享 install/cache/logs/workspace 认领进程、删 marker/record、手改 release.json、自写 SQL/授权、把旧 schema15/16 当 current18。

## 4. 清理

只停止命令行/记录可证明属于本次临时 root 的进程；不动九组用户服务 5180/8796–5188/8804 及其 state。
