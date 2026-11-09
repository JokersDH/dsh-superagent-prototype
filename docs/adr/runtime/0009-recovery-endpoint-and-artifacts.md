# 恢复端点接线与通用产物（wave-02 收尾）

- 分支：`codex/g1-runtime`（已合并 `origin/main` `4ecb4c5`）
- 依据：`docs/rfcs/WP-16/0003-controlled-product-integration.md` 的 B 侧要求

---

## 1. 浏览器/恢复接线（B 侧边界）

主 Agent 的 `apps/coordinator/runner-link.ts` 已定义认证本地传输：私有目录内的 Unix socket +
bearer 凭据文件 + `GET /v1/inspection` / `POST /v1/cancel`，并以 `RunnerInspectionSchema` 校验。
**该文件的客户端部分未改动**（main-owned）。

B 侧补上的是**服务端**：`apps/runner/src/recovery-endpoint.ts`，让组合根可以注册并恢复**真实的**
独立 Runner，而不是 fixture。

### 保留的契约

| 项 | 行为 |
| --- | --- |
| socket | 私有目录 `0o700`，socket `0o600`，已存在则**拒绝复用** |
| 凭据 | 单独文件 `0o600`，`timingSafeEqual` 常量时间比较 |
| inspection | 严格匹配 main 的 `RunnerInspectionSchema`（含完整 attempt 身份） |
| resources | 精确对应 main 的 `ResourceStateSchema`：`{ref, ownership, writer, evidence}` |
| coverage | 恒为 `complete_owned_resources`（Runner 报告它拥有的全部资源） |

### 不可逆准入

- `cancel` 先在端点内把 `admission` 置为 `closed`，**然后**才尝试停止资源；
- 关闭后同一端点的 inspection 仍报 `closed`，不回到 `open`；
- **不存在**任何能启动业务的路径：`/v1/begin`、`/v1/command`、`/v1/deliver`、`/v1/answer` 全部 404
  （有测试固化）。重连**永不**变成 begin/deliver/answer。

### 与 main 客户端的互通证据

`test/recovery-interop.test.ts` 用 main 的 wire 契约（从 `runner-link.ts` 逐字镜像的
`RunnerInspectionSchema`）驱动真实端点：inspect 得到完整身份与清单、cancel 关闭准入、错误凭据被拒。

> 说明：main 的 `runner-link.ts` 通过 `@personal-agent/contracts` **构建产物**解析；本 worktree 不产出
> 该 dist，因此测试内镜像 schema。这是本仓构建布局限制，不是协议差异。

---

## 2. 通用产物修复

`candidate.observed` 的 `artifactRefs` 此前没有真实来源。新增
`apps/runner/src/artifact-manifest.ts`：

| 规则 | 说明 |
| --- | --- |
| 内容寻址 | 引用由 sha256 派生；**同路径不同字节是不同产物** |
| 不可变 | 同引用不同内容无法产生（引用含摘要） |
| 幂等 | 相同路径+相同字节重复登记返回同一引用 |
| 有界 | 超过上限 → `artifact_manifest_full`，**拒绝而不是丢弃** |
| 候选完整 | 无产物的候选 → `candidate_without_artifacts`，不可发布 |

FakeDriver 现在在完成的 turn 前发出带真实 `artifactRefs` 的 `candidate`，且该事实能通过冻结的
`parseRuntimeFactPayload` 校验（有测试）。

---

## 3. 验证

```sh
node apps/runner/scripts/demo-wave02.ts          # DEMO PASS 11/11
node tools/bootstrap/review-journal.mjs --runtime .
node tools/bootstrap/review-journal-followup.mjs --runtime .
node tools/bootstrap/review-journal-integrity.mjs --runtime .
```

```
driver-kit 18 · testing 8 · execution 44 · catalog 17
policy-preparation 9 · codex-native 16 · runner 110
合计 222 项全通过            tsc strict → exit 0
```

新增 17 项：产物清单 6、恢复端点 8、互通 3。

---

## 4. 未测 / 不声称

1. **真实 Codex/DSH/ZCode 兼容性 NOT_TESTED**：未执行真实二进制、未用真实模型。
2. 端点在**独立进程内**的完整注册-恢复闭环（需要 main 的 registry/launcher 接线）未做端到端；
   本批证明的是端点服务端 + main wire 契约互通。
3. 跨机器/断电持久性未验证。
4. `pnpm install` 产生的 `pnpm-lock.yaml` 差异**未提交**，交由主 Agent 统一生成。
