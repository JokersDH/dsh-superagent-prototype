# Agent B 第七轮交接：统一准入与费用上界结论

日期：2026-11-11。branch `codex/g1-runtime`｜base `0df3fd1`｜merge `130cc9f`｜检查点 `dc2ac9f`｜本批提交见 §7。**全包模型调用 0 次。**

权威状态：[wave07-status.json](wave07-status.json)。上一轮交接文件（`wave06-b-real-transport-handoff.md` 等）保留不覆盖。

## 1. 单一路径（B1/B2）

E 只能走一个入口：`runtime-admission.mjs` 的 `admit(request)`。它把**会话、密封副本、宿主隔离、预算**收进 6 个独立 gate，一次调用全部评估、**不短路**。

当前结果：**REFUSED**，未满足 `budget_reservation` + `cost_bound`；其余 4 门通过。`REFUSED` 时 `launch=null`，消费者无法从被拒结果启动运行。

| gate | 状态 | 依据 |
| --- | --- | --- |
| execution_identity | OK | `codex-cli 0.164.0` + 真实可执行摘要 + platform |
| session_fact | OK | 真实服务器：model `gpt-6.1-sol`、provider `OpenAI`、ephemeral 支持 |
| material_copy | OK | 逐字节复制、无 `.git`、无共享 inode |
| host_isolation | OK | macOS Seatbelt 内核强制 |
| budget_reservation | **GAP** | grant UNVERIFIED、余量 UNKNOWN |
| cost_bound | **GAP** | 见 §3 |

**无 CLI 退路**：`call()` 拒绝 `turn/start`；唯一计费路径是 `startTurn()`，且必须带预留钩子。接口缺失/过期时只能拒绝，不能退到直连 CLI。

**B2 同一 launch 路径**：transport（JSON-RPC stdio）+ `createSealedCapsule`（只复制字节）+ `buildSeatbeltProfile`（拒网络、拒读作者 home、拒写作者项目、允许胶囊 scratch）+ 强制预留钩子。作者续会话用持久 turn-backed 线程；fresh 复核用 ephemeral 线程且不携带作者 thread id。

## 2. 副本与隔离反例关闭（B3）

wave-06 的 `B3-HARDLINK-ESCAPE` FAIL **没有改成 PASS**，而是修在对的地方：

- **OS 不需要禁止 hardlink**；生产 builder 只复制字节，并在**准入处拒绝** link-based copyMode。
- **unsafe 负对照保留**且仍然能证明危害（link builder 确实共享 inode），所以「拒绝它」不是同义反复。
- 断言强度：已知 unsafe 模式必须给出**具体 sealed-copy 理由**，因为「unknown copyMode」消息里也含 mode 名，否则会掩盖检查失效（这一点是实测发现的：第一次收紧前，禁用链接检查仍然 PASS）。

## 3. 费用上界结论（B4）：NO_SUPPORTED_BOUNDED_RECIPE

有限调查（零模型）逐项实测，见 [wave07-b4-bound-dossier.md](wave07-b4-bound-dossier.md)。

| 事实 | 取值 |
| --- | --- |
| 协议生成绑定 | 751 |
| 服务器实际接受方法 | **134**（从错误回包枚举） |
| `turn/start` token 上界字段 | **无** |
| `config/read`（35,654 字节）token 上限键 | **无** |
| `model/list`（19 字段）价格字段 | **无** |
| `config/read` 价格字段 | **无** |
| `account/usage/read`、`account/rateLimits/read` | 需 ChatGPT 认证，不可用 |
| 真实模型身份 | `gpt-6.1-sol` / `OpenAI` |

**唯一实质发现**：`thread/goal/set` 接受 `tokenBudget`，`ThreadGoalStatus` 含 `budgetLimited`/`usageLimited`，并报告 `tokensUsed`。但它是**线程 goal 的累计预算**——第一轮开始时 `tokensUsed=0`，任何正预算的预检查都会通过，而该轮没有任何请求级上限，所以**它拦不住第一轮**；pilot 每例作者 turn 正是从 0 开始的第一轮。另外 **ephemeral 线程不支持 goal**，fresh 复核臂无法使用该预算。

