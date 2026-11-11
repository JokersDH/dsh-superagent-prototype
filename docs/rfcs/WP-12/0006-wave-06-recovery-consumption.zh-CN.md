# WP-12 / D 第六轮收口：恢复消费、跨版本数据行为与冻结安装物

日期：2026-11-11。基线：合并 main `d4d51ae`（含 WP-16/0024 决定 HTTP / 共享排序、WP-16/0025 接受结果投影与恢复预检）。本文只描述 D（launcher / distribution / portability）的消费与发行证据，不是个人 Alpha 或 main 准入结论。真实模型调用 0。

## 1. 本轮与上一份候选的差别

上一份安装物（`d4eb3a13`）来自工作区有未提交改动的源码，且数据库 schema 为 12，没有路由/复核/结果证据表。本轮：

- 从**干净提交** `e10bfdb` 重新构建（`source.dirty=false`，`install.json` 记录同一 commit）；
- schema 13 已进 main（A 的 `route_advice` / `review_evidence` / `execution_outcome`），bundle evidence 升到 format 2 并真实读取这些记录；
- main 的 `GET /v1/recovery/inspect`、`POST /v1/recovery/prepare` 已实现，D 用 CLI 消费；`/v1/recovery/commit` 仍未实现；
- 跨版本行为分成**二进制**与**数据**两类分别验证，不再用“同源码换 tag”冒充迁移。

## 2. 当前安装物

| 项 | 值 |
| --- | --- |
| source commit | `e10bfdb7a74f40b72a5e61d0debb0ed0bdd22389`（dirty=false） |
| buildId | `7e8f6ce6fa2e2633` |
| 安装目录（仓库外） | `/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/install` |
| tar（仓库外） | `/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/wave06-alpha2-7e8f6ce6.tar.gz` |
| tar sha256 / 字节 | `0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631` / 19,911,757 |
| install.json sha256 | `09041204af46dca6…`（完整值见 `tools/distribution/reports/wave06/install-artifact.json`） |
| 文件 / 字节 | 6603 / 66,153,443 |
| workspace 包 / 外部依赖 | 21 / 8（依赖摘要与许可见 install-artifact.json） |
| 平台 / 运行时 | darwin/arm64、Node 24.21.x、SQLite ABI 137、SQLite 3.53.4 |
| 摘要清单 | `tools/distribution/reports/wave06/install-artifact.json`、`install-summary.json` |

E 的独立复跑命令（不改 D 断言）：

```sh
node <repo>/tools/distribution/verify-artifact.mjs --tar <frozen tar>
```

## 3. 恢复授权：现在可消费什么，什么仍然 BLOCKED

| 步骤 | 状态 | D 的消费方式 |
| --- | --- | --- |
| 本地只读投影 | 已实现（D） | `pa recovery-status --json`：marker、`startupMode`、pending rebind、`queueReplay=never`，不启动 daemon |
| `inspect` | 已实现（main，WP-16/0025） | `pa recovery-inspect --json`：状态、marker digest、schema、事件游标、held queue（waiting/parked）、项目、历史 attempt、`inspectionFingerprint` |
| `prepare` | 已实现（main，只读） | `pa recovery-prepare --json --source-project <id> --path <abs git root>`：5 分钟计划、`proposedProjectId`（不静默复用旧身份）、blockers |
| `commit` / 新授权 | **BLOCKED** | 不存在接口；D 不猜 shape、不加 force、不删 marker、不重放旧队列、不建第二认证 |

已实测的负例（`tools/distribution/reports/wave06/zero-model-smoke.json` 的 `recovery-inspect-prepare-readonly` 与 `artifact-acceptance.json` 的 `artifact-recovery-preflight-readonly`）：

- inspect/prepare 前后恢复库字节、marker 字节、旧队列 waiting/parked 全部不变；
- 不存在的项目路径被拒绝（`prepare_refused`），不返回计划；
- 恢复只读实例的 `/v1/commands` 仍为 422；
- 响应固定 `authorization=not_granted`、`commitAvailable=false`，预检 200 不被当作授权。

main 实现 commit 时的最小输入（完整清单见 `tools/distribution/reports/wave06/recovery-authorization-blocker.json`）：旧队列隔离与不误消费证明、当前机器/路径/执行器/环境/物理资源的重新核对、精确计划与当前指纹的认证确认与幂等回执、过期/漂移/重放拒绝、仅授权新工作/新合同且保留 marker 与 unknown-writer 屏障。

## 4. 升级与回滚：二进制、数据分开说

`tools/distribution/smoke-upgrade.mjs` 分三段，证据 `tools/distribution/reports/wave06/upgrade-rollback.json`：

| 段 | 声明 | 结果 |
| --- | --- | --- |
| A | 同源码、两个 build 身份（仅 tag 不同）的**数据往返** | PASS；明确标注“不是 schema 迁移” |
| B | 真实跨版本**数据升级**：schema-12 冻结安装物写出的状态 → 备份 → schema-13 构建恢复 → 首次启动追加迁移 | PASS：12→13，project/work/artifact 全部保留，routing 三表存在且为空（未伪造记录），旧 bundle evidence 标为 legacy format 1 |
| C | 真实跨版本**降级拒绝**：schema-13 bundle/状态交给 schema-12 构建 | PASS：restore 以 `manifest_invalid`（evidence format 2）拒绝且不创建目标；start 拒绝（`daemon_start_failed`），状态字节不变、仍为 schema 13 |

**二进制升级**本轮未交付跨版本的二进制替换/迁移矩阵：只证明“新构建能在旧数据上启动并迁移”，以及“旧构建拒绝新数据”。二进制 A→B（不同版本目录替换、端口/实例记录/进程身份）仍按 `NOT_TESTED` 处理，不得据 A 段宣称通过。

**回滚**只恢复 state 字节快照；不降级已安装二进制、不降 schema。升级后新增的用户数据在回滚到升级前备份时会消失——这是显式回滚语义，D 不会静默保留或丢弃，只有用户明确 `rollback --bundle` 才会执行，且活跃/未知 writer 仍拒绝。

## 5. 证据覆盖（schema 13）

- bundle evidence format 2：`acceptedEvents`（main 接受事务写入的 `application.candidate.accepted`，含候选/actorRef/ReviewTiming/payload digest）＋ A v13 `route_advice`/`review_evidence`/`execution_outcome`（通过公共 `RoutingEvidence` 端口只读读取）；
- `review_evidence.report_artifact_ref` 指向的 artifact 若不在 registry，**snapshot 直接失败**（`artifact_missing`），不允许把“复核报告缺失”打包成成功；
- restore 逐类重读：digest/计数/路由证据逐项比较，缺失 review artifact → `evidence_mismatch`；schema-12 bundle 走 legacy 路径，只按旧格式已记录的类比较，并要求迁移后 routing 为空；
- 未来 schema（> 当前）在 snapshot 与 restore 均拒绝 `schema_unsupported`；symlink/非普通文件 artifact、缺失 artifact 同样拒绝。

## 6. 未测与剩余阻断

- **NOT_TESTED**：跨机器、其他平台/ABI、个人 native 端到端、第二协议/复核价值、二进制跨版本替换、恢复新授权（commit）、E 独立验收。
- **main** `RECOVERY-COMMIT`：见 §3；D 的 D4 记为 `PARTIAL（inspect+prepare 已消费，commit BLOCKED）`。
- **B/main** 执行器能力/session 接口仍未以机器可读形式发布；复核入口保持实验、默认关闭，D 只用诊断 fixture。
- **E** 需要在自有 root 用同一 tar 复跑；D 不修改 E 断言。
