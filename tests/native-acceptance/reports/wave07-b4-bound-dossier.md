# B4 费用上界可行性 dossier：NO_SUPPORTED_BOUNDED_RECIPE

日期：2026-11-11。branch `codex/g1-runtime`。**零模型调查**：全部结论来自本机已安装 `codex-cli 0.164.0` 的正式协议、配置与真实二进制应答，未发送任何 `turn/start`。

## 结论

对当前安装版本，**不存在可执行的「整 turn 硬上界」recipe**。判定：`NO_SUPPORTED_BOUNDED_RECIPE`。

同时缺两条独立前提：**单 turn 可执行上界不可表达**、**实际 provider/model 无可核对价格**。二者任一未解决都不能开跑；修好价格也不自动解除 `runtime_bound_unavailable`（0026 §4）。

## 1. 调查方法与取证方式

| 步骤 | 方法 | 模型调用 |
| --- | --- | --- |
| 协议类型面 | `codex app-server generate-ts` → 751 个生成绑定 | 0 |
| 方法枚举 | 真实服务器对未知方法的错误回包列出 **134 个**可用方法 | 0 |
| 模型目录 | `model/list` 真实应答 | 0 |
| 配置面 | `config/read` 真实应答（35,654 字节） | 0 |
| goal 预算 | `thread/goal/set` / `get` / `clear` 真实应答 | 0 |
| 账户用量 | `account/usage/read`、`account/rateLimits/read` | 0（被拒） |

## 2. 逐一核查每个计费组件能否上界

整 turn 费用 = 输入历史 + 系统输入 + reasoning + cache 读/写 + 输出 + 工具往返 × 多轮推理。逐项结论：

| 组件 | 是否可上界 | 依据 |
| --- | --- | --- |
| 输出 token | **否**（单次请求） | `turn/start` 无 maxOutputTokens/maxTokens/tokenLimit 字段。参数仅 `threadId`、`clientUserMessageId`、`turnTrigger`、`parentTurnId`、`rootTurnId`、`cwd`、`model`、`serviceTier`、`serviceTierForTurn` |
| 输入历史 token | **否** | 无请求级输入上限；`config/read` 35KB 中无任何 token-limit 键（检索 `max*Tokens`、`output_token_limit`、`token_budget`、`context_window` 全为 NONE） |
| 系统输入 token | **否** | 同上；由 CLI 内部注入，调用方不可设上限 |
| reasoning token | **否** | `supportedReasoningEfforts` 只给 effort 档位（low/medium/high/xhigh…），是**质量选择**不是 token 上限 |
| cache 读/写 | **否** | 无缓存上限字段；cache 命中量由前缀决定，不可预留 |
| 工具往返次数 | **否** | 无 max turns/tool rounds 请求字段；`turn/steer`/`turn/interrupt` 可干预但不能事前设上限 |
| 累计（跨 turn） | **部分**（有真实机制，但非单 turn） | 见 §3 |

**因此：整 turn 内任何单一组件的可执行上限都不存在。** 字节数除以 4 是估算、固定 padding 是估算、`Math.min` 裁小预留是篡改预留、timeout 约束时间不约束 token、turn 后 usage 是事后观测、输出限制只覆盖一个组件——按 0026 §4 全部不能作为整 turn 硬上界。

## 3. 一个真实存在的部分机制：thread goal tokenBudget

这是本次调查唯一实质发现，必须准确描述而不能夸大为上界。

实测（持久线程，零模型）：

```
thread/goal/set { threadId, objective, tokenBudget: 1000 }
→ { goal: { tokenBudget: 1000, tokensUsed: 0, timeUsedSeconds: 0, status: "active" } }
```

- `ThreadGoalStatus` 含 **`budgetLimited`** 与 **`usageLimited`** — 运行时确实能表达「预算受限」状态。
- `ThreadGoal` 报告 `tokensUsed`、`timeUsedSeconds` — 累计用量可观测。
- **`ephemeral` 线程不支持 goal**：`ephemeral thread does not support goals`。这直接影响 fresh 复核臂——它默认用 ephemeral 以保证不落盘。

### 为什么它仍不是整 turn 上界（关键推理）

`tokenBudget` 是**线程 goal 的累计预算**，不是单次请求上限：

1. 第一轮开始时 `tokensUsed = 0`，任何正预算的预检查都会通过；
2. 该轮没有任何请求级 token 上限，因此它可以消耗远超 `tokenBudget` 的量；
3. 预算只能在事后（或后续轮次前）把它标成 `budgetLimited`。

