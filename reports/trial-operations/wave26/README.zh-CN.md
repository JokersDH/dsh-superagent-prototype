# H wave-26：硬化只读工具、准确包诊断与合法恢复输入

2026-11-14，`codex/g4-trial-operations`，合并 `origin/main 6787bd0`。本目录是 wave-26 原始材料；wave-25 的 20/20、真实 600/1800 秒与 301/601 样本、392 次预期断流原样保留在 `../wave25/`，没有重跑或被“修绿”。

H 不是 release authority，也不签安装/执行/授权结论；E 仍独立 required。F/G 得到去敏、标明 fixture/产品 scope 的输入。

## 四个结果

| 结果 | 内容 | 位置 |
| --- | --- | --- |
| H4 | REFUSED 零执行、token 严格、成熟 semver、独立 raw checker | `tools/trial-kit/`、`tests/operational-soak/hardening.case.mjs` |
| H8 | a826 与 F App 后继 ce64fc1 的只读预检/诊断正负 | 本目录 `preflight-a826/`、`machinecheck-a826/`、`machinecheck-ce64fc1/` |
| H12 | 合法零模型恢复输入包（原 ProductRuntime/journal/Store/recovery port） | `tests/operational-soak/recovery/`、本目录 `recovery-a826-input/` |
| H16 | 短时新风险观察、原始材料、同事指南与状态 | 本目录 `runs/`、`docs/internal-trial/`、`../wave26-status.json` |

测试（本机实跑，2026-11-14）：

```text
node --test tests/operational-soak/*.case.mjs tests/operational-soak/recovery/*.case.mjs
tests 27 / pass 27 / fail 0
```

## H4：四个实测缺口已关闭

- **REFUSED 零包执行**：`hardening.case.mjs` 用 fixture `bin/pa` 的调用日志证明 bad-hash/missing-file/extra-file/bad-json/expectation mismatch 五类 REFUSED 下包命令调用数为 `0`，`package_cli.skipped` 为 UNKNOWN，support 不采集；合法包仍只有 `help/status --json/doctor --json` 三条。
- **token 描述符校验**：symlink、hardlink（nlink=2）、0640、FIFO、目录分别得到 `token_symlink/token_hardlink/token_permissions/token_not_regular`；合法 0600 单链接文件通过且 token 不出现在 report/diagnostics。
- **成熟 semver**：`>=24.21.0 <25` 对 24.21.0 PASS、24.20.9/25.0.0/26.1.0 WARN；`>=23 <24` 对 24.21.0 WARN（旧缺陷已关）；`^`/`~`/`||`/`*`/空 range 为 UNKNOWN。
- **raw checker v2**：独立从 `startedAt/endedAt`、单调 `elapsedMs`、逐条 `sample.at` 推导时长；600 秒摘要但起止 0 ms、样本早停、乱序、失败合计不符、symlink 样本、越界样本路径均拒绝。既有 600/1800 原样复核 `CONSISTENT`（301/601 样本、600006/1800030 ms）。

## H8：准确当前包

### a826（wave26 指定包）

- tar：`~/Desktop/joker/pa-artifacts/wave25-target/wave25-target-a826b5e.tar.gz`，SHA-256 `d3e79749426c796085895abc73d76c4b26cd48427d8e6f748155bec00a103f3c`，`20251483` bytes
- tuple：build `fefd93219cea0d4a`，schema `18`，source `a826b5e7c8843c28a527567ac33955ff061f85dc`
- 观测：closure `2a3e54d6adb71d01c8e56e4d5847ad69b7e6ed755f91355dc4147eb0cf5d5eea`，`6733` regular + `21` internal links = `6754`；预检 32 PASS / 1 UNKNOWN（host_sqlite）/ 0 FAIL
- machinecheck：49 项，46 PASS / 3 UNKNOWN / 0 FAIL；`help=0`、`status=2 STOPPED`、`doctor=1 DEGRADED`，doctor 的 release/console/runtime deps/source/ABI 全 PASS；本次新根无 state 写入；readiness fixture 的 schema/authorization/期望 subject 全 PASS，`package_binding` 保持 UNKNOWN

### ce64fc1（含本轮 F App 的 main 后继）

- tar SHA-256 `8c36aaeb472263bbb7c6ab5e4dafb3e9394306c83b3b6e1ab257d8770480c33a`，`20272436` bytes；build `d4b1780d999a4b74`，schema `18`，source `ce64fc1fd986bde9a6eba5ace1a4658beadcda21`
- closure `f8b00750fecf3c21dcacf475e59bdb965ae162ce557f8d950b89c7548372e862`，6754 项；console 资产含“试用准备”/`trial-readiness`；machinecheck 同样 46 PASS / 3 UNKNOWN / 0 FAIL
- 两个包都只作为只读输入；E 尚未对 a826/ce64fc1 给最终 installed 结论

