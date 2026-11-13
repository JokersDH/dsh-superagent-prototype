# 第十七轮 E 独立验收：独立子身份与当前 source 确认

E 独立执行；安装/托管命令/只读材料证明，不构成激活、真实模型计费或原生通过。

## 冻结 tuple（`tools/distribution/reports/wave17/artifacts.json`）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| target | `pa-artifacts/wave17-target/wave17-target-65102f7.tar.gz` | `33d874c9a25f22d2710fb29d686f03ad5b37de7ad2cdb09f40d16fd7ecb86340` | `65102f7` clean | `f55470ae14cc4985` | 18 |
| 同schema18旧binary | wave16 `…97cace7` | `6b6517c4…` | `97cace7` | `8a5a0a85631f22ca` | 18 |
| legacy16 | wave11 `a22d3a4` | `a10f6274…` | `a22d3a4` | `3311a04bd20ed7f9` | 16 |
| baseline | wave06 `…7e8f6ce6` | `0fe0ed53…` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| 同schema13双包 | wave07/wave08 | 见 artifacts | 历史 | 历史 | 13 |

target tar 20,225,208 B、6,737 files / 67,493,046 B；含独立子身份门、M1、e32 source prepare/confirm/audit（data-only、not_granted）、runtime recovery HTTP、history/source/reply。旧 97cace7 不重标 current。

## 命令与预期

```sh
PA_ADMISSION_REPORT=/tmp/<new>.json node --experimental-test-module-mocks tools/bootstrap/probe-wave17-delivery.mjs <D> <unpacked-target> # 3/3
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>                 # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                            # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json         # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json                         # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json                     # 4/4
node tools/distribution/verify-source-confirmation-http.mjs --install <target> --json                 # 5/5
node tools/distribution/verify-same-schema18-upgrade.mjs --from <wave16> --to <target> --json         # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                          # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json                         # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                                 # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json                     # 8/8
```

子身份：只有 record API/console 或 journal 出生 children（pid/start/uid/command/root/operation）可 owned；same-UID 但未登记的 child 保持 UNKNOWN，0 信号、父 stop 不 proven，actual recover 保持 BLOCKED/journal/pointer 不变。完整父身份正对照仍 SIGTERM 父且 proven。

source 确认：非空备份→新私有 root restore（恢复只读 marker）→真实 `/v1/recovery/source/prepare`→`/source/confirm`→`/activations/:id`；返回 authorization=not_granted、startupAvailable=false，无目标启动/队列/权限；不是 grant。personal 无执行器仍 personal/unavailable/422。

限制：main 非空建议候选 fixture 未通过（需 main/C verified body+proposal scope），本包明确 NOT_TESTED，不用空数据 PASS 顶替；旧 97cace7 的 6731 项检查保留。禁止 pkill、路径/UID 认领、删 marker/record、旧 tar 改名。十二服务 5180/8796–5191/8807 不动。