即：**它能拦住第 2 轮及以后，拦不住第 1 轮**。而 pilot 的每一例作者 turn 正是从 `tokensUsed=0` 开始的第一轮。

未证明的部分（必须注明）：是否在**首次推理前**做硬检查、超预算是否中止进行中的 turn——这两点都需要真实发送才能测，本包禁止（预算余量 UNKNOWN 不可花），故记为 **NOT_TESTED**，不以推断代替。

## 4. 价格面：不存在

| 来源 | 结果 |
| --- | --- |
| 协议 751 个绑定 | 检索 `price`/`Price`/`cost` → **零结果** |
| `model/list` 真实应答 | 条目键为 id/model/upgrade/upgradeInfo/availabilityNux/displayName/description/modelSpecialty/hidden/supportedReasoningEfforts/defaultReasoningEffort/inputModalities/supportsPersonality/multiAgentVersion/additionalSpeedTiers/serviceTiers/defaultServiceTier/availableAccessPrograms/isDefault — **无任何价格/费用/credits 字段** |
| `config/read`（35KB） | 检索 price/cost/usd/credit → **NONE** |
| `account/usage/read` | `chatgpt authentication required to read token usage`（不可用） |
| `account/rateLimits/read` | `chatgpt authentication required to read rate limits`（不可用） |

实际模型身份：`gpt-6.1-sol`，provider `OpenAI`（真实 `thread/start` 应答）。该标识无可核对公开单价；`model/list` 里的 "lower cost" 是营销文案，不是价格。

**因此 `pricing_unavailable` 成立，且不能填估价、不能填 0、不能套订阅、不能套另一个产品同名价格。**

## 5. 两个零模型可核验的替代 recipe 建议（需 main 先版本化）

按 0026 §4「允许最多两个明确、可复用的替代 recipe 提案」。两者都**不改变** provider/model/协议，也**不新增 Driver/Grant**，但都改变测量设计，因此必须由 main 版本化后才能被 E 采用；且都**不能**把单 turn 变成硬上界。

### Recipe A：累计预算封顶 + 单例上限显式声明

- **做法**：持久线程 + `thread/goal/set{tokenBudget}`，把预算设为 `min(剩余grant, 本例上限)`；用例协议显式声明「第 1 轮可能超预算」，并把 grant 的 token 记账改为**事后按 `tokensUsed` 结算**而非事前预留。
- **会改变的变量**：pilot 协议语义（首轮无界 → 需 main 版本化）、fresh 臂不能再用 ephemeral（goal 不支持）。
- **仍不解决**：单 turn 硬上界；因此 `runtime_bound_unavailable` 不解除。
- **零模型可核验**：goal set/get/clear + `budgetLimited` 状态转移，全部无需 turn。

### Recipe B：冻结材料规模上限 + 输入占比拒绝

- **做法**：对冻结 subject 的材料字节设硬上限并换算保守 token 区间，拒绝输入本身就超过 goal 预算一定比例的用例；配合 Recipe A 使累计消耗落在可声明误差带内。
- **会改变的变量**：材料准入阈值（需 main 版本化），以及「哪些 case 可跑」的判定。
- **仍不解决**：输出/reasoning/工具往返仍无请求级上限。
- **零模型可核验**：材料摘要 + 阈值拒绝路径，全部无需 turn。

两者叠加仍只能给出**有误差带的累计上界**，无法给出**单 turn 硬上界**。若 pilot 需要「任一 turn 绝不超支」的强语义，本版本不支持。

## 6. 复现命令

```sh
# 协议面
codex app-server generate-ts --out /tmp/w06-ts            # 751 bindings
grep -ric 'maxoutputtokens\|maxtokens\|tokenlimit' /tmp/w06-ts/v2/TurnStartParams.ts   # 0
grep -rl 'price\|Price' /tmp/w06-ts/                                                   # 空

# 真实二进制（零模型）
node tests/native-acceptance/b10-bound-probe.mjs          # 方法枚举/模型目录/配置/goal 预算
```

`b10-bound-probe.mjs` 会把上表每一行重新测一遍并断言 `turn/start` 从未发送。

## 7. 边界声明

- 本 dossier **不是**「独立复核无收益」的证据；可行性失败与复核价值无关（0026 §4 末段）。
- 本 dossier **不是**产品准入，也不解除任何 pilot 阻塞。
- 未测：首轮预算是否硬检查、超预算是否中止进行中 turn、真实计费金额。三项均需真实发送，本包禁止。
- E 只有在 recipe、冻结协议与 main 准入三者一致后，才可在原 grant 内消费；`pricing_unavailable` 修好也不自动开跑。
