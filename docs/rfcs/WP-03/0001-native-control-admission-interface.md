# RFC WP-03-0001：原生控制、准入与恢复的公开接口（product-wave-03 B1）

- 日期：2026-11-10。状态：**实施约定**（Agent B 提议，主线维护公共 schema）
- 基线：`origin/main` `c3f018e`（环境产品已可用）；实现在 `apps/runner/`、`packages/drivers/codex-native/`
- 本轮不改 contracts v1 语义；下文出现的 Port 均为**进程内 TypeScript 接口**，不是新的 wire schema

本 RFC 把 coordinator 需要的 port、当前绑定、原生能力与失败/未知状态一次写清，避免为第二执行器重复搭框架。

## 1. 控制面（既有，保持语义）

| Port | 方法 | 不可让步的语义 |
| --- | --- | --- |
| `RunnerHost` | `launch(spec, driver)` | 一个 attempt 一个宿主；重复 launch 拒绝 |
| `AttemptIO.commands` | `begin`/`deliver`/`answer`/`cancel`/`pause_at_boundary` | `begin` 恰一次；预启动队列允许，但**不得**在已结束后再喂 |
| `FactSink.record(fact)` | 返回 `DurableReceipt` | 只有 `{persisted:true, factId: 同 fact}` 才是 ACK |
| `AttemptRunner.stopPhysical(deadline)` | 返回 `Quiescence` | `confirmed` 仅当**可信资源清单**全部静止 |

`Quiescence = 'confirmed' | 'indeterminate' | 'unknown'`。**native ACK、leader 退出、UI phase 变化、监听端口数都不产生 `confirmed`。**

## 2. 准入事实（本轮新增的显式状态）

准入判断需要的输入：

| 事实 | 来源 | 失效条件 |
| --- | --- | --- |
| profile 版本与 executable 摘要 | catalog probe | 二进制或版本变化 |
| config fingerprint | 准备流程 | 配置被改 |
| permission policy revision | profile | policy 改变 |
| environment receipt | 环境准备（A） | workspace/manifest/lock 漂移 |
| attempt/epoch/contract 绑定 | `AttemptSpec` | 任一不匹配 |

`inspection_passed` **不等于**原生准入；`native_test_passed` 才能进入原生 dispatch，且版本变化**不能继承**旧准入。

## 3. 失败与未知状态分类

| 类别 | 表现 | coordinator 应做 |
| --- | --- | --- |
| 合法业务拒绝 | 200 + `rejected` receipt 或 `AppError.code` | 展示原因，**不重试** |
| schema 400 | HTTP 400 | 视为调用方缺陷，修正输入 |
| 未知发送 | 无回执 | 先 `reconcile`，**不得**用新 commandId 重派 |
| writer 未知 | `indeterminate`/`unknown` | 阻止新 begin，保留 inventory |
| 观察失败 | `unobservable`（ps 失败/溢出） | **不得**当作"无成员" |

## 4. 恢复面

`RecoveryRunnerPort`（`apps/coordinator/runner-link.ts`，主线所有）：

- `inspect()` → 完整 owned inventory + `admission`
- `cancel(cmd)` → **先**关闭准入，再尝试停止
- 恢复**永不**产生 `begin`/`deliver`/`answer`（端点无此类路由）

## 5. 本轮不做的

- 不为第二执行器新建框架；conformance 以现有 `AgentDriverV1` 为唯一接口
- 不新增私有 wire 类型；若 UI 需要原生能力矩阵，由主线在公共 schema 派生
