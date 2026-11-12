# 第十一轮 E 独立验收：多实例隔离、schema16 备份闭包、便携安装与双 binary 升级

本配方由 D 发布，E 在自己的 root 独立执行。仅证明安装/托管命令/只读材料，不构成恢复激活、真实模型计费或原生通过。

## 1. 冻结 tuple（以 `tools/distribution/reports/wave11/artifacts.json` 为准）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| baseline（保留历史） | `pa-artifacts/wave06-alpha2/wave06-alpha2-7e8f6ce6.tar.gz` | `0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| target（本轮 current） | `pa-artifacts/wave11-target/wave11-target-a22d3a4.tar.gz` | `a10f627492c0f9ebc709137689fb26ed59f2bb463c7ea93d7c347a682770d2cb` | `a22d3a4`（clean，20,132,388 B tar / 66,970,514 B / 6,697 files） | `3311a04bd20ed7f9` | 16 |
| dual-from | `pa-artifacts/wave07-target2/wave07-target-9120a5ed.tar.gz` | `bbc133125271…` | `76f26a66…` | `9120a5ed858e0feb` | 13 |
| dual-to | `pa-artifacts/wave08-target/wave08-target-cd0ecc29.tar.gz` | `64bbe285d472…` | `9b75c2a1…` | `cd0ecc29d97d5c41` | 13 |

`wave10 cf7a3cf/schema15`、`wave09 6830e38/schema15` 仅历史保留，不得改标签称 current main/schema16。

## 2. 实际命令（全部可独立重跑）

```sh
# D1/D2：只读身份 probe + 同 install 两 state 副作用矩阵（跨 state 请求必须拒绝且不 signal）
node tools/bootstrap/probe-wave11-delivery.mjs <D> <E>
node tools/distribution/verify-multi-instance.mjs --install <target install> --json

# D3/D8：含真实 SIGKILL 的 19 段托管矩阵；双 binary 同 schema 升级/回退
node tools/distribution/smoke-binary-upgrade.mjs --baseline <baseline install> --target <target install>
node tools/distribution/verify-dual-binary.mjs --json

# D4：schema16 + A 数据族备份/恢复、损坏包拒绝、未来 schema 精确拒绝、schema13→16 迁移
node tools/distribution/verify-backup-schema16.mjs --install <target install> --json

# D5/D7：空格/中文路径搬迁、隔离 HOME、缺 runtime/权限负例、personal 冷安装（零 turn）
node tools/distribution/verify-portable-closure.mjs --install <target install> --json
node tools/distribution/verify-personal-install.mjs --install <target install> --json

# D9：惰性目标材料 + A 公开 reader 的空 schema inventory
node tools/distribution/verify-target-material.mjs --trusted-parent <0700 私有父目录> --json
```

## 3. 预期与禁止

- 期望：probe 3/3；矩阵 **19/19**；multi-instance 8/8；personal 7/7；backup 6/6；portable 5 PASS+1 NOT_TESTED；dual 6/6；material PASS（含 `inventory-readonly`）。
- 跨 state：`stop/status/start` 返回 `requested_root_mismatch`；他 state 的 PID/API/DB/record 不变；未知 listener 返回 `unknown_live_resource` 且不 signal。
- 真实 SIGKILL：E13/E14 进程被 SIGKILL，journal 为唯一见证，重入须 `upgrade_recover_required`，recover 后 journal terminal。
- 备份：损坏 bundle `archive_invalid`；未来 schema（A 公开 `applyMigrations` fixture 写入 17）由当前 binary `state_schema_newer_than_binary` 拒绝；schema13 bundle 经 A `ProductStore` 公开入口迁移到 16。
- 禁止：放宽 digest、删 marker/record、手改 `release.json`、pkill、用材料/空库自授权、把旧 schema15 当 current。

## 4. 清理

只停止命令行/记录可证明属于本次临时 root 的进程；不动九组用户服务 5180/8796–5188/8804 及其 state。
