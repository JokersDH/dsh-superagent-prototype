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
