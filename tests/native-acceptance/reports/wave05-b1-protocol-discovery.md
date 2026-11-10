# B1 零模型协议勘察：ZCode 与 DeepSeek Harness

日期：2026-11-10。阶段：product-wave-05 B1。**本文件不含任何模型/原生 turn 调用**，仅有本地进程握手与方法表静态枚举，预算账本 `wave03-b-native` 保持 used=0。

## 1. 方法

只做两件事：(a) 读取本机已安装二进制的身份与协议方法表；(b) 启动 stdio 服务器做**握手级**探测（`initialize`/`session/list`/未知方法），不发送任何 prompt、不创建模型任务。

探测脚本不提交（一次性 `/tmp` 脚本），但步骤可完全复现，命令见 §3。

## 2. 已安装身份（实测）

| 项 | ZCode | DeepSeek Harness (DSH) |
| --- | --- | --- |
| 可执行 | `/opt/homebrew/bin/zcode` → `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` | `/Users/hh/.nvm/versions/node/v24.21.0/bin/dsh` |
| 版本 | `0.16.5` | `0.2.1-rc.2`（npm `@deepseek-ai/dsh`） |
| 引擎摘要 | sha256 `e9f1868c0fdb863537ed910ee3828b9be96b8c2fd805473f63b439e1113266b8`（12,615,227 bytes，2026-09-04） | 未取摘要（本阶段只确认版本/入口） |
| 形态 | Electron 桌面 app 内嵌 `zcode.cjs`（Node 脚本），wrapper 转发 | Node CLI |
| 原生入口 | `zcode app-server`（"ZCode Protocol stdio app server"） | 见 §5 |
| 认证 | 需要 Z.AI OAuth（`zcode login`）；但 `session/list` 可未认证调用 | 未知，未验证 |

## 3. 协议实际形状（实测，非文档推断）

**关键差异**：ZCode 自称 "ZCode Protocol"，**不是** JSON-RPC 2.0。违规点已实测：

- 发送 `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}` → 返回 `-32600 Invalid ZCode Protocol message`，`issues` 明确列出 `Unrecognized key: "jsonrpc"`（以及无 `id` 时 `Unrecognized key: "id"`）。
- 正确信封为 `{id, method, params}`：`{"id":1,"method":"initialize",...}` → `{"error":{"code":-32601,"message":"Method not found: initialize"},"id":1}`，即信封被接受、但 `initialize` 不是方法名。
- 应答格式与 JSON-RPC 2.0 相同（`{id, result}` / `{id, error:{code,message,data}}`），错误码沿用 `-32600/-32601/-32602/-32603`。
- 传输：NDJSON（每行一条消息），服务器类 `ZCodeProtocolNdjsonConnection` 逐行 `JSON.parse`，解析失败回 `-32700`。
- `session/stop` 被**绕过**串行队列处理（`shouldBypassProcessingQueue`），即 stop 是优先级控制通道，和 Codex 的 cancel 优先级语义一致。

已用实测确认的方法：

- `{"id":"a","method":"session/list","params":{}}` → **成功**，返回真实本地会话数组（`sessionId: "sess_…"`, `status: "idle"`, `mode`, `titleSource`, `workspace`…）。
- `{"id":"c","method":"tools/list"}` → `-32601`，说明该命名空间不存在（`tools/*` 是内部 MCP 客户端代码，不是本协议方法）。

## 4. 方法表（从引擎常量静态枚举，两处交叉验证）

方法名用 `namespace/verb` 而非 camelCase，与分发表 `dispatchRequest` 一致。

**会话（22）**：`session/create` `session/resume` `session/list` `session/read` `session/messages` `session/events` `session/subscribe` `session/send` `session/stop` `session/fork` `session/compact` `session/goal` `session/close` `session/subagents` `session/usage` `session/setModel` `session/setMode` `session/setThoughtLevel` `session/updateRuntimeModelConfig` `session/cancelBackgroundTask` `session/requestRuntimePreferences`

**服务器→客户端请求（关键：权限与提问都是回调，不是客户端主动方法）**：
`interaction/requestPermission`、`interaction/requestUserInput`、`interaction/browserExecute`、`interaction/browserList`、`interaction/requestOfficialMcpAuthHeaders`、`interaction/requestProviderRuntimeHeaders`

**通知**：`session/event`、`v4/conversation/frame`（会话订阅帧）、`process/resourceSample`、`process/mcpTelemetry`、`plugins/operationProgress`

