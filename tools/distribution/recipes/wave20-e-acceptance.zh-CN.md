# 第二十轮 E 独立验收：显式 personal 只读入口与准确后继包

E 独立执行；安装/托管命令/只读材料证明，不构成激活、真实模型计费或原生通过。先验准确输入，再跑行为。

## 1) 先给 E 的稳定 ee 输入（非本轮重贴）

| 项 | 值 |
| --- | --- |
| source | `ee7fbd8` clean |
| buildId | `90e81429079a7d50` |
| tar | `pa-artifacts/wave19-target/wave19-target-ee7fbd8.tar.gz` |
| sha256 | `b0990149d0a8c81a130d358ea07100332bc30d509e9c7dfdf7a176e61b7f7ecc` |
| bytes/files | 20,236,793 B / 6,742 |
| schema/ABI | 18 / darwin-arm64 |

ee 早于 main773 的 review-restored，**不具备新只读绑定入口**，不得重贴为 binding capable。b911 仍是 E 已准入 ordinary personal 基线，97 仅 mock。

## 2) 本轮必要新字节（含 launcher 显式 review 参数）

| 项 | 值 |
| --- | --- |
| source | `e4e0623` clean |
| buildId | `637ed44e850f447a` |
| tar | `pa-artifacts/wave20-target/wave20-target-e4e0623.tar.gz` |
| sha256 | `1f78e38b3568a781ebf4670174451516ceb7c32b982b0990e21757c34e4ddfc1` |
| bytes/files | 20,237,580 B / 6,743 |
| schema/ABI/mode | 18 / darwin-arm64 / personal+fixture |

```sh
node tools/distribution/verify-nonempty-personal-http.mjs --install <target> --json                 # 12 步，含 review
node tools/distribution/verify-real-business-relocation.mjs --install <target> --business <B-state> --json # 4/4
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>              # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                         # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json     # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json                      # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json                  # 4/4
node tools/distribution/verify-source-confirmation-http.mjs --install <target> --json              # 5/5
node tools/distribution/verify-same-schema18-upgrade.mjs --from <b911/651> --to <target> --json   # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                       # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json                      # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                              # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json                  # 8/8
node tools/distribution/smoke.mjs --keep-root <new>                                                # 52/52
```

## 3) 显式 review 入口断言（实际 HTTP/CLI）

- 未给 `--review-restored-scope`：restored 只读状态候选返回 403（当前 main 历史项目未绑定的真实限制）。
- 由 main `prepareRestoredReview` 生成 0600 配置（protocol `restored-personal-review/1`，窗口 300000ms，access `historical_data_read_only`，startupAvailable false）后，显式 `pa start --discussion-only --review-restored-scope <file>`：候选 2 个 200、history 200、source 200；业务写 422；模型请求0、native0。
- 负例：`--fixture` + review 拒绝（`review_requires_restored_personal`）；缺失文件 `review_scope_missing`；0644/符号链接 `review_scope_invalid`；篡改 HMAC 文件无法启动。
- **不得自动扫描/加载旧 file，不得用 fixture 绕过 403 冒充 personal 通过；配置是启动时一次性只读选择，不是长期 grant。**

## 4) 格式/协议分层（实际调用）

- workflow-evidence：默认/1 = `/1` 13 families；显式2 = `/2` familySetVersion2 21 families；非法3 在建 DB 前 TypeError。
- personal-evidence/bundle：实际 `createBundle`/`verifyBundle`，manifest `personal-evidence`、formatVersion2、bundle formatVersion1；与 workflow-evidence 是两个协议。
- B 真实 normal 数据（Work/Broker/Q&A/native_applied，vendor/native0）单独搬根/readonly/source 通过；与 SDK candidate/review personal 数据是**分开的 scope**，未合并成同一 Store。

## 5) 限制

B 真实业务与 SDK/context/candidate 未合并同一 Store（诚实分 scope）；A v2 未准入；main private startup permission/target 未实现；跨平台/ABI、真实计费 turn、逐步 SIGKILL 未测；97 不 live；十二服务 5180/8796–5191/8807 不动。
