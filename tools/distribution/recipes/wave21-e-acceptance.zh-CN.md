# 第二十一轮 E 独立验收：生效选择复用与同包准备/启动

E 独立执行；不构成私有启动许可、target/native/真实模型证明。

## 准确输入

| 项 | 值 |
| --- | --- |
| 本轮 source | `595b3f1` clean |
| buildId | `cc16eca05e4da244` |
| tar | `pa-artifacts/wave21-target/wave21-target-595b3f1.tar.gz` |
| sha256 | `e875b9b90445db5826bf01d72d710fd55b208309598347ca45be618773ae026d` |
| bytes/files | 20,242,124 B / 6,744 |
| schema/ABI/mode | 18 / darwin-arm64 / personal+fixture |

旧 e4e（review 首次启动通过但 reuse 未修）、ee（无773入口）、b911/651 安全基线、97 mock 全部保留，不重贴。

```sh
node tools/distribution/verify-nonempty-personal-http.mjs --install <target> --json          # 12 步（含 reuse/refusal 矩阵）
node tools/distribution/verify-real-business-relocation.mjs --install <target> --business <B-state> --json # 4/4
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>       # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                  # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json               # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json           # 4/4
node tools/distribution/verify-source-confirmation-http.mjs --install <target> --json       # 5/5
node tools/distribution/verify-same-schema18-upgrade.mjs --from <ee/e4e/651> --to <target> --json # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json               # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                       # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json           # 8/8
node tools/distribution/smoke.mjs --keep-root <new>                                         # 52/52
```

## 选择复用断言（实际健康/进程）

- 包内 `pa review-restored --state <restored> --project <id> --allow-path . --out <new0600>` 由 main signer 同包生成；prepare 与 startup consumer 都记录本包来源。
- 未绑定 fixture daemon + 新 review file：`restored_review_selection_mismatch`，旧 PID 不变。
- same valid selection：`REUSED`，不重签/不刷新窗口。
- different valid（窄 Scope）/no file：`restored_review_selection_mismatch`，old PID 保留。
- same selection 变 port/login：`instance_conflict`，old PID 保留；fixture/normal 不能借 selection 升级。
- 新启动 health 必须 personal+recovery_readonly 且 `restoredReviewDigest` 等于本次规范化文件摘要，否则停止自有错误实例。

## 行为/格式

未绑定候选403；显式 review 后候选2×200、history/source200、业务422、model/native0；B 真实 Work/Broker/Q&A/native_applied 搬根/source 通过。workflow-evidence 默认/1 13 families、显式2 21 families；personal-evidence/bundle 独立协议（实际 formatVersion2+formatVersion1）。

## 限制

同 Store 合并（B 真实业务 + SDK candidate）未做到，分 scope 报告；A v2、private startup permission/target、跨平台/ABI、真实计费、逐步 SIGKILL 未测；97 不 live；十二服务不动。
