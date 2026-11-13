# 第二十轮 Agent C：真实个人只读启动消费者

2026-11-13，基线 `0751379`（合并 `origin/main` `4c93817`，main 显式个人只读入口 `773b34d`）。
C 只改 context/proposals/knowledge/routing；真实 vendor model/native 0；未写 SQL/HTTP/第二确认权威。
本轮不重修 main 的 personal 启动协议，也不重修已过的同一快照第二根桥接，而是**直接消费**它。

## 1. 被消费的 main 入口（不重写）

| 入口 | 实际用法 |
| --- | --- |
| `apps/coordinator/product/restored-review.ts` | `prepareRestoredReview(store, state, {userId:'local-demo-user',authorityRef:'local-demo-authority'}, selection, secret, now)`；`loadRestoredReview(file, store, state, principal, secret, now)` |
| `tools/dev/review-restored.mjs` | `--state <restored> --project <id> --allow-path src/ --output <new 600 file>`；不覆盖已有文件 |
| `apps/coordinator/product/demo.ts` | `--state <restored> --port <p> --discussion-only --assistant [--review-restored-scope <file>]`，`PA_MODEL_CONFIG` 指向本机模型配置 |
| `tools/dev/workbench.mjs` | 同一 `--review-restored-scope`，显式拒绝 `--fixture` + 恢复审阅组合，转发给 demo |

consent payload 固定为 `restored-personal-review/1`、`access:'historical_data_read_only'`、
`startupAvailable:false`，绑定当前 `stateRoot`（realpath）、principal、host/platform/arch/uid、
markerDigest、sourceFingerprint，`expiresAt-createdAt<=300000`；文件本身要求 0600、属主匹配、
`O_NOFOLLOW|O_NONBLOCK`、非 FIFO、≤128KiB。

## 2. 同一条真实链：真实业务 + 候选/上下文 + 快照 + 个人只读

`packages/knowledge/test/main-personal-readstartup.case.ts`（单个 case，一次跑完）：

1. **真实 Work/Ticket/Broker 问答**：受控正常产品路径 `create_work` → real Broker question →
   `answer_question` → delivery `native_applied` → accept candidate → Work `delivered`。
   提问/回答以 anchored `trusted_user` + `question_answer_display` 存在，不是普通模型消息。
2. **真实 SDK 候选与 frozen 上下文**：另一个 normal 但无可执行器的实例（`executionUnavailable`）
   以**与个人审阅完全相同的 scope**（`src/` + `.git` exclusion）产生 chat 与 selected-context，
   因此候选自身 scope 与个人 grant 一致；捕获原候选 `payloadDigest` 与原 audit `bundleDigest`。
3. **同 Store 双版本快照**：默认 `workflow-snapshot/1`+`workflow-evidence/1`（13 族）与显式
   `workflow-snapshot/2`+`workflow-evidence/2`+`familySetVersion:2`（21 族）均 verify ok；
   `formatVersion:3` 在目录创建前拒绝。portability 的 personal-evidence 1/2 是另一协议，未混用。
4. **真实恢复副本**：v1 的 `product.sqlite`+`artifacts` 复制到新 root，写 `personal-restore/1`
   `restore-report.json`（0600）。这不是 fixture，也不从旧 registry 自动授权。
5. **无显式选择即拒绝**：`--assistant` 但没有 `--review-restored-scope` 时，
   `GET /v1/messages/:id/candidates` 与 `/v1/context/history` 均 403。
6. **显式新 600 文件**：`review-restored.mjs` 生成新文件；第二次同 output 被拒绝；
   文件 mode 0600；payload 不含 API key/action key；`sourceFingerprint` 恰好等于该恢复库当前事实。
7. **带 flag 重启**：health `mode:'personal'`、`startupMode:'recovery_readonly'`；
   `/v1/configuration` 该 project `dispatchAllowed:false`、`profileIds:[]`、scope 恰为选择。
8. **只读可读**：原候选 `payloadDigest`、history entry、frozen audit `bundleDigest`、
   `/v1/messages/:id/context/sources`（`state:'verified'`）、`/v1/snapshot`、`/v1/works/:id`
   （`delivered`）、`/v1/questions/:id/deliveries`（`native_applied`）全部 200 且身份一致；
   权限显示文本不出现在 frozen sources 中。
9. **业务仍拒绝**：candidates prepare、chat、answer_question、create_work、proposals、
   context preview、旧 context token 重放全部 422；provider 请求数不变（仍为 2）；
   held queue 仍 1；Work 数不变；`start()` 未开。
10. **source 事实不等于 grant**：`/v1/recovery/inspect` 200；`source/prepare` 200 但
    `authorization:'not_granted'`、`startupAvailable:false`；target 目录不存在；
    `source/confirm` 仍 `startupAvailable:false`；activation audit 等于 confirm；target 仍不存在。

## 3. 拒绝矩阵（都是实际 loader/CLI 断言）

| 变化 | 结果 |
| --- | --- |
| 过期（+10 分钟） | forbidden |
| 外来 principal / root / action key | forbidden |
| scope 扩大为 `.` | forbidden |
| 文件 0644 / symlink / FIFO / 缺失 | forbidden |
| source 变化 / marker 变化 / signature 变化 | forbidden（独立 drift 小库，不动真实根） |
| 未知 project、`../outside`、`externalActions:['deploy']`、`executable:true` | 显式呈现时被拒 |

## 4. 对 D/E 的消费说明（C8）

- D 的安装/升级只需消费本 case 使用的四件事：main 的 `review-restored.mjs` 生成的新 600 文件、
  demo/workbench 的 `--review-restored-scope`、`personal-restore/1` marker、以及 `src/`+exclusion
  的显式 scope。**不要**从旧 settings/registry 推导 grant，也不要用 `--fixture` 代替 personal。
- E 的断言应区分三件事：快照协议（`workflow-snapshot/1|2`）、恢复 marker（`personal-restore/1`）、
  个人审阅同意文件（`restored-personal-review/1`）。三者身份/摘要不可互换；只读启动不等于
  source confirm，不等于 private permission，也不等于 target 启动。
- 安装/升级矩阵仍走既有同一包 tar/hash/build/schema 绑定；本 case 不宣称 installed 认证。

## 5. 限制

- workbench 的 flag 转发是**源码事实**（同一 demo 入口、`--fixture` 组合被拒），本轮实际进程
  执行只跑 demo；未跑 vite 前端。
- 实际进程只有 `demo.ts`；restore 使用真实 v1 快照的产品库/artifacts 复制 + 真实 marker，
  不是 launcher 的完整安装/升级流程。
- 没有 private permission、target 创建、queue 消费或 vendor native 调用。
- 权限问答仍是权限数据，没有被“普通模型批准”复用；这只在本 case 的 focused scope 内测量。
