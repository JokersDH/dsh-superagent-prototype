# 第十九轮 E 独立验收：b911 同包 + 985 双格式 + 真实业务搬根

E 独立执行；安装/托管命令/只读材料证明，不构成激活、真实模型计费或原生通过。先冻结输入，再跑行为。

## 1) 先验准确 b911 同包（已冻结，非本轮重贴）

| 项 | 值 |
| --- | --- |
| source | `b9117aa` clean |
| buildId | `6a45633067501dd2` |
| tar | `pa-artifacts/wave18-target/wave18-target-b9117aa.tar.gz` |
| sha256 | `4a81380a5fd0c69aabe8d38604dd661ab3fb3f30113b4bb2d3e5156c2ff54c1a` |
| bytes/files | 20,231,965 B / 6,742 |
| schema/ABI/mode | 18 / darwin-arm64 / personal+fixture |

命令：`PA_ADMISSION_REPORT=/tmp/<new>.json node --experimental-test-module-mocks tools/bootstrap/probe-wave18-delivery.mjs <unpacked-b911>` → 5/5；helper 从该不可变包加载。`verify-nonempty-personal-http.mjs --install <b911>` → 11 步（1 步 restored rebind fixture-limit）。

## 2) 本轮后继包（含 main985 双格式实际调用）

| 项 | 值 |
| --- | --- |
| source | `ee7fbd8` clean |
| buildId | `90e81429079a7d50` |
| tar | `pa-artifacts/wave19-target/wave19-target-ee7fbd8.tar.gz` |
| sha256 | `b0990149d0a8c81a130d358ea07100332bc30d509e9c7dfdf7a176e61b7f7ecc` |
| bytes/files | 20,236,793 B / 6,742 |
| schema/ABI/mode | 18 / darwin-arm64 / personal+fixture |

```sh
node tools/distribution/verify-real-business-relocation.mjs --install <target> --business <retained-B-normal-state> --json  # 4/4
node tools/distribution/verify-nonempty-personal-http.mjs --install <target> --json                       # 11 步
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>                   # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                              # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json           # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json   # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json                           # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json                       # 4/4
node tools/distribution/verify-source-confirmation-http.mjs --install <target> --json                   # 5/5
node tools/distribution/verify-same-schema18-upgrade.mjs --from <safe651> --to <target> --json          # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                            # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json                           # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                                   # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json                       # 8/8
node tools/distribution/smoke.mjs --keep-root <new>                                                     # 52/52
```

## 3) 格式与协议（实际调用，不靠字符串）

- `storage.readWorkflowEvidence(db)` 与 `(db,1)` 必须同为 `workflow-evidence/1`、13 families、同一 digest；`(db,2)` 必须为 `workflow-evidence/2`、familySetVersion 2、21 families。真实业务状态 v1/v2 digest 分别是 `caace32a…dffc9` / `87979117…0ebf7`。
- 非法 version 3 必须 `TypeError` 且不创建 DB 文件。
- `portability.createBundle`/`verifyBundle` 实际调用；manifest `evidence.protocol=personal-evidence`、`formatVersion` ∈ {1,2}（该真实数据为2），bundle formatVersion1。personal-evidence 与 workflow-evidence 是两个协议，不能互相代替。

## 4) 真实业务 readonly / source

保留 B 提交的 normal producer 数据（Work/Broker/question/answer/native_applied，real vendor/native 0），backup→第二私有 root restore→`recovery_readonly` HTTP：snapshot works≥1、业务写 422、源 digest 不变、old queue 不重放；source prepare/confirm/audit 仍 `not_granted`/`startupAvailable=false`，target 不启动。

## 5) 当前限制（必须保留）

- **restored-personal 历史项目只读绑定/rebind 未实现**：候选/历史 source HTTP 可能 403；不得改用 `--fixture` 后宣称 personal 通过。该真实业务恢复以 restore-report 的 `fixture` mode 运行，未冒充 personal。
- 历史 Work 对恢复 actor 可能 400/403 “Unknown authorized work”，只记 fixture-limit。
- A v2 未准入；跨平台/ABI、真实个人计费 turn、逐步 SIGKILL、main private activation/target 未测。
- 旧 97 只 mock 负对照，不 live、不重标 current；十二服务 5180/8796–5191/8807 不动。
