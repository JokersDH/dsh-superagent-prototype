# 第十四轮 E 独立验收：完整进程身份与当前 M1 个人安装

E 在自己的 root 独立执行；仅证明安装/托管命令/只读材料，不构成恢复激活、真实模型计费或原生通过。

## 1. 冻结 tuple（以 `tools/distribution/reports/wave14/artifacts.json` 为准）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| target（current M1） | `pa-artifacts/wave14-target/wave14-target-114b73c.tar.gz` | `246fd80ded7b5d2445890a7854dbc6261a71c1c4456f3ee2f41404b9b6e3c785` | `114b73c`（clean） | `a7df2b225a8c5c42` | 18 |
| legacy16 | `pa-artifacts/wave11-target/wave11-target-a22d3a4.tar.gz` | `a10f6274…` | `a22d3a4` | `3311a04bd20ed7f9` | 16 |
| baseline | wave06 `…7e8f6ce6.tar.gz` | `0fe0ed53…` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| 同schema双binary（历史） | wave07/wave08 | 见 artifacts | `76f26a66…`/`9b75c2a1…` | `9120a5ed…`/`cd0ecc29…` | 13 |

target tar 20,177,745 B、6,714 files / 67,286,171 B；含 M1 discussion-only/unavailable execution、history/source/reply、context send、backup/restore、16→18。`99832f6` 保留但不称 current full。

## 2. 命令

```sh
# 6 个纯 mock（完整 PID/start/UID/argv/root/operation + 失败清单/父角色）
PA_ADMISSION_REPORT=/tmp/<role>-mock.json node --experimental-test-module-mocks \
  tools/bootstrap/probe-wave14-delivery.mjs <D> <unpacked-target>

node tools/distribution/verify-multi-instance.mjs --install <target> --json
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json
node tools/distribution/verify-personal-install.mjs --install <target> --json
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json
node tools/distribution/verify-backup-schema16.mjs --install <target> --json
node tools/distribution/verify-portable-closure.mjs --install <target> --json
node tools/distribution/verify-dual-binary.mjs --json
node tools/distribution/verify-target-material.mjs --trusted-parent <0700 private> --json
```

## 3. 预期

- mock 6/6；matrix 19/19；multi 8/8；cross 3/3；data 5/5；personal 7/7；no-executor 4/4；backup 6/6；portable 5+1 NOT_TESTED；dual 6/6；material PASS；smoke 52/52。
- 归属：同 start 但 UID/argv/config/data/operation 不符、外 journal、per-PID stat 失败、畸形清单、安装父目录角色全部 UNKNOWN/拒绝，proven=false，零信号；只有完整身份一致且本次操作证明的资源可停。
- personal：无 Codex 时显式 `--discussion-only` 启动仍为 personal、execution unavailable/operator_disabled、dispatch 422 拒绝，绝不静默 fixture。
- 禁止：pkill、共享路径/单字段认领、删 marker/record、手改 release、自写 SQL/授权、旧 tar 重标 current。

## 4. 清理

只停止命令行/记录可证明属于本次临时 root 的进程；十一组用户服务 5180/8796–5190/8806 及其 state 不动。
