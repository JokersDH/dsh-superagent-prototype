# 第九轮 E 独立验收：真实托管升级与私有目标材料

本recipe由D发布，E在自己的root执行。它只证明**实际安装物的托管升级/恢复/回滚**与**无启动权的目标材料准备**，不构成激活授权、个人计费或原生通过。

## 1. 输入tuple（必须逐项核对，不用checkout代替）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| baseline | `/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/wave06-alpha2-7e8f6ce6.tar.gz` | `0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631` | `e10bfdb7a74f40b72a5e61d0debb0ed0bdd22389` | `7e8f6ce6fa2e2633` | 13 |
| target | `/Users/hh/Desktop/joker/pa-artifacts/wave09-target-r2/wave09-target-6830e38.tar.gz` | `62861d93d064374f90f7b638e6473804aeaab516d0633fbb9ffa453924434ae9` | `6830e38c73f50542c7d836e4d5e579bcf5d27fe2`（clean，D wave-09） | `f2390ffd1b87b79a` | 15 |

平台/ABI：darwin/arm64、Node 24.21.x、SQLite ABI 137。tar字节数：baseline 19,966,910；target 20,041,0xx（见artifacts.json）。
完整事实见`tools/distribution/reports/wave09/artifacts.json`。**不得**把旧wave-08 schema13包（`cd0ecc29`/`9b75c2a`）或被本r2取代的`b295504`候选当当前main/schema15产物。

## 2. 实际命令

在E自己的目录解包（不要用作者checkout）：

```sh
tar -xzf <baseline tar> -C <E-root>/baseline
tar -xzf <target tar>   -C <E-root>/target
```

托管失败窗口（D已复跑17/17 PASS；E独立重跑）：

```sh
node tools/distribution/smoke-binary-upgrade.mjs \
  --baseline <E-root>/baseline/install --target <E-root>/target/install
```

它使用真实`upgrade`/`upgrade --recover`/`rollback-install`（不是两次`start`指向同一state），并断言：进程/指针/数据/模式一致，失败目标先证明停止再回退，`dataRolledBack`恒false。

schema变化的托管验收（D已复跑9/9 PASS）：

```sh
node tools/distribution/verify-upgrade-artifact.mjs \
  --baseline-tar <baseline tar> --target-tar <target tar> \
  --baseline-sha256 0fe0…c7631 --target-sha256 6286…4ae9 --schema-change --json
```

覆盖：解包校验→first-run/doctor→静态工作台→升级前备份→target首次启动迁移13→15→实例身份/doctor/journal→binary-only rollback指针回baseline→旧二进制对schema15**精确拒绝**（`MigrationIntegrityError: Applied migration <n> is not registered`，无instance记录）→重新切回兼容target并健康→仅本root清理。

私有目标材料（无激活权）：

```sh
node tools/distribution/verify-target-material.mjs --trusted-parent <0700私有目录> --json
```

期望`PASS`且`inventory-reader-unavailable: SKIPPED`（A只读inventory尚未进main）。若E拿到真实reader，追加`--inventory-module <A实现>`；材料必须`startupAvailable:false`、只含`recovery-target.json`、无DB/queue/凭据，`discardStaging`只删该activation的staging且拒绝已初始化target。

## 3. 预期code与断言（失败窗口）

| 窗口 | 期望 | 断言 |
| --- | --- | --- |
| E1 篡改target | `target_tampered` | 运行中实例未停止、health仍ok |
| E2 `--no-stop`运行中 | `upgrade_requires_stopped_instance` | 未发信号 |
| E3 记录pid不实但活 | `instance_record_unverified` | 陌生进程未杀 |
| E4 target不健康 | `upgrade_target_unhealthy` | 指针回退、业务行不变 |
| E5 切换后崩溃 | `upgrade_interrupted` → `--recover` `RECOVERED` | 实例=target build |
| E6 重复upgrade | `upgrade_already_applied` | 无第二次切换 |
| E7 停止不可证明 | `target_stop_unproven`，journal/doctor同code，单一`pa upgrade --recover` | 指针/记录不动，恢复后才回退`REVERTED` |
| E8 停止后、指针前崩溃 | 恢复重启**上一版**（`RECOVERED_PREVIOUS`） | 同模式/端口 |
| E9 health成功但记录未落盘 | `upgrade_target_unhealthy`+`instance_record_missing` | 无instance.json，target树已停止 |
| E10 launcher死、API活 | `CONFIRMED` | orphan API被证明归本state后停止，旧record清除 |
| E11 陌生活进程占用记录 | `unknown_live_resource` | 进程未杀、指针不变 |
| E12 未结算journal重入 | `upgrade_recover_required` | 先recover再允许新切换 |

## 4. 清理与禁止

- 只停止本次E root的pid（命令行指向该root/install）；不要`pkill`、不要删旧queue/marker、不重置账号/全局runtime。
- 不得放宽digest、删除marker、手改`release.json`、用`--force`绕过屏障，或把`startupAvailable:false`的材料/审计/空表说成激活。
- 旧wave-05/06/07/08证据与预算保留；E最终准入在拿到本tuple字节后独立判定，D不等待循环。
