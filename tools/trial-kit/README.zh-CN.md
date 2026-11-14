# trial-kit：内部试用只读预检与有界运行

2026-11-14，wave-25 H 交付。三个命令都只做**只读观察**或**本进程 fixture 场景**；它们不安装、不启动、不停止、不升级、不迁移任何个人实例，也不读取其他 home 凭据。报告是原始材料，不是发布、执行或授权结论。

## 命令

```bash
# 1) 只读预检：一个 tar 或一个已展开安装目录，输出到全新目录
node tools/trial-kit/bin/trial-preflight.mjs \
  --tar ~/pa-artifacts/wave24-target/wave24-target-3b2ff68.tar.gz \
  --artifact ~/pa-artifacts/wave24-target/install-artifact.json \
  --expect-sha256 f04abb1b... --expect-build 470738fd33b22ff4 --expect-schema 18 \
  --out /tmp/trial-preflight-3b

# 2) 包机器检查 + 只读 readiness + 脱敏诊断包
node tools/trial-kit/bin/trial-machinecheck.mjs \
  --tar ~/pa-artifacts/wave24-target/wave24-target-3b2ff68.tar.gz \
  --artifact ~/pa-artifacts/wave24-target/install-artifact.json \
  --expect-sha256 f04abb1b... --expect-build 470738fd33b22ff4 --expect-schema 18 \
  --out /tmp/trial-machinecheck-3b

# 2b) 另有真实实例时：显式 loopback 地址 + 你自己的 0600 token 文件
node tools/trial-kit/bin/trial-machinecheck.mjs --install <安装目录> \
  --readiness http://127.0.0.1:<api-port> --token-file <0600-token> --out /tmp/trial-mc-live

# 3) 从原始材料复核一次运行（不信任摘要）
node tools/trial-kit/bin/trial-verify-run.mjs --run reports/trial-operations/wave25/runs/<run> --out <新目录>

# 4) 单次有限运行场景（fixture only；600/1800 秒为本包实际使用上限）
node tools/trial-kit/bin/trial-soak.mjs --scenario mixed --duration-seconds 600 \
  --poll-ms 1000 --sse-interval-ms 1000 --reopen-seconds 60 --sample-ms 2000 \
  --out reports/trial-operations/wave25/runs/<new-run>
```

退出码：`0` 完整通过/场景按预期结束，`1` DEGRADED（未测量的兼容性、未绑定或场景内失败），`2` REFUSED（输入/完整性/凭据/参数拒绝），`3` INTERNAL。

## 预检实际核对什么

- tar/安装目录中的 `install.json`（`pa-install/1`）与 `var/config/release.json`（`pa-release/1`）作为唯一身份来源；目录名、tag 和“看起来相近”的版本都不算身份；
- 每个记录文件的字节数与 SHA-256、symlink 目标与内部闭包、禁止出现的凭据/运行时材料、未声明文件；
- 重新计算 closure digest，并与 `install-artifact.json` 的 tar/closure/manifest 摘要、buildId、schema、source 对比（提供 `--artifact` 时）；
- entrypoints、`bin/pa`、外部依赖版本与 license、workspace 包名、console stamp 与 release artifacts；
- 主机 platform/arch/Node/ABI、support matrix、磁盘余量与路径长度；SQLite 版本在预检阶段是 `UNKNOWN`，因为需要执行原生绑定——由包内 `pa doctor` 在机器检查中验证；
- 输入不可变性：预检结束后重新校验 tar 摘要或安装目录的 size/mtime，证明没有修改被检查对象。

归档只通过平台 `tar`（libarchive）列出/展开；成员路径在展开前拒绝绝对路径、`..`、重复项与超长路径，展开只发生在本命令新建的 `--out/extract`，默认校验后删除。没有自造 archive parser。

## 机器检查实际调用什么

包内只调用已核清只读语义的三个命令：`pa help`、`pa status --json`、`pa doctor --json`。全部指向本次新根（`--out/roots/*`），release manifest 从包里**复制**到本次 config 根，执行器探测重定向到本地 fixture 脚本与空 `CODEX_HOME`，因此不调用真实 Codex CLI、不读取 `~/.codex`。`pa doctor` 会对 5190/8790 做一次瞬时端口可用性探测，不会停止任何进程。

`pa support` **不会自动执行**：当 data 根存在 `state.sqlite` 时它会以可写 pragma 打开数据库。需要时请你自己在副本上运行，再用 `--support <file>` 引用；或使用 `--run-support`，它只在本命令新建且尚无数据库的根上执行。`--readiness-fixture` 用本进程已知 fixture 做可复现正向；真实 readiness 必须由你显式给出 loopback 地址与自己的 token。

## 输出与隐私

- `--out` 必须是全新目录（0700）；报告 0600、`O_EXCL`，第二次运行拒绝覆盖；
- 报告中的 home 前缀替换为 `~`，token/secret 值不写入材料；若脱敏后仍发现 token，命令拒绝落盘；
- readiness 请求：仅 loopback 字面地址、单次 GET、无 query、无重定向、5 秒 deadline、256 KiB 上限；响应必须通过已发布的严格 `trial-readiness/1` schema（未知字段、缺字段、`authorization != none` 都拒绝）；
- readiness 本身不含包身份，因此 `package_binding` 明确为 `unknown`；需要绑定时传 `--expect-configuration-revision` 与 `--max-observation-age-seconds`。

## 测试

```bash
node --test tests/operational-soak/preflight.case.mjs
node --test tests/operational-soak/machinecheck.case.mjs
node --test tests/operational-soak/soak.case.mjs
```

覆盖：完整 tiny fixture 正负、错 hash/缺文件/多余文件/外部 symlink/坏 JSON/缺依赖/错 console stamp、绝对与 `..` 成员、截断 tar、ABI 不一致的 DEGRADED、输入与 home 无副作用、输出 0600/0700 与拒绝覆盖、含空格/中文路径、readiness 401/500/坏 JSON/超大/未知字段/过期/跨 subject/deadline、token 权限、support 白名单与空根采集、soak 正向/仅 HTTP/仅 SSE/七类有界缺陷/中断/参数与覆盖拒绝。

## 明确不声称

- 不把本机检查当作跨机器兼容证明；`supportMatrix.notTested` 保持原样；
- 不把 fixture 场景当作 24 h/48 h soak、daemon 恢复、provider/队列稳定性或发布证明；
- 不把 readiness 的配置事实当作执行许可、private grant 或 target 激活；
- 不授予安装、启动、停止、升级、迁移或私有授权；这些只走 D/main 已准入入口。
