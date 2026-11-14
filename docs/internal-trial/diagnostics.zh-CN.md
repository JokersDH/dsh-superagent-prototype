# 问题收集与脱敏诊断

目标：让维护者能复现问题，同时不把 token、对话正文、个人绝对路径和可执行旧授权带出去。

## 最小材料

1. `machinecheck-report.json`：逐项检查与 refused；
2. `diagnostics-bundle.json`：脱敏后的环境/包/命令/readiness 摘要；
3. `reproduce.txt`：最短复现命令；
4. 你自己执行过的原始命令与 exit code（终端复制即可）；
5. 发生时间与时区。

## 工具已经做了什么

- `--out` 新建 0700，报告 0600 且不覆盖；
- home 前缀替换为 `~`；
- token/secret 值不写入；写出前做一次 canary 检查，若仍发现 token 则拒绝落盘；
- support 只保留白名单字段（`protocol/generatedAt/productSchema/platform/install/release/roots/state/instance/journal/redaction`），其他字段丢弃；
- 包内命令只跑 `help/status/doctor`，执行器探测固定到本地 fixture 与空 `CODEX_HOME`；
- `diagnostics-bundle.json` 明确记录方法、limit、副作用（提取目录、doctor 的 5190/8790 瞬时端口探测、fixture 执行器）。

## `pa support` 的规则

`pa support` 在存在 `state.sqlite` 时会以可写 pragma 打开数据库，所以：

- 工具**不会自动执行**它；
- 需要时请在你自己的副本上运行：

```bash
<安装目录>/bin/pa support --out <你的新 0600 文件>
```

然后引用：

```bash
node tools/trial-kit/bin/trial-machinecheck.mjs --install <安装目录> --support <你的文件> --out <新目录>
```

- 或者在“空的自有新根”上让工具采集：`--run-support`。若 data 根已出现 `state.sqlite`，工具拒绝执行并给出手工步骤。

## 不要发送

- token、cookie、api key、私有配置内容；
- 对话/回复正文、prompt、原生会话、IPC nonce；
- 其他人的绝对路径或账号目录；
- 旧授权文件、恢复 marker 的可执行副本。

诊断包已经避免这些字段；如果你手工补充日志，请先自行脱敏。

## 失败材料也要保留

失败时工具仍会把部分材料留在 `--out`（例如 `preflight-report.json` 或 `run.json` 的 REFUSED 记录）。不要删除这些目录后再报告“没结果”；它们能说明拒绝发生在哪一步。未知资源保留事实，不要清空成空集合。