**其余**：`v4/command`（命令入口）、`usage/stats`、`workspace/*`（12 个：readState/generateText/setDefaultModel/upsertModelProvider…）、`plugins/*`（15 个）、`mcp/list`、`skills/referenceCatalog`

### 4.1 与我方 RuntimeCommand 的映射

| 我方语义 | ZCode 方法 | 判定 |
| --- | --- | --- |
| begin / 派发一次执行 | `session/send`（或 `v4/command`） | 形状存在，语义需实测 |
| 取消 | `session/stop`（走 bypass 快速通道） | **PASS（握手段）**：方法存在且被特判优先级 |
| 提问 | `interaction/requestUserInput`（服务器→客户端请求） | 与 Codex 的 approval/server-request 模型同构；应答按 `id` 回填 |
| 权限审批 | `interaction/requestPermission`（同上） | **PASS（握手段）**：回调模型明确 |
| 事件流 | `session/subscribe` + `session/event` + `v4/conversation/frame` | 形状存在；帧协议独立（v4），需实测 |
| 产物 | 未发现独立 artifact 方法；文件变更走 `conversation/fileChanges`、`attachment/*` | 需实测 |
| usage/成本 | `session/usage`、`usage/stats` | 形状存在 |

## 5. DeepSeek Harness

- 已安装 `dsh` `0.2.1-rc.2`。**本阶段未对其协议做握手探测**：它是本次会话自身的宿主运行时，探测其 app-server/stdio 形态会与当前会话进程竞争同一 profile，且 B2 之前不做新 Driver 实现，故如实记为 **NOT_TESTED**，不凭印象判断"是否 ACP"。
- 下一步（B2 若 unlock）：先只读枚举 `dsh --help` 与其包内 schema，取版本摘要，再做握手。

## 6. 结论：选择表（B1 交付）

| 候选 | 协议 | 第二协议资格 | 判定 |
| --- | --- | --- | --- |
| **ZCode** | ZCode Protocol（自定义 NDJSON，非 JSON-RPC2） | **是**：独立厂商、独立 wire 格式、独立方法语义（`interaction/*` 回调、`v4/*` 帧）、独立认证 | **选定为首选验证目标** |
| DeepSeek Harness | 未验证 | 未知 | 保留为备选，**NOT_TESTED** |
| 换 Codex 模型 / 假 server 改品牌 | — | 否 | 明确排除，不构成第二执行器（任务书要求） |

**为什么选 ZCode**：它与 Codex 的 JSON-RPC 2.0 在**信封层就不同**（无 `jsonrpc` 键、`namespace/verb` 方法名），因此复用 Codex adapter 无法"假装通过"——这正是"真实可验证的不同协议"的要求。且 `session/stop` 的 bypass 特判、`interaction/requestPermission` 回调模型与我的停止/未知发送不变量结构同构，可映射而无需发明机制。

**为何不选 ACP**：未发现 ZCode 支持 ACP（方法表中无 `session/new`/`session/prompt` 等 ACP 命名，且信封与 ACP 的 JSON-RPC2 不符）。故 B2 应走窄 Adapter 路径（`packages/drivers/zcode-native/`）而非共享 ACP transport；此结论需在 B2 提交 RFC 说明。

## 7. 明确未证明的事（防止过度声称）

- **未**证明真实模型执行、真实 begin/process/barrier、真实提问-应答往返——这些需要模型 turn，B2 gate（pilot promising）未开。
- **未**证明胶囊/宿主隔离能力（ZCode 是否可禁工具、限定 cwd、禁网络）。
- **未**证明未知发送可对账（`session/send` 超时后行为）。
- 方法表来自**静态枚举**，个别方法可能仅在特定 feature flag 下可用；`-32601` 只证明方法名不在当前分发表中。
- 握手级 `session/list` 成功**不等于**认证通过或不等于可执行任务。

## 8. 复现命令

```sh
zcode --version                       # 0.16.5
shasum -a 256 /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
# 信封违规（期望 -32600 且 issues 含 Unrecognized key "jsonrpc"）
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' | zcode app-server
# 方法枚举
strings -a /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs | grep -oE 'session[A-Z][a-zA-Z]+:"session/[a-zA-Z.]+"' | sort -u
strings -a /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs | grep -oE 'interaction[A-Z][a-zA-Z]*:"interaction/[a-zA-Z]+"' | sort -u
```

（stdio 服务器需保持 stdin 打开；单条 `printf |` 会在响应前 EOF，故 §3 的探测用持久 stdin 的 Node 脚本。）
