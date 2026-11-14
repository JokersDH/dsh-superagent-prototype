# 第二十四轮 Agent C：精确包内 consumer、A manifest 与双格式真实恢复

2026-11-14，基线 merge `233a13f`（`origin/main` `4e805de`，UI `4b42a90`；RFC 0062/0063）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
保留 wave23 source 严格结果、合法 source reuse、abort/deadline、双格式 source 与故障回归；本包补 package 分支。

## 1. 单一命令描述（C1）

`personal-review-driver.mjs` 现在只构造一个 `descriptor`：

- package：`entry=--pa-entry`（绝对路径）、`sha256=实际文件字节`、`rootArgs`、`cwd`；review/start/status/stop
  全部使用同一个 entry 与 rootArgs，输出 `descriptor.entry/sha256` 并断言 `entries.review.sha256 === descriptor.sha256`。
- source：`reviewEntry/startEntry`；package override 与 source 混用（`--pa-entry` + source、`--start-entry` +
  package）直接 usage 退出 2，不静默挑一个。

实测：0ede 包 `--pa-entry <stage>/app/apps/launcher/bin/pa.mjs` 的 entries/descriptor hash 完全一致；
默认文件存在但未执行不会被报告为 consumer。

## 2. 完整 package 身份（C2）

package 严格模式在 start 前 `pa status --json` 记录 `STOPPED/RUNNING`，start 后再次 status 并逐项断言：

| 字段 | 要求 |
| --- | --- |
| status/checks | `RUNNING`，全部 `check.ok === true`（launcher/api pid、processStart、argv、cwd、install、owner、api parent、listeners、health、mode、startup） |
| `instance.state` | realpath 等于本次 state |
| `instance.install` | realpath 等于本次 install/app |
| `mode/startupMode` | `personal` / `recovery_readonly` |
| `apiArgv` | 含 `--review-restored-scope` 且 realpath 等于本次 consent 文件 |
| review identity | 包内 `restoredReviewIdentity(file)` 摘要 = health `restoredReviewDigest` |
| pid/start | launcher pid 存活，processStart/apiPid/apiProcessStart 存在并记录 |

使用唯一 0ede 阶段包实测：fresh `verified-flow`、`identity.bound=true`、`cleanup.detail=pa-stop-verified`；
同一文件 live REUSED 保持原 launcher/pid，`cleanup.owned=false/detail=reused-left-running`；另一有效窄选择、
缺 selection 均 `BLOCKED` 且原 pid/status 不变。source 的 fresh/reuse/foreign 范围继续保留。

## 3. 停止与清理（C3）

- 自有 fresh package：`pa stop`（同 descriptor/rootArgs）后再次 `pa status` 必须 `STOPPED`、record pid 不再存活、
  start supervisor 子进程已退出，才记 `stopped:true`。
- 任何 stop 失败/超时/状态 unknown 或 pid 仍存活：`cleanup_failed`，`applyCleanupOutcome` 把原本
  `verified-flow/verified:true` 降为 `failed/verified:false`，exit 1，并保留 review 文件、state 与 cleanup detail；
  不会返回 exit 0。
- `reused` 与显式 `--keep` 分别记 `reused-left-running` / `kept-running`，不伪称已停止。
- 失败矩阵的 pure 正/反（stop 成功、失败降级、reuse、keep、observed）见 `wave23-driver-lib.case.ts`。

## 4. 统一总 deadline（C4）

`deadlineMs` 覆盖 prepare（子进程 timeout=剩余预算）、identity（子进程 timeout）、start readiness、所有 HTTP、
status 和 stop；`cleanupReserveMs` 从总预算中预留（默认 min(stopGrace+2s, deadline/4)），stop 使用总截止内剩余。
超时输出阶段化错误（`request_timeout`/`readiness_timeout`/`deadline_exceeded`/`cleanup_failed`），不会用固定
30s/10s 绕过短总限；HTTP 继续使用 AbortSignal，日志尾部上限 64KiB。

## 5. 精确包实际启动（C5）