已明确拒绝作为整 turn 上界的：字节/4 估算、固定 padding、`Math.min` 裁小预留、墙钟 timeout、turn 后 usage、单独输出限制。

**未测（需真实发送，本包禁止）**：goal 预算是否在首轮推理前硬检查、超预算是否中止进行中的 turn、真实计费金额。

两个零模型替代 recipe 已写入 dossier（累计预算封顶 + 材料规模上限），**都不产生单 turn 硬上界**，且都需 main 版本化测量设计。「价格修好」不自动解除 `runtime_bound_unavailable`。

## 4. 控制/恢复不回退（B5）

在 `0df3fd1` 基线上重跑，全部保持：

| 套件 | 结果 |
| --- | --- |
| B3 生产停止 | 6/6 |
| B4 恢复窗口 | 3 PASS + 1 **NOT_TESTED**（question 窗口未出现） |
| false-pass 镜像 | 6/6 |
| budget | 10/10 |
| selftest | 14/14 |
| 单元套件 | 41/41（ledger-audit 12、pilot-runner 19、cost-preflight 10） |

**账本不刷新（B5 关键项）**：重跑 `ledger-reconstruct --write` 后 grant 仍为 `UNVERIFIED`、`maySendReal=false`，**空账不会变成 4 次余量**。

**单一恢复实现**：`packages/execution/src/recovery-transport.ts` 仍是唯一 proof WeakMap，protocol-v1 未改。

**实际原生控制仍 NOT_TESTED**：真实 vendor 停止/提问/steer/未知发送未测；B 不动用 E 的 pilot 额度去补 B 的付费测试，且新 state 不代表旧 writer 已停。

## 5. 预算账

| grant | limit | 状态 | 余量 | 可花 |
| --- | --- | --- | --- | --- |
| `wave03-b-native` | 4 | UNVERIFIED | UNKNOWN | **否** |
| `wave05-independent-review-pilot-01` | 24 | NOT_B_GRANT（E 所有） | — | 仅 E，未触碰 |

历史 3 次单独记账，未合并、未补足。**本轮模型调用 0。**

## 6. 实际命令与退出码

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node tests/native-acceptance/b9-runner-admission.mjs` | 0 | 16/16 PASS；admission REFUSED |
| `node tests/native-acceptance/b10-bound-probe.mjs` | 0 | 8/8 PASS；verdict NO_SUPPORTED_BOUNDED_RECIPE |
| `node tests/native-acceptance/b3-production-stop.mjs` | 0 | 6/6 |
| `node tests/native-acceptance/b4-recovery.mjs` | 0 | 3 PASS + 1 NOT_TESTED |
| `node tests/native-acceptance/false-pass.test.mjs` | 0 | 6/6 |
| `node --test …/b2-budget.test.mjs` | 0 | 10/10 |
| `node tests/native-acceptance/selftest.mjs` | 0 | 14/14 |
| `node --test …/{ledger-audit,pilot-runner,cost-preflight}.test.mjs` | 0 | 41/41 |

**假通过验证**：禁用链接检查 → `B9-COPY-REFUSES-LINK`、`B9-ADMISSION-REFUSES-LINK` 各 FAIL（14/16）；恢复 → 16/16。

## 7. 证据层级与未测范围

- `actual_native`：真实二进制应答（identity、134 方法、model/provider、goal 预算、config/model 无价格）
- `package-local`：副本/inode/Seatbelt profile/拒绝路径
- `protocol_fixture`：全控制流（B7，上一轮）
- **NOT_TESTED**：真实 vendor 控制、goal 预算的首轮强制语义、真实计费金额

本包**不是**产品/发行准入，**不**证明复核无收益（0026 §4 末段）。

## 8. 下一消费者步骤

- **main**：以 `admit()` 作为唯一准入结果；`REFUSED` 是当前受支持答案。若要改变测量设计，先版本化两个替代 recipe；价格单独修好不得解锁执行。
- **E**：只用一个 adapter 路径，无 CLI 退路。第一个会计费的动作是作者 turn，当前被 budget + cost 双门拒绝——这是预期行为。
- **D**：`runtime-diagnostics.mjs` 给出可读版本/能力/缺口（含 owner，无秘密）；宿主隔离需要 Seatbelt profile。
