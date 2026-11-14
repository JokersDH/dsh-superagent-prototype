# H 内部试用工具与原始观察（wave-25）

2026-11-14，分支 `codex/g4-trial-operations`，基线 `origin/main 11002b8`（main 实际 readiness `fdb3f16`）。本目录只放原始材料与索引；工具源码在 `tools/trial-kit/`，测试在 `tests/operational-soak/`，同事指南在 `docs/internal-trial/`。

H 不是第二 registry、ledger、健康权威或发布 gate。原始观察交给 E 独立断言；本目录的任何 `OK/DEGRADED` 都不是安装、执行、授权或发布结论。

## 实际交付

| 结果 | 内容 | 位置 |
| --- | --- | --- |
| M1 | 只读预检 CLI（tar / install / tuple 绑定 / 输入不可变证明） | `tools/trial-kit/bin/trial-preflight.mjs` |
| M2 | 包机器检查 + 只读 readiness + 脱敏诊断包 + 最短复现 | `tools/trial-kit/bin/trial-machinecheck.mjs` |
| M3 | 有界 HTTP/SSE/重连/客户端重开/资源采样 harness | `tools/trial-kit/bin/trial-soak.mjs` |
| M4 | 600 s 与 1800 s 实际场景、原始样本、续跑命令、同事指南 | 本文件与 `docs/internal-trial/` |

测试（本机实跑）：

```text
node --test tests/operational-soak/*.case.mjs
tests 19 / pass 19 / fail 0
```

预检 9 项、机器检查 5 项、soak 5 项；覆盖完整 tiny fixture 正负、错 hash/缺文件/多余文件/外部 symlink/坏 JSON/缺依赖/错 console stamp/绝对与 `..` 成员/截断 tar、ABI 不一致 DEGRADED、输入与 home 无副作用、0600/0700 与拒绝覆盖、空格/中文路径、readiness 401/500/坏 JSON/超大/未知字段/过期/跨 subject/deadline、token 权限、support 白名单与空根采集、soak 正向/通道隔离/七类缺陷/中断/参数拒绝。

## 不可变包只读预检证据

### 3b（wave24 当前包）

- 输入：`~/Desktop/joker/pa-artifacts/wave24-target/wave24-target-3b2ff68.tar.gz`
- subject：tar SHA-256 `f04abb1b4c4ae47a52f6bc1aa172d70c4a113219f443f354aee0ebffc8a00494`，`20248077` bytes
- tuple：build `470738fd33b22ff4`，schema `18`，source `3b2ff68b4785e79757fc1dcd14b17f5dd84d0c62`
- 实测：`closureDigest 25947d8284877ffbc4271599b5e93d2c699e912b18cb27dc7e088b61aeb42569`，`6727` regular + `21` internal symlink = `6748` 项，与 0065 记录一致
- machinecheck：48 项检查，45 PASS / 0 FAIL / 3 UNKNOWN（`host_sqlite` 需运行原生绑定；`support` 未请求；`readiness.package_binding` 恒为 unknown）；readiness 正向为 fixture：`http_status/schema_valid/authorization_none/observation_fresh/expected_subject` 均 PASS；包内 `help=0`、`status=2 STOPPED`、`doctor=1 DEGRADED`；doctor 的 `release_manifest/console_assets/runtime_dependencies/source_identity/runtime_abi` 全 PASS；本次新根未出现 state/database 写入
- 复核：`wave25/checks/600s-baseline/run-check.json` 与 `wave25/checks/1800s-churn/run-check.json` 均由 `trial-verify-run` 从原始 samples 重新计算，结论均为 `CONSISTENT`
- 材料：`wave25/machinecheck-3b/`（`machinecheck-report.json`、`diagnostics-bundle.json`、`reproduce.txt`，均 0600）

### 0ede（wave23 保留下载）

- 输入：`~/Desktop/joker/pa-artifacts/wave23-target/wave23-target-0ede11d.tar.gz`
- subject：tar SHA-256 `d039889767cb63902ed5e00d02547c441aa2313ce79555d90747e9a0b1fabf21`，`20247278` bytes
- tuple：build `1eb8733c8b1729bc`，schema `18`，source `0ede11d0a46f377e90657c78b001357c98d4f5e7`
- 实测：`closureDigest d400dea3319d8f37db9c957f1bba345cb5accb6994112fc790c235ff5d9b9d69`，`6726` regular + `21` internal symlink = `6747` 项，与 wave23 记录一致
- 材料：`wave25/preflight-0ede/preflight-report.json`（0600）

两次预检的 `host_sqlite` 均保持 `UNKNOWN`（需执行原生绑定），没有把“相近版本”自动判为兼容；`supportMatrix.notTested` 原样保留。

## M4 实际运行结果

两个场景分别执行、分别报告，不能互相补样。均为 fixture/readonly：本进程 127.0.0.1 临时端口，不启动 daemon、不碰个人 state、不调用模型/native。

### 600 s baseline（已完成）

