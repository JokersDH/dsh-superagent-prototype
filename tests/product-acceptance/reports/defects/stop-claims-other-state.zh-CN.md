# D 缺陷：单安装多 state 时 stop 误杀另一 state

- 拥有者：Agent D（launcher/安装）
- 发现：Agent E，第十轮 E4-MULTI-STATE
- 目标字节：wave09-target-6830e38（buildId `f2390ffd1b87b79a`，schema 15，source `6830e38c`）
- 状态：确认 FAIL，installed-alpha 不得放行

## 最小复现

使用同一份冻结 install 和同一个 `--config-root`，两个不同 `--data-root`：

1. `pa start --fixture --data-root data-a --port A1 --api-port A2`
2. `pa stop --data-root data-a`（正常停止 A）
3. `pa start --fixture --data-root data-b --port B1 --api-port B2`
4. `pa stop --data-root data-a`（针对已停止的 A）

第 4 步期望：拒绝/未找到，且不得触碰 B 的进程。
实际：退出码 0、`status: STOPPED`；`instance.json` 记录的是 `data-b`；B 的 API 进程被杀，B 的 launcher 仍存活。

## 观测

```json
{
  "exit": 0,
  "bPid": 52576,
  "bApi": 52592,
  "bAlive": true,
  "bApiAlive": false,
  "bApiPort": 9112,
  "apiOpenBefore": true,
  "apiOpenAfter": false,
  "recordedState": ".../data-b",
  "recordedPid": 52576,
  "reportedStatus": "STOPPED"
}
```

## 影响

- 常驻单实例记录未绑定 data root，`stop --data-root A` 选择了最后写入的 B 实例。
- 结果是跨 state 误杀 API，而不是拒绝；同时 launcher 未退出，状态自相矛盾。
- 因为 B 的 API 已被上一步杀死，launcher 死/API 活窗口无法在本轮测量（该子步骤记为 NOT_TESTED，不作为 PASS）。

## 修复要求

1. `instance.json` / 身份校验必须绑定精确 data root（state 路径、pid、start、argv、cwd、端口）。
2. `stop --data-root A` 在记录属于 B 时必须拒绝，且不得向 B 的 launcher/API 发送信号。
3. 修复后用同一 install 重跑 E4-MULTI-STATE，并补 launcher 死/API 活与 PID/start reuse 窗口。

E 只记录证据，不修改 launcher；旧安装结果不因本轮修复而改标签。

## 第十一轮复测（当前 D 冻结字节）

- 目标：wave10-target-cf7a3cf / build `da2d78d126e4745f` / schema 15 / source `cf7a3cf`
- 结果仍为 FAIL：`stop --data-root A` 退出 0/STOPPED，record 属于 `data-b`，B 的 API 被终止（apiOpenBefore=true → apiOpenAfter=false），B launcher 存活。
- 由于该步骤已杀掉 B 的 API，launcher 死/API 活窗口本轮保持 NOT_TESTED，未用删除 record 或其他人工方式补窗口。
- D 源码 `fe01c3c` 的 `apps/launcher/lib/stop.mjs` 仍只校验 record 自身，未比较调用者 requested data root；本轮未使用用户九组实例。

## 第十二轮 a22d3a4 schema16 复测

- 目标：wave11-target-a22d3a4 / build `3311a04bd20ed7f9` / schema16 / source `a22d3a4`
- requested data-root stop：`E4-MULTI-STATE` 通过；针对 state A 的 stop 不再认领 state B。
- 但 copied record：把 `var/config/instance.json` 复制到另一 config root 后执行 stop，退出 0 并停止了原 API（`E7-OWNERSHIP-COPY` FAIL）。该 tar 的 record 无 configRoot，stop 只校验 state/install，未把调用者 config 绑定纳入权威。
- D 源码 `020af82` 已声明继续修 config/共享路径所有权；本轮未运行真实全局 stop 矩阵，只用本进程 spawn 的单实例与复制 record 验证。
