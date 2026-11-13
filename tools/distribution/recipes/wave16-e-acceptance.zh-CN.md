# 第十六轮 E 独立验收：资源边界与当前建议版个人交付

E 在自己 root 独立执行；安装/托管命令/只读材料证明，不构成激活、真实模型计费或原生通过。

## 冻结 tuple（`tools/distribution/reports/wave16/artifacts.json`）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| target（current suggested） | `pa-artifacts/wave16-target/wave16-target-97cace7.tar.gz` | `6b6517c441e56405ac9929ffbd7b3e3c8149b217c5ea736a2d9a447b4b4546c3` | `97cace7` clean | `8a5a0a85631f22ca` | 18 |
| 同 schema18 旧 binary | wave15 `…b1854c0-r2` | `11497980…f54b` | `8962d10` | `88df6d2eef1feeb7` | 18 |
| legacy16 | wave11 `a22d3a4` | `a10f6274…` | `a22d3a4` | `3311a04bd20ed7f9` | 16 |
| baseline | wave06 `…7e8f6ce6` | `0fe0ed53…` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| 同schema13双包 | wave07/wave08 | 见 artifacts | 历史 | 历史 | 13 |

target tar 20,218,294 B、6,731 files / 67,462,076 B；含安全资源边界、M1、runtime recovery HTTP、main 建议版候选/私有偏好（默认 off）、history/source/reply。旧 8962d10 不重标 current。

## 命令与预期

```sh
PA_ADMISSION_REPORT=/tmp/<new>.json node --experimental-test-module-mocks tools/bootstrap/probe-wave16-delivery.mjs <D> <unpacked-target> # 4/4
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>                 # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                            # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json         # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json                         # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json                     # 4/4
node tools/distribution/verify-runtime-recovery-http.mjs --install <target> --json                    # 3/3
node tools/distribution/verify-current-personal-http.mjs --install <target> --json                    # 4/4
node tools/distribution/verify-same-schema18-upgrade.mjs --from <wave15> --to <target> --json         # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                          # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json                         # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                                 # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json                     # 8/8
```

资源：完整父身份（PID/start/UID/argv/config/data/install/operation）下 foreign-UID 子进程不因路径/祖先继承 owned、0 信号；全局 discovered stat UNKNOWN 保持 unknown 使 proven=false；actual recover 保持 BLOCKED + journal 不变 + pointer 不变。recover 成功终态（NO_OP/RECOVERED/RECOVERED_PREVIOUS/REVERTED/CONFIRMED）统一 exit0，BLOCKED exit2，不出“成功 status + exit1”。

个人：无 Codex 显式 discussion-only 仍 personal/unavailable/422；main 建议版默认 suggestions off，私有偏好写入 `*.assistant-settings.json`（0600，legacy model JSON 不变），候选路由实际存在（本 fixture 为 403 forbidden，非 unsupported）。

限制：非空建议正文/已确认决定需要真实返回请求或 main/A 决定 API，本包只标候选/preference 路由与实际回复 body 已覆盖，建议数据 fixture 受限；不得用旧空数据 PASS 顶替。禁止 pkill、共享路径认领、删 marker/record、旧 tar 改名。十二服务 5180/8796–5191/8807 不动。