使用 `/Users/hh/Desktop/joker/pa-artifacts/wave23-target/wave23-target-0ede11d.tar.gz`
（SHA `d039889767cb63902ed5e00d02547c441aa2313ce79555d90747e9a0b1fabf21`，source `0ede11d0…`，
install.json build `1eb8733c8b1729bc`，schema18/Node24.21/ABI137/darwin-arm64）：

- stage 解包到本次私有临时根；`first-run` 创建私有 roots；`pa review-restored` 在包内生成 0600 selection；
- driver package 实际 `pa start`（前台 supervisor）→ 真实 health/候选/history/sources/Work/native；
  business/candidate prepare 422；`pa stop` 后 status STOPPED；
- live same-file reuse：REUSED、原 pid/selection 保持；different/missing selection：BLOCKED、原实例不动；
- 包缺 release/first-run 时（source checkout）driver 输出 `NOT_REACHED` exit 4，不回退 checkout；
- 所有入口/字节由 driver 输出 entries/descriptor hash；E 仍须把 hash 与 tar subject 绑定后才算 installed。

## 6. A 真实 producer/manifest（C6）

`packages/context/tools/wave24-a-manifest.mjs` 直接 import A 当前源码
`packages/workflows/src/data-manifest.ts`（A worktree `e60e130…`，文件 SHA
`46fd1302d61329f21da3abeb327eb1b8ed0bfe897c6037e1294df9503ab0ce7e`），用 A storage 打开**本 C helper 的同一
Store**，构建 `wave24-data-manifest/1`；另一个 Node PID 用 A 源码 verify；A 的独立 reader fixture
（A dist wave24）也在独立 PID 复核同一 manifest。

同一 Store 链：真实 Work/Ticket/attempt/contract/epoch、Broker question/answer/native_applied、SDK 候选、
确认回执、context binding/frozen body；`w24-written`/`w24-unknown` dispatch intent/written/indeterminate 是
公开 Store API 记录，不是手造业务行。A builder/verifier 拒绝 foreign attempt/ticket/contract、空 commands、
空 dispatch、foreign delivery target、重复 command、foreign subject、删命令后重算摘要、错误 sourceSha/snapshotFormat。

## 7. 双格式真实恢复（C7/C8）

同一 Store 产出默认 workflow v1 与显式 v2 两份快照，各自 verify 后：

1. 将快照的 `product.sqlite`/artifacts 作为 private stage state；
2. 用 portability `createBundle`（A storage 一致快照 + 完整 manifest/hash）生成 `pa-backup`；
3. 用 `restoreBundle` 到**各自独立新根**，由真实恢复代码写 `personal-restore/1` report（非手写 marker）；
4. 用该根重新生成新 600 selection，source driver 实际 personal 启动读取：
   候选原 digest、history、sources verified、Work delivered、delivery native_applied；业务 422、held 1、
   provider 不增；两格式各自 root/consent/bundle 独立，恢复后逻辑 source fingerprint 与快照一致。

## 8. 失效与 UI 输入（C9）

wave22/23 的 fresh 独立失效矩阵保留；本轮新增损坏同长度 artifact → `unverified`（partial true/withheld 0）。
`packages/context/reports/wave24-ui-input.json` 给 main 已发布 UI（`4b42a90`）的实际后端输入与四态真实样本
（verified+validity、narrow withheld 2、missing、unverified），明确 **不再声称 UI 缺失**；C 不改页面。
原 Scope/body/receipt 守卫与 read-count 不公开、不扫描全库的边界保持。

## 9. 分层与限制

- source/package 已验证；installed 仍由 E 以同包 hash/subject 独立认证，`packageSubject` 回显不是 installed 证明。
- package 实测是 0ede stage；不认证后续新字节；旧包缺晚到能力按 `NOT_REACHED`/实际能力分层。
- 未测：长期定时撤权、并发写者竞争、B 业务 attach、private permission、target 启动；真实 vendor/native 0。
- 十二用户服务/数据、root lock 差异、历史证据均保持；仅信号本轮并证明出生的临时资源。
