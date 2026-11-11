# Agent B 真实运行与控制收口交接（wave-06 续）

日期：2026-11-11。branch `codex/g1-runtime`｜base `6f6edde`｜merge `47a4b0e`｜候选提交见 §7。**全包模型调用 0 次。**

本文件补充并更新 [wave06-status.json](wave06-status.json)。上一轮（base `82db295`）的 `wave06-b5-control-handoff.md` 保留，不覆盖。

## 1. 本轮交付：真实传输链（不再是计划模块）

上一轮的 `pilot-runner.mjs` 只做计划/校验，本轮补上了**真实传输**。

`tests/native-acceptance/pilot-transport.mjs` 真实 spawn 已安装的 `codex app-server`，走其 JSON-RPC 2.0 stdio 协议（换行分隔、无损字符串 id）：

| 操作 | 方法 | 是否计费 |
| --- | --- | --- |
| 握手 | `initialize` | 否 |
| 新会话/作者会话 | `thread/start`（`ephemeral` 控制落盘） | 否 |
| 续作者会话 | `thread/resume` | 否 |
| fork 到某 turn | `thread/fork`（可带 `lastTurnId`） | 否 |
| 读会话/取报告 | `thread/read` | 否 |
| **作者执行** | **`turn/start`** | **是（唯一计费方法）** |
| 取消 | `turn/interrupt` | 否 |
| 用量 | `thread/tokenUsage/updated`（事后通知） | — |
| 原身份核对 | `thread/read` 重读原 thread | 否 |

真实二进制实测（codex 0.164.0，0 次模型调用）：`initialize` 应答正常；`thread/start` 返回真实 thread id，model `gpt-6.1-sol`、provider `OpenAI`；构造+inspect 在 wire 上只有 `initialize`、`thread/start`、`thread/read`，**没有 `turn/start`**。

## 2. 一个实测出来的协议边界（重要）

**零 turn 的会话没有 rollout 文件**，因此：
- `thread/resume` → `no rollout found for thread id …`
- `thread/fork` → `no rollout found for thread id …`
- 另起进程 `thread/read` → `thread not loaded: …`

结论：**「可续/可 fork 的 checkpoint」本质上需要一个真实作者 turn。** 所以「作者执行 → checkpoint → 续会话 → fork」这条链的前半段无法在不计费的情况下构造出来。这是 BLOCKED 的结构性原因，不是实现缺陷，不掩饰。

## 3. 计费边界：作者 turn 不能被标签绕过

用户要求「作者turn同样必须经过持久预留；不能因no_review标签绕过计费」。已在传输层做成结构性约束：

- 预留钩子在任何字节写入 wire **之前**调用；无钩子 / 拒绝 / 抛异常 → **服务端 journal 看不到任何 `turn/start`**。
- `no_review` 作者臂同样必须过钩子；标签不使其免费。
- **假通过验证**：故意移除钩子守卫后，`B7-NO-HOOK` 与 `B7-AUTHOR-ALSO-RESERVES` 各 FAIL（12/14）；恢复后 14/14。

`B7` 共 14 例，双轨取证：`actual_native`（真实二进制 4 例）+ `protocol_fixture`（同协议 fixture 5 例，证明 author turn→usage→completed→resume/fork→cancel→reconcile 全控制流）+ `package-local`（5 例结构守卫）。fixture 用**服务端 wire journal** 断言「未发送」，不靠客户端自述。

## 4. 材料副本 与 宿主隔离（分别证明）

用户要求「分别证明材料副本和宿主隔离；允许scratch写」。

**材料副本侧**（`b3-sealed-copy.mjs`，8 PASS / 1 FAIL）：无 `.git`/remote/hooks、无共享 inode（逐字节复制）、scratch 可写且丢弃、作者文件字节不变、manifest 绑定冻结 subject。

**宿主隔离侧**（`b8-host-isolation.mjs`，**9/9**）：用 macOS Seatbelt（`sandbox-exec`，内核级强制）实测，**每个轴都同时测「无 profile（允许）」与「有 profile（拒绝）」**，反例证明是 profile 在起作用：

| 轴 | 无 profile | 有 profile |
| --- | --- | --- |
| 读作者凭据 | 允许 | **拒绝** |
| 写作者材料 | 允许 | **拒绝** |
| 网络外发 | 允许 | **拒绝** |
| 胶囊内 scratch 写 | — | **允许** |
| 胶囊内正常读 | — | **允许** |

这取代了上一轮「cwd 不是沙箱」的观察：现在有真实强制。但**副本本身仍不是隔离**，是 profile 让它成为隔离。

**保留的 FAIL**：`B3-HARDLINK-ESCAPE`——本机文件系统允许 `linkSync`。我们的胶囊构造器始终逐字节复制（`B8-COPY-NO-SHARED-INODE` 证明），但 OS 本身不禁止别的调用方用硬链接改动冻结源。保留为 FAIL，套件非零退出。

## 5. 账本：已重建，但仍是 UNKNOWN（关键发现）

`wave03-b-native` 原账文件在本分支历史中从未存在。已用 `ledger-reconstruct.mjs` 按**产品侧记录**重建并写出 `reports/model-budget.json`：

