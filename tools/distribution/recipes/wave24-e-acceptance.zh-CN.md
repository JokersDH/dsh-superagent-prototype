# 第二十四轮 E 独立验收：出生登记、精确清理、最新 UI 与同包

E 独立执行；不构成私有启动许可、target/native/真实供应商或 release 证明。

## 1) 准确后继

| 项 | 值 |
| --- | --- |
| source | `3b2ff68` clean；main `4b42a90` UI 已合入 |
| buildId | `470738fd33b22ff4` |
| tar | `pa-artifacts/wave24-target/wave24-target-3b2ff68.tar.gz` |
| sha256 | `f04abb1b4c4ae47a52f6bc1aa172d70c4a113219f443f354aee0ebffc8a00494` |
| bytes/files | 20,248,077 B / 6,748 |
| env | Node 24.21 / ABI137 / SQLite3.53.4 / darwin-arm64 / schema18 |

保留 595 历史、a9b 208PASS/0FAIL/15NT 普通范围和 0ede 旧包，不重贴。

## 2) 必跑

```sh
node tools/distribution/verify-live-cleanup-controls.mjs --json   # 10控制
node tools/distribution/verify-installed-ui.mjs --install <target> --json
node tools/distribution/verify-cli-help.mjs --install <target> --json
node tools/distribution/verify-same-store-dual-personal.mjs --install <target> --business <readonly-B-state> --json
node tools/distribution/verify-independent-snapshot-restores.mjs --install <target> --business <readonly-B-state> --json
... --fault before-record|after-record-before-health|after-seed-start|after-review-start|after-review-record-before-health|candidate-read-fail|assert-fail|before-reopen-record|after-reopen-record-before-health
node tools/distribution/verify-nonempty-personal-http.mjs --install <target> --json
node tools/distribution/verify-real-business-relocation.mjs --install <target> --business <B-state> --json
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>
node tools/distribution/verify-multi-instance.mjs --install <target> --json
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json
node tools/distribution/verify-personal-install.mjs --install <target> --json
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json
node tools/distribution/verify-backup-schema16.mjs --install <target> --json
node tools/distribution/smoke.mjs --keep-root <new>
```

## 3) 断言

- 出生记录在 `waitHealth` 前建立；spawn-before-record 故障必须产生非空 UNKNOWN、停止已证明的 spawn group、保留私有根，不能空列表删活根。
- 每个 launcher/API/child 有独立 start/UID/role/argv/root/config/operation；child-start 不符、sibling root、wrong operation、PID复用、缺记录均拒绝；每次直接信号前 fresh 全身份重读；未知保留 material。
- 九故障窗口：before-record、record-before-health、seed/review 启动、review record-before-health、候选读取、断言、reopen record-before-health；`after-record`/健康成功的失败应 CLEAN，`before-record` 应 UNKNOWN retained。
- 安装 UI 字节包含 `?scopeReview=1`、`withheldSourceCount`、原因列表和 `context-scope-review/1`；同 Store 实际 `scopeReview=1` 返回真实字段。
- 同 Store 原 Work/question/answer/attempt/native_applied + SDK candidates、双 snapshot create/verify、原 ID 保留。
- 独立恢复：`snapshot/1` 与 `/2` 各自 materialize→独立 bundle→包内 `pa restore` 到不同 root；各自恢复 DB sha 等于对应 snapshot manifest DB sha，原 Work/question/answer ID 保留。bundle evidence format 仍为2（routing tables 存在），这与 snapshot protocol 不同，不得混称。
- C 唯一 driver 已在 exact frozen install + kept same-Store review root 上 verified-flow（health/digest/history/source/scopeReview）；A 独立 reader 入口不在当前分支，A+C 组合仍 NOT_TESTED。
- 真实 vendor/native 0；私有 permission/target、跨平台/ABI、真实计费未测。

## 4) 限制

旧 0ede 与 a9b 证据不能认证本轮新 main UI。冻结 changed runtime bytes 后 docs-only 不重冻。