- 目录：`wave25/runs/20261114T122036-600s-mixed-baseline/`
- 参数：`mixed`，600 s，poll 1 s / deadline 500 ms，SSE 事件 1 s，重连退避 250 ms，客户端重开 60 s，采样 2 s，`--failure-mode none`
- 实际：`startedAt 2026-11-14T04:20:36Z`，`endedAt 2026-11-14T04:30:36Z`，`wallElapsedSeconds 600`，`stoppedBy duration`，status `COMPLETED`
- 计数：readiness 608 次全部 200（p50 1.31 ms / p95 2.14 ms / max 4.73 ms）；SSE 600 事件、10 连接、9 重连、9 客户端重开、0 duplicate、0 gap；301 个资源样本；0 失败
- 收尾：fixture socket `0`、active connection `0`
- 样本：`run.json` 3520 bytes（sha256 `f2f20b6531219fb904ab20b10ab884ffef45af10e1a80d232187e016124cb3fb`），`samples.ndjson` 82669 bytes（sha256 `80d5b0f5181c8c0b70047916f317a625ac747dc1f5d4df9f55b7ae93a0095957`），`resume.txt`

### 1800 s churn（已完成）

- 目录：`wave25/runs/20261114T123153-1800s-mixed-churn/`
- 参数：`mixed`，1800 s，poll 3 s / deadline 1 s，SSE 事件 2 s，重连退避 500 ms，客户端重开 180 s，采样 3 s，`--failure-mode truncate`（fixture 每 3 个事件主动断开，观察有界重连）
- 实际：`startedAt 2026-11-14T04:31:53Z`，`endedAt 2026-11-14T05:01:53Z`，`wallElapsedSeconds 1800`，`stoppedBy duration`，status `COMPLETED_WITH_OBSERVED_DEFECT`
- 计数：readiness 609 次全部 200（p50 0.78 ms / p95 1.87 ms / max 6.07 ms）；SSE 800 事件、400 连接、399 重连、9 客户端重开、0 duplicate、0 gap；601 个资源样本
- 失败：392 次，全部是 `sse:disconnect:error`，即主动断流策略本身；`defectObserved true`。这是负向断流控制，不代表产品故障
- 收尾：fixture socket `0`、active connection `0`；`trial-verify-run` 复核 `CONSISTENT`（samples 601 行，last elapsed 1800009 ms，摘要匹配）
- 样本：`run.json` 23245 bytes（sha256 `e2dfc1e633a525359ff5079c91cde1dbc6e47baf94a48522e75804a2aae2f82d`），`samples.ndjson` 167476 bytes（sha256 `ca89577009a34897d0f7134838d4417c05f65007d822ea0ee778cebe5cefb95c`），`resume.txt`；复核材料 `wave25/checks/1800s-churn/run-check.json`

## 给 F / G / E 的明确输入

- **F（体验）**：用户上手只需 `docs/internal-trial/README.zh-CN.md` 的 0–5 步与 `reproduce.txt`；错误信息以 `REFUSED <code>: <message>` 呈现，常见 code 见 `docs/internal-trial/preflight.zh-CN.md`。F 不需要 tar 路径规则或内部模块名；工具不替 F 写 UI。
- **G（效率观测）**：`run.json` 提供结构化 `startedAt/endedAt/wallElapsedSeconds/requestedDurationSeconds/stoppedBy/counters/latencyMs/failures/unknowns/consistency`；`samples.ndjson` 是逐样本时间序列。样本只覆盖 fixture 场景，不是用户工时或产品费用；未知保持 null/unknown。
- **E（独立断言）**：原始材料在 `wave25/machinecheck-3b/`、`wave25/preflight-0ede/`、`wave25/runs/*/`；每个文件 0600 且可用 sha256 复核。E 的 required 断言仍由 E 独立执行；H 的 PASS/DEGRADED 不作为 release/install/native 准入。

## 未到依赖与 owner 需求

- 真实 readiness 需要操作者自己的实例地址与 token；H 不读取其他凭据，因此本目录只给 fixture 正向与真实端点客户端（同一严格 schema）。
- readiness 不含包 build/source，`package_binding` 只能 `unknown`；若 main 后续增加包身份字段，需要新的 schema 与 H 端消费更新，H 不猜字段。
- D 的新包（3b 后继）与 main 新 readiness 一旦发布，用同一命令换 tuple 即可复跑；本目录不把 3b 结论贴到后继包。
- F/G/E 的实际结果未在本工作树内；H 只提供原始观测与明确限制，不替他们下结论。

## 明确限制

- 单次有限 fixture 场景，不是 24 h / 48 h soak、长期稳定性或内存无泄漏证明；
- 客户端重开是新的 HTTP/SSE 连接，**不是** daemon 进程恢复；不含 provider/队列/旧完成请求的可观测性；
- 资源样本只覆盖本进程与 fixture server，不读取其他用户进程，也不做 global 扫描；
- readiness 只报告配置事实；本目录的 readiness 正向使用本进程 fixture（报告标 `(fixture)`），真实实例必须由操作者显式提供 loopback 地址和自己的 0600 token；
- 预检/机器检查只证明本机包字节、闭包与包内命令观察；不证明跨机器兼容，也不授权安装/启动/停止/升级/迁移/私有 target；
- 不读取或复制其他 home 凭据、旧 native session 或旧授权。

## 复跑

```bash
# 预检
node tools/trial-kit/bin/trial-preflight.mjs --tar <tar> --artifact <artifact.json> \
  --expect-sha256 <hex> --expect-build <id> --expect-schema <n> --expect-source <40hex> --out <new-dir>
# 机器检查（可复现 fixture readiness）
node tools/trial-kit/bin/trial-machinecheck.mjs --tar <tar> --artifact <artifact.json> --readiness-fixture --out <new-dir>
# 600 s / 1800 s（参数见 docs/internal-trial/soak.zh-CN.md）
node tools/trial-kit/bin/trial-soak.mjs --scenario mixed --duration-seconds 600 ... --out <new-dir>
```
