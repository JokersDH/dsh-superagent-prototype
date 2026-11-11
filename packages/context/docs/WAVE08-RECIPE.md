# Agent C：有授权上下文与提案消费者的接线说明（wave-08）

Branch `codex/g3-assistant-context`，base `origin/main` `5d4065b`（merge `3304cea`）。
Owned paths: `packages/context`, `packages/proposals`, `packages/knowledge`, `packages/routing`。
本文件只描述库契约；HTTP/UI/SQL/application 组合由 main 拥有。

## 1. 唯一授权门（每条来源同一边界）

`ContextComposer.compose()` 在**任何 provider 调用之前**调用 `authorizeComposition(...)`：

| 检查 | 失败码 | 是否调用 provider |
| --- | --- | --- |
| grant schema / 内部 project 一致 | `invalid_input` | 否 |
| `gateway === 'conversation'` | `grant_gateway` | 否 |
| grant 与请求项目一致 | `grant_project` | 否 |
| `grant.purpose === request.purpose` | `grant_purpose` | 否 |
| `confirmedAt` 在过去 | `grant_unconfirmed` | 否 |
| `expiresAt` 未过期 | `grant_expired` | 否 |
| caller 预算为正整数 | `invalid_input` | 否 |

预算只能**夹紧**：`caller = min(caller, grant, 硬上限)`；被夹紧的维度记录在
`composition.budgetClamped`，grant 永不因 caller 请求而扩大。硬上限见
`COMPOSITION_BUDGET_CEILINGS`（files/slices 64、bytes 4 MiB、tokens 500k、duration 60s）。

授权在有多个组的组合过程中每个组前后重跑一次（`assertStillAuthorized`）：跨 `await` 过期即
`grant_expired`，不会返回部分结果。

## 2. 输出契约（main 直接投影）

```ts
const composition = await composer.compose({ requestId, projectId, purpose, query, grant, budget,
  conversationId, workId?, contract? })
const preview = buildCompositionPreview(composition)   // 网页预览字段
const manifest = buildSourceManifest(composition)      // 稳定来源清单
```

`buildSourceManifest` 每项：`sourceId / kind / group / path / title? / contentDigest /
baselineCommit? / truncated / bytes / tokens / trust: 'untrusted_data'`，外加 `omitted`、
`injectionFlagPaths`、`budgetClamped`。不含 actor、权限、tool 或宿主绝对路径。

组顺序固定：`contract` → `decisions` → `project_facts` → `conversation` → `artifacts` → `files`；
组只能读取 grant 内 kind，未授权组为 `denied_kind` 且其预算结转给后续组。

## 3. A port adapter recipe

```ts
const ports = createWorkflowPorts(store)
const composer = new ContextComposer({
  port: new ReadIndexContextPort({ projectId, index: ports.index }),   // 项目/work/合同
  decisions: decisionContextProvider(governance),                     // 有效决定，scan_incomplete 传播
  conversation: { recent: async ({ projectId, conversationId, limit }) => /* main 自己的有界消息读 */ },
  artifacts: { recent: async ({ projectId, limit }) => /* ports.index.listArtifacts */ },
})
```

不进入普通共享知识的内容：跨项目/跨会话来源（显式 `cross_project`）、contract 漂移
（`contract_stale`）、symlink/父目录逃逸与账号材料（reader 拒绝）、权限/认证答案（knowledge 拒绝
成为共享决定）、撤销/替代/过期/来源失效的决定（provider 已排除）。

## 4. 提案消费者（main 已发布入口）

main 的 `/v1/proposals/prepare`、`/v1/proposals/commands` 与 `/v1/decisions/*` 已可用；C 的独立
HTTP 消费者见 `packages/knowledge/test/main-proposal-http.case.ts`，库级消费者见
`main-proposal-consumer.case.ts`。一致点：

- prepare 只读（无 proposal/decision/event 写入）；缺 `work.scope/criteria/profileId` 或完整
  `revision.*` 时返回 `requiredInputs`，确认被拒绝且**不落任何 confirmed/pending 记录**；
- 确认时 main 在**同一 UnitOfWork** 用 `persistPending → commit(effectCommandId) → 原业务命令`，
  任何失败回滚 proposal、effect、event、receipt；
- `reject_proposal` 是终态：无 `effectCommandId`、无业务效果、事件只记 `rejected`；随后确认返回
  409 且状态不变（不把 reject 与 revoke 混用）；
- 同一 command id 重放返回原回执、无第二次效果；不同 id 对同一预览为冲突；
- 预览过期或 grant 变化 → 拒绝且无 confirmed 状态。

## 5. 未发布入口与剩余 owner

| 缺口 | owner | 说明 |
| --- | --- | --- |
| context 预览/组合 HTTP | main | `grep -c "v1/context" apps/coordinator/http/app.ts` = 0；C 不写 HTTP，已交 recipe/fixture |
| 可信 outcome/review producer、候选变化失效钩子 | main | C 的有效性规则已交付 |
| 真实原生/复核执行与 pilot 价值 | B/E | 与 C 库无关 |

## 6. 证据与命令

```sh
node tools/bootstrap/probe-wave08-context-grant.mjs "$PWD"     # PASS_CONTEXT_GRANT_BOUNDARY
pnpm --filter @personal-agent/context test                      # 56/56
pnpm --filter @personal-agent/knowledge test                    # 68/68
node packages/context/examples/composition-performance.mjs      # PASS, bounded, 0 model/network
```
