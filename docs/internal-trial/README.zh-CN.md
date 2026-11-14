# 内部试用操作手册（同事版）

本手册只覆盖**只读预检、诊断和有限观察**。安装、升级、启动、停止、迁移仍走产品自己的 `pa` 入口和已准入流程；本工具不会替你做这些动作。

## 0. 开始前

准备三样东西，全部由你显式提供：

1. 一个包：发布清单里给出的 `*.tar.gz`，或已经展开的安装目录；
2. 一个**全新**输出目录（工具会创建为 0700，拒绝覆盖）；
3. 需要看 readiness 时：你自己实例的 loopback 地址，以及你自己的 0600 token 文件。

不要指向你正在使用的默认数据根，不要让工具去“找”实例、端口、socket 或 `~/.codex`。工具不会这么做，也不需要。

## 1. 先核对包身份

从发布清单抄下 `tar SHA-256`、`bytes`、`buildId`、`schema`、`source commit`。预检会重新计算并核对，提供 `--artifact` 时还会核对 closure digest、install/release manifest 摘要。

目录名和 tag 不是身份。两个 `waveXX-target-*` 目录里放错包，预检会拒绝。

## 2. 只读预检

```bash
node tools/trial-kit/bin/trial-preflight.mjs \
  --tar <你的包.tar.gz> --artifact <同目录 install-artifact.json> \
  --expect-sha256 <hex> --expect-build <buildId> --expect-schema <n> --expect-source <40hex> \
  --out <全新目录>
```

看三处即可：

- `preflight: OK|DEGRADED|REFUSED`；
- `checks: PASS=… FAIL=…`，FAIL 的 id 就是拒绝原因；
- report 里的 `refused` / `unknowns`。

`DEGRADED` 常见于“本机 SQLite 版本尚未在预检阶段验证”（`host_sqlite` UNKNOWN）或平台/ABI 未测量；它不是完整性失败。任何 `FAIL` 都是拒绝，不要绕过。

## 3. 机器检查与 readiness

当前 main 工作台（a302ddc）已在默认主对话旁提供“试用准备”导航：只有认证 ready 且你打开该视图时才读取一次 readiness，四个按钮分别打开原模型设置、原项目导入、原执行器目录和原主对话。它们不是新的派工/授权入口；配置、派工、问题和接受仍走原命令。

readiness 只报告配置事实；缺包身份时报告 `package_binding: unknown`。包内命令只在完整性通过后执行；`REFUSED` 不会运行 `help/status/doctor`。


```bash
node tools/trial-kit/bin/trial-machinecheck.mjs \
  --tar <你的包.tar.gz> --artifact <install-artifact.json> \
  --expect-sha256 <hex> --expect-build <buildId> --expect-schema <n> --expect-source <40hex> \
  --out <全新目录>
```

它会在本次新根里只读运行包内 `pa help`、`pa status --json`、`pa doctor --json`，并生成：

- `machinecheck-report.json`：逐项检查；
- `diagnostics-bundle.json`：脱敏后的诊断材料；
- `reproduce.txt`：最短复现命令。

包内 `doctor` 的 `release_manifest`、`console_assets`、`runtime_dependencies`、`source_identity`、`runtime_abi` 必须 PASS；`instance/state/ports/executor/review_executor` 在空根下是预期 WARN，不是失败。

若你确实有正在运行的**自己**实例，可追加：

```bash
--readiness http://127.0.0.1:<api-port> --token-file <你的 0600 token>
```

readiness 只代表配置事实：它不含包身份（报告会写 `package_binding: unknown`），也不是执行许可。需要防陈旧/防串包时加 `--expect-configuration-revision <hex>` 与 `--max-observation-age-seconds <n>`。

## 4. 收集问题

- 先看 `machinecheck-report.json` 的 `refused` 与 `unknowns`；
- 把 `diagnostics-bundle.json`、`reproduce.txt` 和**原始命令/exit code**一起发给维护者；
- 不要手工粘贴 token、对话正文、个人绝对路径；诊断包已脱敏，仍请快速扫一眼；
- `pa support` 不会自动运行，因为它会在有数据库时以可写 pragma 打开数据库。请在自己的副本上运行后，用 `--support <file>` 引用；或让工具在“空的自有新根”上采集。

## 4b. 合法恢复输入（给 B/main）

`tests/operational-soak/recovery/` 提供合法零模型输入包：真实 Work/Attempt/Question/Answer/native_applied、原 producer 生成的 journal、原公共 reader 和已准入 recovery port 的正例/故障。它**不包含**业务 attach/begin/deliver/answer 与 SIGKILL 恢复，`businessResume` 明确 `NOT_REACHED`。详见该目录 `README.zh-CN.md`。

## 5. 有限运行观察

```bash
node tools/trial-kit/bin/trial-soak.mjs --scenario mixed --duration-seconds 600 \
  --poll-ms 1000 --sse-interval-ms 1000 --reopen-seconds 60 --sample-ms 2000 \
  --out <全新目录>
```

输出 `run.json`（实际开始/结束/elapsed、请求数、延迟、重连、重开、失败、unknown、cleanup）与 `samples.ndjson`（资源时间序列）。`resume.txt` 给出续跑命令。

这只是**一次有限 fixture 场景**：不是 24/48 小时稳定性证明，也不代表 daemon 恢复、provider/队列稳定或真实模型/native。

## 6. 交给验收

H 的材料是原始观测。E 会按自己的 required 断言独立核验；不要把本手册的 `OK`/`DEGRADED` 当作发布结论。材料目录保持只读引用，不要覆盖历史运行。
