# 原生运行时复核交接

日期：2026-11-09。分支 `codex/g2-execution-integration`，继承主线基线 `98dfbc9`，复验时 HEAD `cef31c4`。本包按主线集成窗口在 primary checkout 完成，没有修改 A/B 原 checkout，没有提交、暂存或推送其他人的工作。

当前源码尚包含主线集成中的未提交修改，不能只凭 HEAD 定位测试源码。七个运行时相关目录的完整源码指纹为 `02ebd8c2e52d09353f502f4b164ef54c6ab4ef53bae76f28f856c1268d6e1c74`，计算规则和文件数由 `scripts/check-native-runtime.mjs` 给出；报告目录、依赖目录、构建产物不参与该指纹。

## 已交付

- `codex-native/src/protocol.ts` 使用标准 JSON source reviver 保留请求和 resolved.requestId 的 int64 数字，回复仍序列化成数字，不改成字符串；普通字符串 ID 与等值整数保持独立。拒绝伪造对象 ID、超出 int64 的数字和缺少 result/error 的响应。客户端请求、历史记录和通知积压有容量/超时边界，关闭时清理等待者。
- `codex-native/src/native.ts` 对每个命令重新检查完整 attempt/epoch/合同；拒绝错误问题 ID、版本、原绑定和不完整表单。使用共享的 `parseQuestionAnswer`，保留原生澄清选项并将字段映射回原 question ID。终态和请求带有当前 thread/turn/item 身份，未知终态不成功。
- 提前到达的 `turn/completed` 会等待 turn/start 的实际返回身份，不能再因 ACK 先后顺序丢失。答案必须先取得 Broker 写入许可，只有对应 `serverRequest/resolved` 才生成 native_applied；写入事实先于应用事实，重复 resolved 不重复记应用。
- `runner-service.ts` 在关闭准入时拒绝未决写入许可/回执/payload 等待者，晚到许可不能重新开启业务；关闭后不再挂起新的事实回执。
- `process-host.ts` 保留已确认的原资源静止证据，重复 stop 不会因句柄已移除而退化成 unknown，也不会再发信号。
- `recovery-endpoint.ts` 对长 macOS TMPDIR 使用稳定的私有短 socket 目录引用，仍复用唯一的 protocol-v1 实现和认证 proof WeakMap。64 字节 credential、完整身份核对和原 stop/barrier 条件均保留。
- 节点端 canonical helper 从 `@personal-agent/contracts/canonical` 导入，避免根 barrel 把 node:crypto 带到浏览器。

本轮没有新增模型 turn。主线最初的真实编码闭环由主线另行验收；本包的可重复测试全部使用协议/进程 fixture，原生安全检查调用本机 Codex，但只运行 command/exec，不创建模型 turn。

## 实际验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `node apps/runner/scripts/check-native-runtime.mjs` | PASS，262/262 | `runtime-regression.json`、`runtime-output.txt` |
| 独立入口、生产 Driver 和新增测试的 strict TS | PASS | `typecheck.json` 中的完整命令 |
| `node apps/runner/scripts/probe-native-safety.mjs --execute-local-probe` | PASS，3/3，0 模型 turn | `native-safety.json` |
| 拥有路径 `git diff --check` | PASS | 命令退出 0 |

262 项由 Runner、Codex 两条协议适配路径、DriverKit、Execution、Testing、Catalog、Policy-preparation 共同组成。新增生产 Driver 14 项，单独覆盖真实输入 ref、策略先于 begin、早到终态、大整数 ID、等值字符串/整数 ID、错误问题/attempt/合同、写许可拒绝、澄清选项/必填表单、网络开启的策略拒绝、异 thread/turn 和未知终态。新增写入许可端口 3 项，覆盖正确许可、拒绝、关闭后迟到许可；另新增长临时目录及协议错误边界回归。

原生安全探针只操作自己创建的私有临时目录：一条命令写工作区成功，一条写其外部私有路径失败且文件未创建，再启动一个真实 managed command 子进程，停止后确认 PID 消失且文件不再增长。原生版本为 `codex-cli 0.164.0`。无账号文件读取、无全局配置修改，stderr 仅记字节数。

## 依赖与消费

由主线统一更新 root lock：Runner 新增 `@personal-agent/drivers-codex-native: workspace:*`；Codex package 新增 `@personal-agent/policy-preparation: workspace:*` 和 `zod: 4.4.3`。没有更换协议、修改公共 schema 或另造生命周期。

主线可继续使用原约定：`RunnerLink` 的 `producer`、`payloads`、`beforeNativeWrite`；原生 entry 为 `codex-native`，eagerPrepare 只做 metadata/policy，实际 begin 仍等待持久 policy。Native Driver 源码已稳定可消费，真实 UI/HTTP/验证交付验收由主线完成。

## 范围限制

实际模型的权限批准、业务澄清、运行中 steer 尚为 NOT_TESTED；它们的传输/身份和问答适配已通过 fixture。本包不是全 G2、断电、长时间 soak、跨机器恢复或任意项目安全沙箱认证。真实停止探针只覆盖正常 managed command 子进程，不外推为对抗性 daemonization 或任意脱离进程树的证明。旧协议 fixture 类 `CodexNativeDriver` 不作为真实 MVP 的生产入口；生产入口为 `CodexProductDriver`。
