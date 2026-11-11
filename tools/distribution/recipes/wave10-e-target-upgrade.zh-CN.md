# 第十轮 E 独立验收：普通个人安装、托管升级与私有目标材料

本recipe由D发布，E在自己的root执行。仅证明安装物/托管操作/惰性材料，不构成恢复激活、个人计费或原生通过。

## 1. 输入tuple（以最终冻结字节为准）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| baseline | `/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/wave06-alpha2-7e8f6ce6.tar.gz` | `0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631` | `e10bfdb7a74f40b72a5e61d0debb0ed0bdd22389` | `7e8f6ce6fa2e2633` | 13 |
| target | `/Users/hh/Desktop/joker/pa-artifacts/wave10-target/wave10-target-cf7a3cf.tar.gz` | `f886a05c55dbe581198ce587d1c80c410ec08d13012ff0689cc77d70f44df5a2` | `cf7a3cfeb4ebabebe95b8670bae33a97d3a71596`（clean） | `da2d78d126e4745f` | 15 |

E必须从该JSON取tar/sha256/source/build/schema/平台/ABI/字节数（target tar 20,073,981 B，6670文件），不得用checkout或旧波次包替代。

## 2. 实际命令

```sh
# 托管升级/恢复/回滚：17个失败与一致性窗口（E1–E12含孤儿API、未知活进程、真实缺记录、重入）
node tools/distribution/smoke-binary-upgrade.mjs --baseline <baseline install> --target <target install>

# 普通个人安装：冷启动/doctor/personal模式零turn/备份/只读恢复/搬迁；不需要恢复激活
node tools/distribution/verify-personal-install.mjs --install <target install> --json

# schema变化的E级验收（旧二进制对新schema精确拒绝、同schema回滚由矩阵覆盖）
node tools/distribution/verify-upgrade-artifact.mjs --baseline-tar <tar> --target-tar <tar> \
  --baseline-sha256 <sha> --target-sha256 <sha> --schema-change --json

# 私有目标材料：main合法DTO、准确root/digest、parent生命周期、A公开Store空schema、staging拒绝
node tools/distribution/verify-target-material.mjs --trusted-parent <0700私有目录> --json
```

## 3. 预期断言

- 矩阵17/17 PASS；personal recipe 7/7 PASS；schema-change recipe 9/9 PASS；材料recipe PASS（`inventory-reader-unavailable: SKIPPED`表示A reader未集成，不得当作空表通过）。
- 普通个人安装：`health.mode === 'personal'`且记录`mode/access`一致，**不派发工作**，turn=0。
- 材料：`startupAvailable:false`；仅manifest；main用A公开Store初始化后`read`仍可重放且`discardStaging`拒绝删除；parent换symlink/换inode/digest不符/非准确root在写前拒绝。
- 禁止：放宽digest、删marker、手改`release.json`、用`--force`绕过屏障、把材料/审计/空库当激活。

## 4. 清理

只停止本recipe自己spawn且命令行指向本次root的进程；不pkill、不删旧queue/marker、不动八组用户实例5180/8796–5187/8803。
