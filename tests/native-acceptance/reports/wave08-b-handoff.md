# Agent B 第八轮交接：运行时诊断、资源事实与单一发送路径

日期：2026-11-11。branch `codex/g1-runtime`｜base `5d4065b`｜merge `ee247f0`｜检查点 `b4388ff`｜本批见 §7。**全包真实模型发送 0。**

权威状态：[wave08-status.json](wave08-status.json)。上一轮交接（`wave07-b-handoff.md`、`wave07-b4-bound-dossier.md`）保留不覆盖。

## 1. 诊断从 tests 目录迁入生产包（B1）

`packages/driver-kit/src/runtime-diagnostics.ts` 现在是唯一的运行时描述来源；`tests/native-acceptance/runtime-diagnostics.mjs` 退化为**薄格式化器**。main/D 直接 import 包导出，不再把 tests 里的 JSON 当运行权威。

三条防过度承诺的规则：

| 规则 | 实现 |
| --- | --- |
| 绿灯只由**实测身份**推出 | 缺二进制/摘要不可读/平台未探测 → `usable=false` 并给原因，不降级为"应该没问题" |
| 可用性按**观测到的身份**判定，不按脱敏后的投影 | 否则每个安全描述都会看起来不可用 |
| 隐私默认关闭 | 公开投影不含 home/store 路径；`includePrivate` 才给全量；两种形态摘要一致，main 可安全比较 |

计费准入是**独立标志**：`turn_budget_field`/`pricing_surface`/`native_control` 保持 absent/untested，所以执行器可用但 `billableAdmitted=false`。`untested` 永不渲染成 `supported`，调用方自报的 capability 也不能单独开计费。

## 2. 当前资源查询（B2）

`packages/execution/src/resource-facts.ts`，复用既有 `RunnerInspection` 形状，**没有另造 DTO、没有改共享 schema**。

显式点名并拒绝 7 类无效推理：旧 attempt ended、PID 缺失、他机签名、错范围、失联、新 state/代际、过期证明。

保守性：**任一 unknown 或 possibly_active 就让整组未决**；无观测时永不放行。只有「完整覆盖 + 机器绑定 + admission 已关 + 端点正常 + 证据可审计」才能到 `verified_quiescent`。

## 3. 控制/恢复失败窗口（B3）

`b11-control-windows.mjs`，11 例（10 PASS + 1 NOT_TESTED），用真实 `AttemptSupervisor` + 真实 resource-facts + `packages/testing` 权威 fixture：

新增窗口：同 ID 重放、幂等键复用、不超越持久绑定的 start 被拒、attempt id 复用被拒、旧 epoch command id 不同于新 epoch、部分覆盖关闭屏障、活跃 writer 阻断、新 state 不释放、indeterminate 不衰减为 stopped。

**过程中修正了两处我自己的错误认知**：

1. **幂等契约是「键稳定」不是「只发一次」**——supervisor 故意复用同一 command id，去重是 Runner 的职责。断言改为测键稳定性，并在注释里写清归属。
2. **跨进程 epoch high-water 需要 core/storage 的持久存储**，不属于本角色，记为 **NOT_TESTED** 而不是声称已覆盖。

## 4. B/E 单一发送路径（B4）

**修掉的真实缺陷**：旧 `admit()` 固定审 `wave03-b-native`/4，而 E 的 guardedSend 自己 spawn CLI——两条链，E 看到的拒绝不是 B 证明过的拒绝。

新 `packages/driver-kit/src/send-admission.ts`：

- **调用方必须显式提供完整 grant 身份**（grantId/owner/limit/ledgerPath），没有任何角色默认值
- 授权是 `admitSend` 签发的**活对象**；字符串 descriptor、结构相同的伪造对象一律拒绝
- 拒绝结果 `token=null, launch=null`，**不挂任何可执行函数**
- 预留钩子在消费 token 前调用；钩子拒绝或抛异常 → 传输层根本不被调用
- 缺失的 gate 是拒绝而非空槽

**测试抓到的真 bug**：缺失 gate 只设了 state 却没记入 problems，导致**空 `gates` 对象会放行一次发送**。已修并覆盖。

`runtime-admission.mjs` 也已改为要求显式 grant（新增 `B9-GRANT-REQUIRED` 案例）。

## 5. 交给 main/D/E 的运行态消费清单（B5）

四个状态必须分开呈现，不能合并成一个"能跑"：

| 状态 | 当前值 |
| --- | --- |
| 可用执行器 | **是**（身份解析成功、宿主强制可用） |
| 当前未准入复核 | **是**（cost_bound + UNKNOWN 余量阻断计费） |
| 真实控制未测 | **是**（原生 stop/answer/steer 从未执行） |
| 资源待核对 | **是**（无当前、同机、完整覆盖证据时屏障保持关闭） |

发行物校验能解析 exact executable 与依赖摘要；**不读取作者账号、凭据或会话内容**。模式（personal/fixture）由 D 拥有，本模块从不把 fixture 呈现为 personal。

## 6. 保留的结论

`NO_SUPPORTED_BOUNDED_RECIPE` **原样保留**，本轮**没有重复**协议/goal/价格调查（[wave07-b4-bound-dossier.md](wave07-b4-bound-dossier.md)）。`wave03-b-native` limit4 余量仍 UNKNOWN、不可花；E 的 pilot grant 未被触碰。

## 7. 验证与实际命令

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --test packages/driver-kit/test/{runtime-diagnostics,send-admission}.test.ts` | 0 | 28/28 |
| `node --test packages/execution/test/resource-facts.test.ts` | 0 | 18/18 |
| `node tests/native-acceptance/b9-runner-admission.mjs` | 0 | 17/17；admission REFUSED |
| `node tests/native-acceptance/b11-control-windows.mjs` | 0 | 10 PASS + 1 NOT_TESTED |
| `node tests/native-acceptance/b7-pilot-transport.mjs` | 0 | 14/14（回归保持） |
| `node tests/native-acceptance/b3-production-stop.mjs` | 0 | 6/6（回归保持） |
| `node tests/native-acceptance/b4-recovery.mjs` | 0 | 3 PASS + 1 NOT_TESTED（回归保持） |
| `node --test …/{ledger-audit,pilot-runner,cost-preflight}.test.mjs` | 0 | 41/41（回归保持） |
| `node tests/native-acceptance/runtime-diagnostics.mjs` | 0 | 可执行器 YES / 计费 NO |

## 8. 未测范围（NOT_TESTED，不夸大）

- 真实 vendor turn start/stop/提问/steer/未知发送核对——**从未执行**
- 跨真实重启的进程级 epoch high-water——需要 core/storage 持久存储
- goal 预算是否在首轮推理前硬检查、真实计费金额

受控证据 ≠ 原生兼容证据；fixture 永不当原生结果。

## 9. 下一消费者步骤

- **main**：从拥有的包 import `describeRuntime`/`describeResourceFacts`/`admitSend`；**显式传调用方的 grant**；把拒绝当受支持答案，不要用字符串 descriptor 去解锁。
- **D**：用 `describeRuntime` 取 exact executable/profile 事实，personal/fixture 模式由你显式拥有；模块不携带任何凭据或账号 home。
- **E**：走唯一 send 路径，提供持久 reservation hook 与完整 grant；**没有 CLI 退路**。
