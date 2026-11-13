# 第二十三轮 Agent C：可信参数化审阅驱动与同数据双版本流程

2026-11-13，基线 merge `2ffa687`（`origin/main` `f29c9e6`，main 普通发行 `8c8fdef`；RFC 0058/0060/0061）。
C 只改 context/proposals/knowledge/routing；真实 vendor model/native 0；未写 SQL/HTTP writer/UI/根 lock/E 断言。
本包不重修已过的 scopeReview 与双格式结果，而是把唯一 driver 变成**有断言、有身份、有期限**的复用工具。

## 1. 唯一 driver 的输出协议（C1）

`packages/context/tools/personal-review-driver.mjs`，协议 `personal-review-driver/2`：

| status | verified | 退出码 | 含义 |
| --- | --- | --- | --- |
| `verified-flow` | true | 0 | 严格断言全部通过，且绑定了本次实际 serving consumer |
| `reused` | true | 0 | 合法 REUSED：原 PID/record/health digest 与本次 selection 一致，未停止原实例 |
| `refused-verified` | true | 0 | 入口按请求的 selection 不匹配/path 原因拒绝，未启动或替换实例 |
| `observed` | false | 0 | `--observe` 只收集数据；`assertions=[]`，**不是验收** |
| `NOT_REACHED` | false | 4 | 选定包缺该能力（如无 release）；绝不回退 checkout |
| `failed` | false | 1（usage 2） | 断言、身份、HTTP、deadline 或清理失败，`failure.code` 精确 |

旧 wave22 输出 `status:ok` 已废弃；E 不应把退出 0 都当成行为通过，必须读 `status/verified`。

## 2. 严格断言（C2）

默认严格流程逐项断言，任何一项改变都会非零退出并给出 `failure.detail.expected/actual`：

| 项 | 默认期望 |
| --- | --- |
| `GET /v1/context/history` | 200 且 entries 非空；指定 `--message` 缺失即失败 |
| sources 默认 | 200、无 `scopeReview`、state 与 `--expect-source-state` 一致 |
| `?scopeReview=1` | protocol/authorization/partial/withheld 与权威 state 一致，reasons ⊆ 实际、≤7，withheld ≤64 |
| 候选 GET | 200、`executable:false`、`authorization:none`；`readable` 时必须有候选且 digest 匹配 |
| 窄选择候选 | `candidates:[]` 且 `rejected[0].reason` 默认 `scope_escalation` |
| candidate prepare / chat | 默认 422（可显式改期望） |
| Work | 200 且 phase 默认 `delivered`；ID 不存在失败 |
| deliveries | 必须含默认 `native_applied`；空列表失败 |

负向校准：只把 chat 期望改成 200、Work phase 改成 `running`、delivery 改成 `accepted`、digest 改错、
work ID 改成不存在，均退出 1 且 `failed/assertion_failed`；真实正向保持 0。

## 3. 期限、早退出与清理（C3）

- 每请求 `--per-request-ms`（默认 5000）与总流程 `--deadline-ms`（默认 180000）共同约束；
  readiness 另受 `--readiness-ms`。超时是 `request_timeout`/`deadline_exceeded`，不会无限等待。
- readiness 每轮先检查子进程 error/exit；入口早退立刻 `entry_exited`（含 exit code 与有界日志尾部）。
- stdout/stderr 只保留尾部 64KiB（`logSink`），不无限累积。
- 清理只针对本次 spawn 的 child：SIGTERM `--stop-grace-ms` 后一次 SIGKILL，仍不退则 `cleanup_timeout`；
  合法 REUSED 不停止原实例；`--keep` 明确留下并记录 `kept-running`。
- `wave23-driver-lib.case.ts` 用私有正对照验证：连接但不响应→`request_timeout`；半 JSON→`invalid_json`；
  入口 exit 3→`entry_exited`；永不 ready→`readiness_timeout`；忽略 SIGTERM→一次升级 SIGKILL；
  已过期 deadline→`deadline_exceeded`；日志只留尾部。

## 4. 本次 consumer 身份绑定（C4）

严格模式不只信任“端口上有 personal health”：

1. 用包内 `restoredReviewIdentity`（子进程 import 该包文件）计算本次 consent 的 64-hex digest；
2. 解析 source `state/workbench.json` 或 package instance record：`pid` 必须是本次 spawn 的入口进程
   （fresh），digest 必须等于本次选择，mode 为 personal，apiURL 端口等于请求端口；进程仍存活；
