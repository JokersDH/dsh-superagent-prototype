# E 独立验收 recipe：两个真实二进制安装物、切换与数据保护（wave-07 D）

本 recipe 只使用 D 冻结的两个 tar 与其中已安装的 launcher/coordinator，不依赖作者 checkout
（脚本本身在 checkout 里运行，但被验证的运行时全部来自解压后的安装物）。

## 产物（不入 Git）

| 角色 | 文件 | sha256 | buildId | source commit | schema |
| --- | --- | --- | --- | --- | --- |
| baseline | `/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/wave06-alpha2-7e8f6ce6.tar.gz` | `0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631` | `7e8f6ce6fa2e2633` | `e10bfdb7a74f40b72a5e61d0debb0ed0bdd22389` | 13 |
| target | `/Users/hh/Desktop/joker/pa-artifacts/wave07-target/wave07-target-3e7f046e.tar.gz` | `c5ea704faf8a8b8766982757757c2fab2b76ac7b4f9008fe9948b9db147f2e02` | `3e7f046e03f2ce5d` | `5adf00b100431bcd923a867e1f62c78999359392` | 13 |

字节数、依赖闭包、workspace 包数、平台矩阵见 `tools/distribution/reports/wave07/artifacts.json`。
两个 buildId/source 不同，且文件数相差 24；只改 tag 的重打包不作为证据。

## 命令

```sh
node tools/distribution/verify-upgrade-artifact.mjs \
  --baseline-tar <baseline tar> --target-tar <target tar> \
  --baseline-sha256 <上面的 sha> --target-sha256 <上面的 sha> \
  --json > <E 自己的输出路径>
```

脚本把两个 tar 解压到自己的新 root，`first-run` → `doctor` → `start` → 静态工作台 → `backup`
→ `upgrade --to target` → `status/doctor/upgrade-status` → `rollback-install` → 旧 binary 再启动
→ `backup`，最后只清理自己的 root 和自己启动的进程。

## 期望

- 7 步 PASS：`extract-verify`、`baseline-first-run-doctor`、`baseline-start-workbench`、
  `pre-upgrade-backup`、`binary-switch`、`target-doctor-status-journal`、`binary-rollback-no-data-loss`。
- `binary-switch.stopped = STOPPED`，切换后实例 `buildId = target`，`evidenceDigest` 与升级前一致；
- `upgrade-status.status = confirmed`、`dataRolledBack = false`；
- `binary-rollback-no-data-loss.pointer = baseline buildId`，数据 evidence 摘要不变。

## 不得声称

- 两个产物 schema 都是 13：本 recipe 证明安装/切换/回退机制与数据不被静默改写，**不是 schema
  迁移证明**；schema 不兼容拒绝由 D 的 `smoke-binary-upgrade.mjs` 用 wave-06 schema-12 产物证明。
- 不证明恢复激活（main 的 commit 未发布）、不证明个人 native 端到端、不证明跨机器/其他 ABI。
- 回退是**二进制指针回退**，不恢复备份、不降 schema、不删除升级后数据；显式数据恢复必须用
  `pa restore`/`pa rollback --bundle` 并保留原 state。

## 失败时给 D 的最小输入

保留 `<E 输出>`、失败步骤的 `detail`、以及 `--work-root <保留目录>` 下的
`baseline/install/var/logs/`、`target/install/var/logs/`、`state/` 与 `install-switch.json`。
不要修改 E 的断言，也不要删除 restore marker 或手工改 `release.json` 来“修好”切换。
