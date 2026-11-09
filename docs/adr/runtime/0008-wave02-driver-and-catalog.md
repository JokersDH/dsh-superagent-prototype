# Codex Native Driver 与接入指南（WP-07 / wave-02 B4）

- 包：`packages/drivers/codex-native`
- 状态：**协议层与身份链已实现并通过 fake app-server 测试；真实安装版兼容性 NOT_TESTED**

## 1. 协议依据

Codex 的 `app-server` 使用 **JSON-RPC 2.0 over stdio，按行分帧**。本实现据此建模：

| 阶段 | 方法 | 说明 |
| --- | --- | --- |
| 握手 | `initialize` → 通知 `initialized` | 未收到 `initialize` 结果前不创建 thread |
| 线程 | `thread/start` | 返回 `thread.id`，缺 id 视为 `invalid_identity` |
| 轮次 | `turn/start` | 返回 `turn.id`；**每次 attempt 只允许一次** begin |
| 追加输入 | `turn/steer` | 需 `threadId` + `expectedTurnId` |
| 中断 | `turn/interrupt` | cancel 与 pause_at_boundary 共用 |
| 回答 | 由 `answer(nativeBindingRef, answerRef)` 携带**精确 request id** | 不按文本相似度匹配 |
| 通知 | `item/started|updated|completed`、`turn/completed`、`thread/tokenUsage/updated`、`config/changed` | 转成关键事实 |
| 授权请求 | `*/requestApproval`、`requestUserInput` | 转成 `question.opened`，**绝不自动回答** |

## 2. 身份链与无损 ID

- 链：`initialize` → `thread.id` → `turn.id` → `item.id` → `request.id`，任一环节缺 id 即协议错误；
- request id 分 `string` / `integer` 两种，`43` 与 `"43"` 不同；超出 `2^53` 的整数以十进制字符串保留；
- **id 由进程级全局计数器分配**，跨连接不复用：一个旧连接的迟到回执不可能满足新连接的请求；
- `CodexConnection.close()` 不可逆，关闭后挂在途请求全部 reject，不允许复用。

## 3. 权限与问题

- 原生批准请求转成 `permission` 问题，保留精确选项（approve/deny）；
- 回答绑定当前 connection epoch 与精确 request id；
- 跨连接不自动重放任何权限响应；
- 未获人工决定前 **不发送 answer**（有测试固化）。

## 4. 接入指南（真实 Codex 尚未验证）

1. 固定 `AgentProfile`：`executable` 绝对路径、`argv`（如 `["app-server"]`）、`expectedVersion`、`nativeConfigRef`、`permissionPolicyRevision`；
2. 用 catalog 做只读探测（version/help），得到 `inspection_passed` 才允许调度；
3. 用 policy-preparation 记录 `PreparedExecutionPolicy`，`enforced` + `verified` + 指纹一致才放行 begin；
4. 通过 `CodexNativeDriver({ connect })` 接入真实子进程：`connect` 负责 spawn 与 stdio 桥接。

## 5. NOT_TESTED（明确不声称）

- 与任何**真实安装版 Codex** 的兼容性：未执行真实二进制、未使用真实模型；
- 各方法在真实版本中的参数/返回结构与本实现的对照（goldens 来自 fake server，非安装版 schema 导出）；
- 真实计费/额度、真实登录流程；
- DSH / ZCode 协议（按计划留待后续）。

真实模型 smoke 需要明确的 scratch 项目与预算授权；本轮未执行。
