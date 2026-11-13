# 第二十三轮 E 独立验收：安全清理、同 Store 双版本与准确后继

E 独立执行；不构成私有启动许可、target/native/真实供应商证明。

## 1) 保留的 595 准确输入（不重贴）

source `595b3f1` / build `cc16eca05e4da244` / sha `e875b9b90445db5826bf01d72d710fd55b208309598347ca45be618773ae026d` / 20,242,124 B / 6,744。REUSED 仍是成功终态；旧 e4e FAIL 不贴 595。

## 2) a9b（字节已验，无 E 最终结论）

source `a9b155c` / build `9fdc283f55927f6f` / sha `413dee2fb2692334a519899fc9298fd0771b5c865a34a595d1efc3b4b3b1d650` / 20,246,850 B / 6,747。保留 immutable，不与本轮后继混贴。

## 3) 本轮准确后继

| 项 | 值 |
| --- | --- |
| source | `0ede11d` clean |
| buildId | `1eb8733c8b1729bc` |
| tar | `pa-artifacts/wave23-target/wave23-target-0ede11d.tar.gz` |
| sha256 | `d039889767cb63902ed5e00d02547c441aa2313ce79555d90747e9a0b1fabf21` |
| bytes/files | 20,247,278 B / 6,747 |
| env | Node 24.21.0 / ABI137 / SQLite3.53.4 / darwin-arm64 / schema18 |

```sh
node tools/distribution/verify-live-cleanup-controls.mjs --json                  # 6/6 pure controls
node tools/distribution/verify-same-store-dual-personal.mjs --install <target> --business <retained-B-state> --json # 3/3
node tools/distribution/verify-same-store-dual-personal.mjs ... --fault after-seed-start --json # 注入故障，期望FAIL且CLEAN
node tools/distribution/verify-same-store-dual-personal.mjs ... --fault after-review-start --json
node tools/distribution/verify-same-store-dual-personal.mjs ... --fault candidate-read-fail --json
node tools/distribution/verify-same-store-dual-personal.mjs ... --fault assert-fail --json
node tools/distribution/verify-nonempty-personal-http.mjs --install <target> --json # 12步
node tools/distribution/verify-real-business-relocation.mjs --install <target> --business <B-state> --json # 4/4
node tools/distribution/verify-cli-help.mjs --install <target> --json            # 1/1
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target> # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json # 4/4
node tools/distribution/verify-source-confirmation-http.mjs --install <target> --json # 5/5
node tools/distribution/verify-same-schema18-upgrade.mjs --from <ee> --to <target> --json # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json # 5+1NT
node tools/distribution/verify-dual-binary.mjs --json # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json # 8/8
node tools/distribution/smoke.mjs --keep-root <new> # 52/52
```

## 4) 断言要点

- 清理工具：positive owned、foreign root、start mismatch、missing record、cleanup failure、repeated finally 六控制。故障注入在 seed/review 启动、候选读取、断言处均返回 FAIL 且资源 CLEAN；UNKNOWN 时保留受限 root，不删状态。
- 同 Store：真实 Work 1、question 1、answer 1、attempt 1、native_applied 1 与 SDK candidates 2；原 IDs/digests 在第二 root 全保留；v1/v2 snapshot create/verify 后，恢复数据库 sha 等于两版本快照数据库 sha；候选2、history/source200、业务422、provider fake 请求1不增；`scopeReview=1` 实际返回 `context-scope-review/1`。
- 帮助：`pa --help`、`pa help review-restored`、`pa review-restored --help` 均0退出且不创建 state/config/进程；重复 `--project` 与实际参数一致。
- 包内 prepare/start 同源；REUSED 成功；不同/缺失/未绑定/端口登录拒绝保留 PID；fixture 不能升级。
- E 应把外部真实 A/C driver 缺失列为 NOT_TESTED，不能把本轮 main HTTP 消费冒充 A/C 独立 driver。

## 5) 限制

A/C 独立参数化 driver 未在包内；A v2、private startup permission/target、真实外部供应商、跨平台/ABI、逐步 SIGKILL、长期 soak 未测；97 仅 mock；十二服务与旧 tar/state 不动。