- 只把**产品侧预留/attempt 记录**当作归属依据
- 明确**拒绝**两类诱人但无效的来源：(a) 开发者个人 `~/.codex/sessions`（用户自有数据、混有无关桌面工作、ephemeral 线程不留痕，缺席不能证明未发送）；(b) 仅断言数字的状态文档
- 结果：产品侧 attempt 记录 0 条 → `attributionState=UNVERIFIED`、`remainder=UNKNOWN` → **真实发送仍阻断**

**重建过程中发现并修复一个严重假通过**：写出空任务账本后，`ledger-audit` 一度报 `VERIFIED` 且有 4 个空槽——即「丢失历史」会静默解锁花费。已修：`remainder=UNKNOWN` 或 `attributionState=UNVERIFIED` 一律判 UNVERIFIED，并加 2 条回归测试（含「已真正核清的账本仍须能放行」）。

| grant | limit | 归属状态 | 余量 | 可真实发送 |
| --- | --- | --- | --- | --- |
| `wave03-b-native` | 4 | UNVERIFIED | UNKNOWN | **否** |
| `wave05-independent-review-pilot-01` | 24 | NOT_B_GRANT | — | 仅 E（未被触碰） |

历史 3 次单独记账，未合并、未补足、且无法从产品记录归属。

## 6. 费用 / usage / 整 turn 上界：BLOCKED（三条独立原因，均已实测）

`cost-preflight.mjs`（10/10）对当前运行时给出 **BLOCKED，9 条具名阻断**：

1. **无价格面**：751 个生成绑定中检索 `price`/`Price` 零结果；真实模型身份 `gpt-6.1-sol`/`OpenAI` 无可核对公开价 → 不填估价、不填 0、不套订阅。
2. **`turn/start` 根本没有 token 上界字段**：其参数只有 `threadId`、`clientUserMessageId`、`turnTrigger`、`parentTurnId`、`rootTurnId`、`cwd`、`model`、`serviceTier`、`serviceTierForTurn`。**无法把任何 per-turn 上限挂到该 turn 上。**
3. **usage 事后到达**：`thread/tokenUsage/updated` 在 turn 结束后才来，含 `inputTokens`/`cachedInputTokens`/`cacheWriteInputTokens`/`outputTokens`/`reasoningOutputTokens`。能计量，不能封顶。

已明确拒绝作为充分证据：`maxOutputTokens` 单字段、墙钟 timeout、已发 cancel、仅在末尾收到 usage。

## 7. 交付物与复现命令

| 用途 | 命令 |
| --- | --- |
| E 可跑的真实传输 recipe | `node tests/native-acceptance/pilot-real-recipe.mjs [--json]` |
| 真实传输验收（14 例，双轨） | `node tests/native-acceptance/b7-pilot-transport.mjs [--record]` |
| 宿主隔离（9 例，含反例） | `node tests/native-acceptance/b8-host-isolation.mjs [--record]` |
| 密封副本（8 PASS/1 FAIL） | `node tests/native-acceptance/b3-sealed-copy.mjs [--record]` |
| 账本重建 | `node tests/native-acceptance/ledger-reconstruct.mjs [--write\|--json]` |
| 单元套件（41） | `node --test tests/native-acceptance/ledger-audit.test.mjs tests/native-acceptance/pilot-runner.test.mjs tests/native-acceptance/cost-preflight.test.mjs` |
| D 诊断视图 | `node tests/native-acceptance/runtime-diagnostics.mjs [--json]` |

`pilot-real-recipe.mjs` 实测输出：真实建两个 thread（fresh ephemeral + author），wire 仅 `initialize`/`thread/start`×2/`thread/read`×2（`NO_BILL`），checkpoint 边界 `refused:no rollout found`，作者 turn `NOT_STARTED`，`canSendRealToday=false`。

## 8. 未测范围（NOT_TESTED，不夸大）

- **真实 vendor turn 从未启动**：因此真实原生停止、逐 target 提问投递、epoch/attempt 漂移、真实未知发送核对均 **NOT_TESTED**。这是账本 UNKNOWN + 价格缺失的直接后果。
- 受控停止（6/6）、受控问答（5 PASS + 1 NOT_TESTED）、受控恢复（3 PASS + 1 NOT_TESTED）仍是**受控**证据，不是 vendor 证据。
- `B3-HARDLINK-ESCAPE` 为本机 FS 限制，未声称已解决。

## 9. 下一消费者步骤

- **E**：今天即可跑 `pilot-real-recipe.mjs` 看到真实传输与确切阻断原因；实现自己的 `budgetHook.reserve` 后，`pilot-transport.mjs` 的 `startTurn` 会在写入前调用它。第一个需要预算的动作是作者 `turn/start`。
- **main**：`maySendReal()` 作真实发送闸门；`wave03-b-native` 在账本真正核清前保持不可花。B 的 `8cc45ad` exact profile resolver 已按 0024 在模块范围准入（catalog 41）。
- **D**：`runtime-diagnostics.mjs` 提供版本/能力/缺口（含 owner，无秘密）。宿主隔离现在是真实可强制的，建议安装诊断标注「需 Seatbelt profile」。
