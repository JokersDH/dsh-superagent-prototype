# 第二十五轮 Agent C：完整身份 gate、A 清单驱动的同包双格式审阅

2026-11-14，基线 merge `f72cf95`（`origin/main` `11002b8`，main 试用 readiness `fdb3f16`；RFC 0064/0065）。
C 仅改 context/proposals/knowledge/routing；真实 vendor model/native 0；未改 UI/HTTP/SQL/root lock/E 断言。
wave24 的真实 A 模块调用、独立 reader、两次真实 restore、精确 0ede 包正向与 source/cleanup 回归保留。

## 1. package 必需身份 gate（C2/C4）

`validatePackageIdentity`（`driver-lib.mjs`）成为唯一判定，缺一不可：

| 必需 | 内容 |
| --- | --- |
| 进程 | `pid`、`processStart`、`apiPid`、`apiProcessStart` 均为正整数/非空 |
| 根 | `state`、`install`、`configRoot` 非空且与本次参数一致 |
| 模式 | `mode=personal`、`startupMode=recovery_readonly`、`apiURL` 端口一致 |
| 选择 | `apiArgv` 含 `--review-restored-scope` 且指向本次 consent；`launcherArgv` 含 `start` |
| checks | 15 个必需 id 全部存在且 `ok:true`（launcher_alive/process_start/launcher_command/owner/cwd/install_identity/api_argv/api_process_start/api_owner/api_parent/api_cwd/listeners/health/runtime_mode/startup_mode） |
| health | `restoredReviewDigest` = 包内 `restoredReviewIdentity(file)` |

`bound` 仅在这些全部通过时为 true；缺 pid/APIstart、空 checks、start/root/config/review 漂移、
api_process_start 检查失败都准确 `package_identity`，不会继续 verified。单元负例逐项删除/改变每个字段；
真实 0ede 包完整正向保持。

## 2. descriptor 与 cleanup（C3）

review/start/status/stop 共用同一个 `--pa-entry`/rootArgs/cwd，输出 `descriptor.sha256` 与
`entries.review.sha256` 必须等于执行字节；冲突 override（source+pa-entry、package+start-entry）usage 退出 2。
自有 fresh package 的 stop 必须：CLI STOPPED + 再查 status STOPPED + record pid 消失 + supervisor 退出；
否则 `cleanup_failed` 降级 verified 为 failed、exit 1、保留 review/state 材料。reuse/keep 不停止且不冒充 stopped。

## 3. A 清单驱动同一 driver（C5–C8）

新增 driver 参数（同一执行、不是第二个测试 wrapper）：

```
--a-worktree <A> --a-module <A>/packages/workflows/src/data-manifest.ts
--manifest-db <original>/state.sqlite --manifest-expectation <json>
--manifest-output <json> --root-map <original-root>=<reviewed-state-root>
--replay-context-token <original> --replay-confirm-token <original>
```

driver 在启动 consumer **之前**用 A 源码/存储构建 `wave24-data-manifest/1`，并校验：

- 协议、manifest digest、`coverage` 五项全 complete；
- `subject.dataRoot` 与 manifest DB 所在原根一致，并与 `--root-map` 的 from 一致；
- root-map 的 to 等于本次实际 reviewed state realpath；
- HTTP Work id/question id 必须来自 manifest（调用者给不同 ID 即 `manifest_mismatch`）；
- HTTP deliveries 与 manifest.deliveries 的 `targetBindingId:status` 集合一致；
- 原 context/confirm token 重放必须 422，provider 不增。

A 模块当前来自 A worktree（HEAD/文件 SHA 记录在输出 `data.manifest.aHead/aModuleSha256`）；expectation
由生产链提供，不由待验 manifest 自造。

## 4. 同包双格式恢复与读取（C9–C12）

同一 Stores 产出 default workflow v1 与 explicit v2，各自 verify；每份快照经 portability
`createBundle`/`restoreBundle` 到独立新根（真实 `personal-restore/1` report，非手写 marker）。对**同一个精确
0ede 包**分别：

1. `pa review-restored` 生成各根 600 selection；
2. driver package 启动（前台 supervisor），完整 identity + manifest（格式 1/2 各自 expectation）；
3. 读取同 Store 原 Work/question/answer/native_applied、SDK 候选与 frozen 正文；业务/候选 prepare 422；
4. 合法窄 scope：sources `scope_changed`、正文空、`selection_narrowed`、candidate 不可读、业务仍 422；
5. 原 context/confirm token 重放 422；
6. `pa stop` 后 status STOPPED，held queue 与 provider 不变。

两格式各自 root/consent/bundle/consumer 字节独立记录；source 与 package 结果分开，不以 source 两格式加
package 单格式拼成 whole。installed 仍由 E 独立绑定 tar/subject 判定。

## 5. 时限/故障（C13）

总 `deadlineMs` 覆盖 prepare、identity、start、HTTP、status、stop；cleanupReserve 预留；每请求 AbortSignal、
64KiB 日志尾部、manifest/response 有界。故障控制：连接不响应/半 JSON/早退/readiness 超时/stop 失败/进程替换。
本轮在测试子进程设置 `NODE_OPTIONS=--no-network-family-autoselection` 规避本机 Node/undici
`setTypeOfService EINVAL` 环境崩溃；这是运行环境 workaround，不是产品权限或稳定性声明。

## 6. 工具 API 与输出（C14）

`personal-review-driver/2`：

| status | exit | 语义 |
| --- | --- | --- |
| verified-flow | 0 | 身份 + 全部断言 + 需要时 manifest 全通过 |
| reused | 0 | 同文件合法复用，原 pid 保持 |
| refused-verified | 0 | 入口按请求原因拒绝 |
| observed | 0 | `--observe` 仅观测，`verified:false`，永不验收 |
| NOT_REACHED | 4 | 包缺能力，无 checkout 回退 |
| failed | 1（usage 2） | assertion/identity/manifest/deadline/cleanup 失败 |

输出固定字段：descriptor、entries(SHA)、review、health、identity(pid/start/apiPid/apiProcessStart/state/install/
configRoot/bound)、budgets、data.manifest/roots/ids、cleanup(owned/stopped/error/materials)、failure(code/detail)。

## 7. UI 输入与外部消费者（C15）

main `4b42a90` 已实现来源诊断 UI；F 新 trial 子树只作展示消费者，C 不编辑 console。`wave25-ui-input.json`
提供四态/七 reason/partial/withheld 真实样本与实际输入；禁止 readable count/raw path/principal/token 外泄。
D/E 可用本文档的安装根、命令、tar SHA/source/build/schema 与 entries hash 复现；G/H/F 的成功展示不是授权。

## 8. 分层与限制

- source、package（精确 0ede）、installed 分开；`packageSubject` 回显不构成 installed。
- normal/recovered：只读 snapshot 恢复；B 业务 attach、private permission、target 未测。
- 长期撤权、并发 writer、48h soak 未测；实际包升级/rollback 矩阵不在本包。
- 十二用户服务/state/profile/tar/ledger 与 lock 差异保持；仅本轮证明出生资源被信号。
