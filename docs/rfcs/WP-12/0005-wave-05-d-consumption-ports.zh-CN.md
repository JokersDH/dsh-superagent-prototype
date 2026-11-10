# WP-12 / D 第五轮：D 消费端口与默认关闭的复核入口

日期：2026-11-10。基线：合并 main `f04ceb8`（origin/main `a70db20`）。本文是 D（launcher/distribution/portability）第五轮对 A/B/main 的消费需求，不是新增产品接口，也不改变 frozen Runner/data wire。

## 1. 现状

| 能力 | 当前可消费 | 缺口/owner |
| --- | --- | --- |
| 恢复只读（含恢复项目绑定） | main `createProductRuntime(startupMode)` 保留恢复项目 scope 并禁止 start effects；D 的 probe 已从“错误复现”改为“只读启动/项目可读/命令 422/旧队列不变”通过 | 无（main 已修） |
| 证据备份/恢复 | A 公开 `backupDatabase`/`verifyDatabase`/`readArtifactRegistry` + `WorkflowSnapshots`；D 新增 `readEvidenceSummary(databasePath)`（只读公共读端口）覆盖 project settings/policy snapshot、works、contracts/links、decisions、assistant state、artifact registry；bundle 记录 evidence digest，restore 逐类重读并 fail-closed | 路由建议/复核报告/执行结果尚无持久化；见 §2 |
| 作者执行器诊断 | Codex CLI 版本 + 私有 auth 文件存在性/权限（只读，不回显）；native product evidence 作为已交事实读取，不当作实时准入 | 无 |
| 第二执行器/复核入口 | B 的探测/准入结论尚未以公开机器可读接口进入 main；D 仅支持 `doctor --executors-fixture` 诊断 fixture，默认 `review_executor=WARN(no_executor_interface)`；必需复核时 BLOCKED 且明确缺失 reviewer | 见 §3；owner B/main |
| 模型 key/秘密存储 | D 不建第二份秘密配置、不写入 bundle/log/网页；staged install 断言不含 `api.key/auth.json/.env/instance.json/launcher.json/start.lock` | 保持 main 所有 |

## 2. 请求 A：路由/复核证据的公开只读端口

契约 `packages/contracts/src/routing-review.ts` 已定义 `RouteAdvice`/`ReviewEvidence`/`ExecutionOutcome` 与同步 `RoutingEvidencePort`，但存储实现尚未进入 main。D4 需要把“推荐、复核、结果、profile/policy 快照、完成 patch”纳入同一 bundle 并逐字节校验。

请 A 在实现持久化时同时提供：

1. `RoutingEvidencePort` 的真实存储实现（append-only、同 UnitOfWork、不改旧迁移）；
2. 面向备份/审计的只读函数（名字可自定，建议）：
   ```ts
   readRoutingEvidence(databasePath: string): {
     advice: RouteAdvice[]; reviews: ReviewEvidence[]; outcomes: ExecutionOutcome[];
     digest: string; // canonical digest over the above, stable ordering
   }
   ```
   只读打开快照库，不应用迁移、不写 WAL、不创建第二个 writer；
3. 在 `packages/storage` 公开导出，使 portability 可在 `readEvidenceSummary()` 中增加 `routingEvidence.status='included'` + digest/计数；当前 D 明确记录 `unavailable` 及所需端口，**不伪造已覆盖**。

验收约定：D 的 restore 会比较 bundle manifest 的 routing digest 与恢复库重读结果；缺失/不一致 → `evidence_mismatch`，不假成功。旧 bundle 没有 evidence 字段时 D 标 `not_recorded` 并在报告限制中说明，不补造 0。

## 3. 请求 B/main：执行器能力与 first-run 公共输入

D3 需要“作者/复核执行器的版本、能力、准入与缺口”以及“必需复核模式缺能力时 blocked”，但 D 不自行实现产品 HTTP/账号代理，也不新增秘密配置。

请 B 公开（文件或 main 可信配置入口均可，零模型）机器可读描述，建议形状：

```json
{
  "protocol": "personal-executors/1",
  "requiredReview": false,
  "executors": [{
    "role": "author" | "reviewer",
    "profileId": "…",
    "version": "codex-cli 0.164.0",
    "capabilities": ["native_execute", "session_resume"],
    "admitted": true,
    "admissionRef": "reports/releases/native-mvp/native-product.json",
    "probeRef": "…",
    "limitations": ["…"]
  }]
}
```

约束：
- 只描述存在性/版本/能力/准入引用，**不含 key、token、账号路径或任何凭据**；
- 模型 key 仍只经 main 现有/新增的可信私有设置保存；D 的 doctor 只读“是否存在/权限位”，不读内容、不回显；
- 该输入进入 main 后，D 的 `doctor` 将用它替代 `--executors-fixture` 并保持相同判定：reviewer 缺失且 `requiredReview=true` → BLOCKED；缺失但非必需 → WARN，作者路径可用；默认入口不启用复核（AMENDMENT-01 第 6 节）；
- 若 B/main 暂不提供，本轮的 fixture 协议即为诊断契约，**不得**把 fixture 当作生产配置或默认开启复核。

## 4. 请求 main：恢复后的重新授权步骤

wave-04/05 已确认：恢复默认只读、marker 不删除、旧 writer/native 证明不成为新授权。D 的 smoke 中“新目录只读恢复→诊断/允许后才新授权”的最后一步由 main 负责，当前以 `BLOCKED_RECOVERY_AUTHORIZATION` 记录并注明 main owner；D 只提供可复制 CLI 与稳定错误/诊断，不自建开关。

## 5. D 的消费承诺

- stage/install 自检继续要求 `runtime_abi`、`release_manifest`、`console_mode`、`runtime_dependencies` 全 PASS，缺 Node/ABI/agent/auth/端口均给稳定 code；
- bundle evidence 只来自只读快照库的公开读端口；新增端口后追加覆盖并提升 evidence formatVersion，而不是静默改变旧语义；
- 所有平台/跨机器仍标 NOT_TESTED；包内 PASS 与 main/E 准入分列。
