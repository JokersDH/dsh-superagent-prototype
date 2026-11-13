# 第十八轮 Agent C：同一快照到第二根只读用户流程

2026-11-13，基线 `5550417`（合并 `origin/main` `f875ead`，main 运行基线 `e438ab5`）。
C 只改 context/proposals/knowledge/routing；真实模型/native 0；未写 SQL/HTTP/第二确认。

## 1. 一条真实数据链

`packages/knowledge/test/main-snapshot-second-root.case.ts` 在同一个真实 `ProductStore` 上产生：

- 本机伪 SDK 回复 → 非空候选 → `GET /v1/messages/:id/candidates` → 指针 prepare →
  `/v1/proposals/commands` 明确确认（一条真实决定）；
- 同会话 selected-context prepare/send（frozen binding + history + bundleDigest）；
- 权限问答行（`provenance: question_answer_display` + question anchor）与一条 held
  `application.execute` 队列行。

然后使用 main/A 已准入的 **workflow-snapshot/1 + workflow-evidence/1** 生成真实快照并 `verify`，
再用该快照目录启动第二根 `recovery_readonly` runtime + HTTP。

## 2. 第二根只读校验

| 读/动作 | 结果 |
| --- | --- |
| `GET candidates`（候选消息） | 200，payloadDigest 与正常根一致，`executable:false`/`authorization:'none'` |
| `GET context/history` | 200，同一 frozen entry |
| `GET messages/:id/context` 与 `/context/sources` | 200，bundleDigest 与正常根一致 |
| `GET candidates`（权限问答消息） | 非 200，权限问答不进入候选 |
| `GET /v1/decisions` | 200，恰好 1 条决定；source 确认后仍为 1 |
| candidates/prepare、proposals、context/preview、assistant context prepare/send、decisions/prepare | 全部 422 |
| `product.start()` | 抛 `unsupported_capability` |
| 原 context token 在第二根重放 | 422，旧 token 不成为新权限 |
| held 队列行、Work 数、模型请求数 | 前后不变（held=1、Work=0、0 次新模型调用） |
| `POST /v1/recovery/source/prepare|confirm` | 200，`not_granted`/`startupAvailable:false`，target 不创建，audit 等于 confirm |

## 3. 快照格式与缺件

- 公开 manifest 明确 `workflow-snapshot/1` 与 `workflow-evidence/1`；A 的 v2 兼容仍是独立依赖，
  本流程不要求 main 接受坏版本。
- 复制快照并删除 required 表 `assistant_reply_results` 后 `verify` 返回 `blocked`，缺表不会
  被当作空族放行。
- 集成提示：`ProductStore` 的 `artifactsRoot` 会在其下再拼 `artifacts/`；快照布局是
  `<dest>/artifacts/<id>`，因此第二根应使用 `artifactsRoot = <snapshotDir>`。

## 4. 决定与历史

第二根 `GET /v1/decisions` 仅作审阅数据；source 确认不增加决定、不改变 held queue、不产生 Work。
`collectContextHistory` 以 `query.workId` 复核冻结 binding：不匹配的 work 返回 0 条。

## 5. 成本

- 每条回复 1 次本地伪 SDK 调用；8 候选/3 万字符正文仍 1 次（wave-16/17 证据保留）。
- 快照只备份一次数据库并只复制注册 artifact 文件；第二根只读读取候选/历史/来源，不启动 effects、
  不重发模型、不消费 held queue。
- 610 条被排除消息触发 600 扫描边界 → preview `partial` + `conversation_scan_incomplete`（wave-17 证据）。

## 6. 命令与结果

```
context 124 · proposals 41 · knowledge 97 · routing 44（全部 pass）
wave15 4/4 · wave14 6/6 · wave13 6/6 · wave12 8/8 · wave11 17/17
wave18 C-only wrapper 4/4；wave18 A-format probe 0/2（A 侧 v1 摘要兼容，A-owned）
strict/exactOptional 全链 build 通过
```

## 7. NOT_REACHED / owner

- A 的真实旧 v1 非空 binding 摘要兼容（`probe-wave18-context` 的 A 半）：A-owned，本流程改用
  main 当前已准入 v1 格式完成第二根用户流程，不重标 A 的格式结论。
- main 私有启动许可、target 激活、native/value：分层未交。
- 真实 Broker 问答：native/model 0，无法产生真实 native question；本轮用同一 Store 的
  `question_answer_display` 持久行验证“权限问答不可重用”，不宣称 Broker 问答恢复。
- C 的 module-only 导出（relevance/projectSourceReview/collectContextHistory）仍非 main HTTP 投影。
