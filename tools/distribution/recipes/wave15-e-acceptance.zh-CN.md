# 第十五轮 E 独立验收：完整进程身份与当前 M1/runtime recovery

E 在自己 root 独立执行；安装/托管命令/只读材料证明，不构成激活、真实模型计费或原生通过。

## 冻结 tuple（`tools/distribution/reports/wave15/artifacts.json`）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| target | `pa-artifacts/wave15-target/wave15-target-b1854c0-r2.tar.gz` | `11497980a4077e854b64596c71efe45b1e68e058639838acef0b07657d61f54b` | `8962d10` clean | `88df6d2eef1feeb7` | 18 |
| legacy16 | wave11 `a22d3a4` tar | `a10f6274…` | `a22d3a4` | `3311a04bd20ed7f9` | 16 |
| baseline | wave06 `…7e8f6ce6` | `0fe0ed53…` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| 同schema双binary | wave07/wave08 | 见 artifacts | 历史 | 历史 | 13 |

target tar 20,190,414 B、6,719 files / 67,336,231 B；含 complete birth identity、post-signal tri-state、M1 discussion-only、runtime recovery inspect HTTP、history/source/reply、16→18。旧 114b73c 不重标。

## 命令与预期

```sh
PA_ADMISSION_REPORT=/tmp/<role>-probe.json node --experimental-test-module-mocks tools/bootstrap/probe-wave15-delivery.mjs <D> <unpacked-target>   # 4/4
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>            # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                       # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json    # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json                    # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json                # 4/4
node tools/distribution/verify-runtime-recovery-http.mjs --install <target> --json               # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                     # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json                    # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                            # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json                # 8/8
```

归属：真实 onSpawn 必存 pid/start/UID/command/config/data/install/operation；journal/spawn 缺任一即 UNKNOWN，callers 必传 operation；SIGTERM 后 stat 不可读保持 UNKNOWN/不 proven；recover 缺身份 BLOCKED。personal 无 Codex 显式 `--discussion-only` 为 personal+unavailable+422，绝不 fixture。inspect HTTP 真返回 commitAvailable=false，normal 非恢复实例 prepare 422。

禁止：pkill、共享路径/单字段认领、删 marker/record、手改 release、自写 SQL/授权、旧 tar 重标 current。只停本次临时 root 可证明进程；十一组服务 5180/8796–5190/8806 不动。