材料哈希：

| 文件 | sha256 |
| --- | --- |
| `preflight-a826/preflight-report.json` | `565653a1460520ea424d1045c9ade92f1e4472cbe36fae9d3b3c4ae92e7f72fd` |
| `machinecheck-a826/machinecheck-report.json` | `07e8896523518ffa8e7d4688b991373ac4e406e4a883b4e2e90cc43cc871f5c2` |
| `machinecheck-ce64fc1/machinecheck-report.json` | `80540d93e91c6095255c89c3804a8e303bbc1cd6e735ad37187d0301b72868ad` |

## H12：合法零模型恢复输入

入口：`tests/operational-soak/recovery/produce.mjs --out <新目录>`，复核：`read.mjs --run <目录>`；详见该目录 README。

本次证据 subject：

- `workId 94012e1a1c7265c033f285a944656a04`，attempt `attempt-…`（完整 tuple 在 `normal.json`），question `a4e2d78e46ab29eab0af67cd93add9ba`，answer `0c4da78469ec2ca5857439d4cfb1837a`，delivery `native_applied`
- journal：5 条合法事实（turn.ended/answer.observed/candidate.observed/runtime.exited/usage.observed），lastSeq 5，sha256 `3430d28c77ce189e9a2ae756a62b710150aff8554309292805a6717ab65609cd`；7/7 负例按预期拒绝（0 send/0 execute）
- recovery port：inspect `serving` → cancel `terminated`；故障 `auth_failed/identity_mismatch/identity_mismatch/timeout/stale_proof` 全部按预期
- 读者检查：work/question/answer receipt/native_applied/journal/foreign-source 全通过；`modelCalls=0`、`vendorTurns=0`、`executor=controlled_fixture`
- **业务重连/attach/begin/deliver/answer、SIGKILL、原 Work 人工接受、2/4 资源：NOT_REACHED**，未模拟、未接管 B

材料哈希：`recovery-a826-input/report.json` `9d086017a0ed6dfd1eda83a39cf488529b296f8686a87c2303852a6cb28970a1`；`journal.json` `0a6ccf9c940f45961e28ee506e504a2e6307923ca626dc89bd932ee07425decb`；`recovery-port.json` `4419069326f9ce1eaeb0fe7e7f75aefc9c7f048558a80382170455e47572623c`；`read.json` `90d1548bbb04547b7ac5597da5965e958bb9bf9e57e948c7e87ef09f392eac35`。

## H13/H14：短时新风险观察

只新增两个短 fixture 场景，不重跑 40 分钟：

| 场景 | 实际 | 结果 | 计数 |
| --- | --- | --- | --- |
| 60 s mixed normal | 60.005 s | `COMPLETED` | poll 61/61 ok，SSE 60 事件/2 连接/1 重连/1 重开，0 失败，socket 0 |
| 30 s mixed truncate | 30.008 s | `COMPLETED_WITH_OBSERVED_DEFECT` | poll 62/62 ok，SSE 51 事件/27 连接/26 重连，24 次预期断流，socket 0 |

两者 `trial-verify-run` 均 `CONSISTENT`；`run.json` sha256 分别为 `8aba3c95f4f0d8682a7a23b4cb69c8ebfd5195435790f28b5bd2a70854c93e7b`、`931cbac0c0b85319a9bf1b82478d7375c05c8358daa05f8d21b4dd7c3751246b`。

**真实产品 readonly/SSE 观察：NOT_REACHED。** 本轮没有由操作者显式提供、独立证明自有的产品目标；H 不启动/停止/迁移，也不读取用户十二服务或凭据补样。产品 readiness 消费路径已由同一严格 client + 测试覆盖，真实目标留给有显式自有实例时执行。

## 给 F / G / E

- **F**：当前 App 已有“试用准备”导航与四个原动作；用户可见流程见 `docs/internal-trial/README.zh-CN.md`。错误以 `REFUSED <code>: <message>` 呈现；不要要求用户理解内部模块名。
- **G**：`run.json` 的 `scenario/config/counters/latency/failures/cleanup/consistency` 与 `samples.ndjson` 是 fixture layer；不包含产品层或用户工时。恢复包只给 IDs/facts，不是效率指标。
- **E**：原始材料按文件 sha256 可核；`machinecheck`/`read`/`run-check` 的通过不是 required 断言。H 不签 release、install、native 或授权。

## 限制

- fixture/readonly 与同进程 recovery port；不是产品 daemon、业务恢复或 24/48 h soak；
- 恢复输入的 journal/port 观察不授予执行或恢复权限；未知保持 unknown；
- `host_sqlite` 在预检阶段仍 UNKNOWN（需包内原生绑定）；跨机器/ABI 未测；
- 全程自动 vendor/model/native 调用 0；无新 Driver/CAC/桌面/autoaccept/动态 DAG。
