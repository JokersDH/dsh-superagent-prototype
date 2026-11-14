# 查看 readiness（只读）

`GET /v1/readiness` 是 main 已发布的鉴权接口（`trial-readiness/1`，见 0064）。它只报告**配置事实**：模式、启动模式、讨论/执行配置、项目与 profile 计数、少量功能开关。`authorization` 恒为 `none`。

它不报告包 build/source，也不授权执行、私有 grant 或 target 激活。

## 两种用法

1. **可复现正向（无外部实例）**：

```bash
node tools/trial-kit/bin/trial-machinecheck.mjs --install <安装目录> --readiness-fixture --out <新目录>
```

`--readiness-fixture` 在本进程启动已知 fixture，只验证客户端、schema 和报告链路；报告写 `(fixture)`，不能当产品实例的观察。

2. **真实实例（显式地址 + 你自己的 token）**：

```bash
node tools/trial-kit/bin/trial-machinecheck.mjs --install <安装目录> \
  --readiness http://127.0.0.1:<api-port> --token-file <你的 0600 token> \
  --max-observation-age-seconds 300 --out <新目录>
```

约束：

- 只接受 `127.0.0.1`、`::1`、`localhost` 字面地址；不搜索端口/socket，不猜测服务地址；
- token 只来自显式 0600 文件或显式环境变量名；不读取 `~/.codex` 或其他实例凭据；
- 单次 GET，无 query，无重定向，5 秒 deadline，256 KiB 上限；
- 响应必须通过严格 schema。未知字段、缺字段、`authorization != none`、readonly 不变量不满足都拒绝。

## 期望与拒因

| 检查 | 说明 |
| --- | --- |
| `readiness.http_status` | 只有 200 是观察成功；401/500/3xx 都是失败 |
| `readiness.schema_valid` | 未知字段/缺字段/不变量失败都拒绝 |
| `readiness.authorization_none` | 任何非 `none` 都是问题 |
| `readiness.observation_fresh` | 需显式 `--max-observation-age-seconds` |
| `readiness.expected_subject` | 需显式 `--expect-configuration-revision/--expect-mode/--expect-startup-mode` |
| `readiness.deadline` | 客户端自己的 deadline，不是无限等待 |
| `readiness.package_binding` | 恒为 `UNKNOWN`：readiness 不含包身份 |

`configuration_present` 只表示配置事实，不能渲染成“连接已验证”“原生任务必成功”或“发布通过”。fixture 显示 `fixture_only`；旧配置缺证据显示 `unknown`；恢复只读会清空 dispatchable/admitted 计数并关闭决定/提案写能力。

## 失败时的处理

- 401/403：确认地址和 token 属于你自己的实例；不要复用别人的；
- schema 拒绝：先看具体 issue path，不要放宽 schema；
- 过期观察：重新读取或增大窗口，但不要把旧观察当当前状态；
- 跨 subject 不确定：显式提供 `--expect-configuration-revision`，不要用“看起来一样”判断。