3. `/v1/health` 必须 `mode=personal`、`startupMode=recovery_readonly`、digest 与本次选择一致；
4. 输出 `identity.bound` 与 `identity.recordPid/childPid/stateRoot/actualHealthDigest`。

实测：fresh v1/v2 `bound:true`；test 自行启动的 workbench 同文件 REUSED `bound:true` 且原 PID 不变；
另一有效窄 selection、不同 state、缺 record/外来 ready 端口均被拒绝（`refused-verified` 或 `failed`），
原实例不被停止。旧服务无 record 时保持未绑定，不冒充本次启动。

## 5. 两种 dialect（C5）

| dialect | review | start | 身份来源 | 输出/退出 |
| --- | --- | --- | --- | --- |
| `source` | `tools/dev/review-restored.mjs --output` | `tools/dev/start.mjs --state --port --api-port --discussion-only --review-restored-scope` | `state/workbench.json` + health | 上述 status/退出 |
| `package` | 包内 `pa review-restored --json --out` | 包内 `pa start --json ...` | package instance record + status | RUNNING/REUSED 严格断言；BLOCKED 缺 release/first-run → `NOT_REACHED` 退出 4 |

本轮 source main 的 package dialect 实测：`pa review-restored` 真正生成 0600 文件（projects=[`wave22-project`]）；
`pa start` 因该 checkout 无 release/first-run 返回 `release_missing`/`first_run_required` 族 → `NOT_REACHED`，
driver 明确 `dialect:package`、`sourceOnly:false`、entries 指向 `pa`，**没有**回退 checkout demo。
精确安装根由 D 提供；若入口不接受上述参数，driver 以明确失败/NOT_REACHED 退出，不寻找任意脚本。

## 6. 同 Store 原始数据流程（C6/C7）

`packages/knowledge/test/helpers/personal-chain.ts` 用同一 producer/Store 产生：

| A 数据 | HTTP/字段 |
| --- | --- |
| 受控 Work/Ticket | `GET /v1/works/:id` → `phase:delivered` |
| Broker question/answer | `GET /v1/questions/:id/deliveries` → `native_applied` |
| SDK 候选 | `GET /v1/messages/:id/candidates` 原 `payloadDigest`、`executable:false` |
| 确认回执 | 原 proposal token 重放 422（wave22 实测） |
| context binding/frozen 正文 | history 1 条、sources `verified`、audit `bundleDigest` 相同 |
| 队列 | held 1，provider 请求数不增 |

同一 Store 的默认 v1 与显式 v2 快照分别恢复到**独立新 root**、各自 600 同意文件，均通过 source 标准入口
`verified-flow`；不混用 personal-evidence/bundle 协议，也不拿 evidence 版本替代真实恢复。

## 7. 独立失效与成本（C8）

保持 wave22 的独立 fresh 正对照矩阵：source/marker/signature/stateRoot/machineDigest/principal/
scope/expiry/文件类型/缺文件各自单独失效；窄选择仍合法启动但正文 `scope_changed` 隐藏；缺 artifact
→ `missing`；损坏 artifact 字节（同长度）→ `unverified`（`partial:true`、withheld 0、无正文）。
诊断不填 readable count、不遍历全项目、不跨 await 持事务；原因 ≤7、withheld ≤64、响应 <4KiB。
未测：长期定时撤权、并发写者竞争时刻。

## 8. 给 main 的 UI 输入（C9）

`packages/context/reports/wave23-ui-contract.json`（v2）含四状态文案/徽标、七 reason 中文说明、
partial/withheld 渲染与禁止项，以及**真实返回样本**：

- verified+validity：`reasons:['selection_validity_changed']`, partial false, withheld 0
- narrow：`['selection_narrowed','selection_validity_changed']`, partial true, withheld 2
- missing：`['selection_validity_changed']`, partial true, withheld 0
- unverified：`[]`, partial true, withheld 0

全部 `authorization:'none'`；不向 UI 提供原始路径/principal/token/readable count。UI 由 main 实施。

## 9. 限制与分层

- 未运行 D launcher 真实安装；package dialect 的 start 在 source main 为 `NOT_REACHED`（准确缺能力）。
- 恢复仍是真实 v1/v2 库/artifacts 复制 + marker，不是完整安装/升级矩阵；未测长期稳定性与并发写。
- 无 private permission、target 启动、队列消费、B 业务 attach 或 vendor native；`observations` 不冒充验收。
- source 通过不认证旧包；E 必须把 driver 的 entry SHA 与所在包 subject 绑定后才可标 installed。
