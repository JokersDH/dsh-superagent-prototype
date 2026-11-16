# Wave-32 一页试用清单、故障树与现场保留

日期：2026-11-16。适用对象：内部同事、main/B/I/D/E 联调者。**本清单不授予安装、执行、native、恢复或发布权限。**

## 0. 先确认范围

- 本机：macOS Apple Silicon，Node 24.21.x，SQLite ABI 137。
- 只使用显式给出的准确 tar/install 和**自己的新根**；不碰 5180/8796–5191/8807 的旧实例、state、profile、tar、ledger。
- R1: `8296720` / build `8296720d8a25f38c` / tar `04926739…87543` / source `82ee5b8f…`。
- R2: `4dcd28f` / build `4dcd28f758bbb265` / tar `405ecd02…addcc6` / source `c0a1f897…`（303b2c6a 后继冻结；不是 R1 改标签）。

## 1. 六步最短流程

1. **预检**：`trial-preflight` 绑定 tar/artifact/build/schema/source；`REFUSED` 时零包内执行。
2. **现场包**：`trial-field-kit --tar … --artifact … --out <新根>`；可选 `--readiness-fixture` 与 `--source-consumer`。
3. **读结果**：先看 `support-summary.json` 的 `result/counts/knownIssues`，再看 `machinecheck/machinecheck-report.json` 与 `diagnostics-bundle.json`。
4. **包内只读**：`pa status --json`、`pa doctor --json`、`pa recovery-status --json`；只在自己的根。
5. **普通受控流程**：只按已实现 scope 使用（讨论/委托/问题/检查/人工接受）；不把 fixture 或新 Work 叫恢复旧 Work。
6. **保留现场**：整个新输出根 0600/0700、不覆盖；分享 summary + notes + raw report + 命令 exit。

## 2. 故障树（先定位，不猜）

| 现象 | 先看 | 处理 |
| --- | --- | --- |
| preflight `REFUSED` | `refused.code` | 不执行包命令；核对 tar sha/build/source/artifact；保留报告 |
| `DEGRADED` + `host_sqlite` UNKNOWN | `unknowns` | 让包内 doctor 在私有根运行；不把 UNKNOWN 写成 PASS |
| `DEGRADED` + `package_binding` UNKNOWN | readiness | readiness 只是配置事实；手工绑定 tuple，不推导许可 |
| `support.reference` UNKNOWN | summary | 未自动运行 `pa support`；在副本上运行后 `--support` 引用 |
| doctor `FAIL` | `doctor.checks` | 先停止使用该包；保留 stdout/stderr/exit；不要放宽检查 |
| doctor WARN `executor_codex` / `instance` | detail | 空根/缺执行器的预期提示；不是授权，也不是 native 通过 |
| `pa status` exit 2 `STOPPED` | status JSON | 新根正常；不要为了“绿灯”启动 daemon |
| readiness 401/超时/redirect | `readiness.checks` | 只使用显式 127.0.0.1 与 0600 token；不放宽重定向 |
| 多根路径混用 | `roots` | 立即停止；每根独立 config/data/cache/logs/workspace |
| 资源 UNKNOWN/仍活 | 现场材料 | 保留根和 PID/start/argv 证据；不 global ps、不 substring kill、不先删 state |
| 恢复/两四槽/native | layers | 当前 NOT_REACHED/NOT_MEASURED；不要用新 Work 或 fixture registry 补证 |

## 3. 当前已知问题（准确范围）

- R1/R2 预检均有 `host_sqlite` UNKNOWN（需包内 doctor 执行 native binding）；R1/R2 machinecheck 均 46 PASS / 3 UNKNOWN / 0 FAIL。
- R2 尚无 E 同一 tar 独立最终 verdict；R1/R2 都不能由 H 观察替代 E required。
- 安装包 fixture 受控 Work 必须等到 `actions.available` 包含 `accept_candidate` 再接受；在 verifying/只看到 currentCandidate 时提前 accept 会返回 `verification_failed: Trusted artifact review is unavailable`，这是调用时机错误，不是产品拒绝。88eb 等待后 accept/delivered/重开已通过。
- 包内实际启动后的 HTTP/SSE 内容、review-restored 启动/REUSED、原 Work 恢复、native 2/4 slot、vendor/native 均未测，分层为 NOT_REACHED/NOT_MEASURED。
- 字段 `authorization` 在脱敏报告中可能被泛化为 `<redacted>`；以 `authorization_none` 检查为准，不重新解释为授权。
- 失败路径（出生不完整/ps UNKNOWN）现在**不发送任何信号**，保留 probe 与 reason；不要清理成“干净”。

## 4. 可分享 / 不可分享

可分享：`support-summary.json`、`FIELD-NOTES.md`、`manifest.json`、`machinecheck-report.json`、`diagnostics-bundle.json`、`reproduce.txt`、实际命令与 exit、脱敏后的错误码。

Wave-34: W33 f880（tar `ee45c92c…`，build `f880e5bc…`）与 88eb 分列；accept 必须等 `actions.available`，candidate 先出现不等于可接受。

不可分享：token/Authorization header、对话正文、私有数据库、用户 project 路径、native profile、其他 home 凭据。分享前仍要扫一遍 canary。

## 5. 重现

```bash
node tools/trial-kit/bin/trial-field-kit.mjs \
  --tar <exact.tar.gz> --artifact <install-artifact.json> --out <new-dir> \
  --expect-sha256 <64hex> --expect-build <buildId> --expect-schema 18 --expect-source <40hex> \
  [--readiness-fixture] [--source-consumer --i-commit <sha> --b-commit <sha>]

node tools/trial-kit/bin/trial-verify-run.mjs --run <existing-run>
```

退出码：0 OK，1 DEGRADED（未测量/未绑定），2 REFUSED（完整性/输入），3 INTERNAL。H 的 summary 不是 E verdict。
