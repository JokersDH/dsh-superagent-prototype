# E 独立验收 recipe：wave-08 保留个人模式的升级、失败清理与精确 schema 拒绝

只使用 D 冻结的两个 tar 与其内安装的 launcher/coordinator；不依赖作者 checkout。旧 wave-07
recipe 与结果保留不动，本文件是当前 schema13 配对。

## 产物（不入 Git）

| 角色 | 文件 | sha256 | buildId | source commit | schema |
| --- | --- | --- | --- | --- | --- |
| baseline | `pa-artifacts/wave06-alpha2/wave06-alpha2-7e8f6ce6.tar.gz` | `0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631` | `7e8f6ce6fa2e2633` | `e10bfdb` | 13 |
| target | `pa-artifacts/wave08-target/wave08-target-cd0ecc29.tar.gz` | `64bbe285d472b1dbaf3830899dabdefdc3ed9a69a750b537e0ee14397ca53d42` | `cd0ecc29d97d5c41` | `9b75c2a` | 13 |

字节/依赖闭包/平台矩阵在 `tools/distribution/reports/wave08/artifacts.json`；schema-12 构建只作为
精确拒绝对照，不得当作升级源。

## 命令

```sh
node tools/distribution/verify-upgrade-artifact.mjs \
  --baseline-tar <baseline tar> --target-tar <target tar> \
  --baseline-sha256 <sha> --target-sha256 <sha> --json

node tools/distribution/smoke-binary-upgrade.mjs \
  --baseline <baseline install 目录> --target <target install 目录> --json
```

第二条需要 `<baseline install>/../*.tar.gz` 唯一，或用 `--baseline-tar` 显式指定；它在解压的
pristine baseline 上跑失败窗口，不污染已共享的 baseline 指针。

## 期望

- E recipe：7/7 PASS（extract、first-run/doctor、静态工作台、backup、binary switch、
  target identity/doctor/journal、binary-only rollback 且 evidence 不变）。
- D recipe：14/14 PASS，其中
  - `B-binary-switch`：`stopped=STOPPED`，实例 `mode=fixture`、`access=local-development`，health 也报
    `fixture`（不是只查 argv）；evidenceDigest 不变；
  - `D-exact-schema-refusal`：旧 schema-12 构建用自己的合法 release 打开 schema-13 state，真实 storage
    读取器以 `MigrationIntegrityError: Applied migration 13 is not registered in this build` 拒绝，
    无 instance 记录、无监听、state 字节不变；新构建对 future schema 返回
    `state_schema_newer_than_binary`，旧构建对 schema-13 bundle 返回 `manifest_invalid`（记录为
    bundle 格式层拒绝，不冒充 schema_unsupported）；
  - `E7-stop-unproven-kept`：注入的停止失败保留 `target_stop_unproven`，不换指针、不重启旧 writer，
    `upgrade-status` 可见，`pa upgrade --recover` 只有在证明目标进程树已停止后才回退；
  - `E8-crash-after-stop-restarts-previous`：停在 pointer 切换前，恢复重启**上一版**（同 mode/access/端口）；
  - `E9-record-missing-reverted`：health 已通过但实例记录未落盘 → 先清理本次目标进程树，再回退指针。

## 不得声称

- 两个产物都是 schema 13：不证明 schema 迁移，只证明精确拒绝。
- 未测跨机器/其它 ABI、个人 native 端到端、真实 personal 计费执行、schema 变化的二进制对、
  每个步骤的 SIGKILL、E 独立验收。
- 回退是二进制指针回退，不恢复备份、不降 schema、不删除升级后数据；显式数据恢复另记操作。
- 恢复激活/commit 仍由 main 持有；`GET /v1/recovery/activations/:id` 的 `not_granted`/
  `startupAvailable=false` 只作为拒绝消费，不是便携启动 token。

## 失败时给 D 的最小输入

保留 E 输出、失败步骤 detail、`--work-root` 下的 `baseline/install/var/logs`、`target/install/var/logs`、
`state/`、`install-switch.json`；不要修改断言、删 marker 或手改 `release.json`。
