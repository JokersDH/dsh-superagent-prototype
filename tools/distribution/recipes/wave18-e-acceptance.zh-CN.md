# 第十八轮 E 独立验收：同包 personal 候选、搬根与 source 事实

E 独立执行；安装/托管命令/只读材料证明，不构成激活、真实模型计费或原生通过。

## 冻结 tuple（`tools/distribution/reports/wave18/artifacts.json`）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| target | `pa-artifacts/wave18-target/wave18-target-b9117aa.tar.gz` | `4a81380a5fd0c69aabe8d38604dd661ab3fb3f30113b4bb2d3e5156c2ff54c1a` | `b9117aa` clean | `6a45633067501dd2` | 18 |
| 同schema18旧binary | wave17 `…65102f7` | `33d874c9…` | `65102f7` | `f55470ae14cc4985` | 18 |
| legacy16 | wave11 `a22d3a4` | `a10f6274…` | `a22d3a4` | `3311a04bd20ed7f9` | 16 |
| baseline | wave06 `…7e8f6ce6` | `0fe0ed53…` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| 旧sameUID 97 | wave16 `…97cace7` | `6b6517c4…` | `97cace7` | `8a5a0a85631f22ca` | 18 |

target tar 20,231,965 B、6,742 files / 67,507,039 B；含 e438ab5 schema guard、registered-child 门、同包 fake-SDK 非空候选、搬根/source 事实。A v2 未准入，不声称支持。旧 97 只做 mock 负对照，不 live、不重标 current。

## 命令与预期

```sh
PA_ADMISSION_REPORT=/tmp/<new>.json node --experimental-test-module-mocks tools/bootstrap/probe-wave18-delivery.mjs <unpacked-target> # 5/5（frozen helper 同包）
node tools/distribution/verify-nonempty-personal-http.mjs --install <target> --json                      # 11 步（1 步 fixture-limit）
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>                  # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                             # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json          # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json  # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json                          # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json                      # 4/4
node tools/distribution/verify-source-confirmation-http.mjs --install <target> --json                  # 5/5
node tools/distribution/verify-same-schema18-upgrade.mjs --from <wave17> --to <target> --json          # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                           # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json                          # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                                  # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json                      # 8/8
node tools/distribution/smoke.mjs --keep-root <new>                                                    # 52/52
```

personal：私本机 fake OpenAI endpoint + 私有 model config；discussion-only/无执行器，native/vendor 0。实际 context prepare/send 产生非空 `propose_work`/`propose_decision`；candidate GET/prepare、reject、decision confirm、同命令 replay 均通过；无执行器下 work confirm 明确 422 unsupported_capability；原请求 requestContext/sourceMessageId 与 source message 一致。

搬根：同一 personal state backup→新私有 root restore→`recovery_readonly` HTTP。原文消息/业务拒绝/source prepare/confirm/audit（not_granted/startupAvailable=false）通过；非空候选与历史 source 读因 main 尚未实现 restored-project rebind 返回 403（显式 fixture-limit，非 PASS）。不 copy credentials；restore 后 model 请求数0。

限制：A v2 未准入；restored-project rebind 未实现；跨平台/ABI、真实个人计费 turn、逐步 SIGKILL 未测。禁止 pkill、路径/UID 认领、删 marker/record、旧 tar 改名。十二服务 5180/8796–5191/8807 不动。
