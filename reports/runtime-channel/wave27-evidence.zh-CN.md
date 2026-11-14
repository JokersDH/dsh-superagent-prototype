# wave-27 / I 证据报告：具体 CoordinatorChannel

2026-11-14。实现与文档在 `apps/runner/src/attach-channel/`、`apps/runner/test/attach-channel/`、`docs/runtime-channel/`；状态文件 `reports/runtime-channel/wave27-status.json`。所有权之外的文件（contracts/root/runner-service/RunnerLinkClient/routes/B 生命周期）**零修改**。

## 1. 五个完整结果

| 结果 | 内容 | 实际证据 | 未达 |
| --- | --- | --- | --- |
| I4（4 阶段） | 具体三回调 module：`recordFact`/`readPayload`/`beforeNativeWrite` + constructor/bind/lease | `three-callbacks.test.ts` 11/11；strict `tsc` 0 错误 | 未证明同 Runner 进程 |
| I8（8 阶段） | 同 controller 从 client A→B 的真实三回调（durable sink 双写、immutable payload 重读、fresh guard 复核） | `rebind.test.ts` 7/7（含三回调合一的集成场景） | 非 A 真实持久化；非 B 进程 |
| I12（12 阶段） | B 去旧管道的接入面与删除清单 | `adapter.ts` + `docs/runtime-channel/b-adapter-handoff.zh-CN.md`（精确行号替换点、关闭顺序、回归输入） | **B 真实接入与三 map 删除 NOT_REACHED** |
| I16（16 阶段） | 故障/容量/晚到/关闭矩阵 + direct strict | `faults.test.ts` 14/14；`tsc -p apps/runner/src/attach-channel/tsconfig.json` exit 0 | quiescence/native/vendor 未测 |
| I20（20 阶段） | 兼容、独立 consumer、操作文档、状态交接 | `compatibility.test.ts` 4/4、`independent-consumer.test.ts` 2/2、三份文档 | 独立复现≠产品准入 |

合计 **44 个 node:test 用例全绿**（11+6+7+14+4+2），共享接口回归 `packages/contracts/test/coordinator-channel.case.ts` 5/5 仍绿。

## 2. 命令与退出码

```bash
node_modules/.bin/tsc -p apps/runner/src/attach-channel/tsconfig.json      # exit 0（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes）
cd apps/runner && node --test test/attach-channel/*.test.ts                # exit 0, tests 44 / pass 44 / fail 0, 171ms
node --test packages/contracts/test/coordinator-channel.case.ts            # exit 0, tests 5 / pass 5
```

无 sleep、无轮询、无真实网络、无模型/原生调用：所有 deadline 由注入时钟推进。

## 3. 模块边界与关键不变量（已验证）

- 构造时冻结完整 producer；请求身份一律与**登记**比较，绝不以请求自报身份为准（开发中此处的真实缺陷被 `foreign source`/`foreign attempt` 用例捕获并修复）。
- generation：首次 `0→1`，CAS 单调；失败不动当前 lease；替换原子失效旧 lease；安全整数上界拒绝。
- facts：跨重绑用原 `factId`+原 body 重发，deadline 不刷新；冲突 body 通过 coordinator `ack-failed` 拒绝。
- payloads：跨重绑重读**同一引用**、同一 correlation id；超 byte 上限 `capacity` 拒绝且释放 pending。
- writes：每次意图一次 fresh guard；断连/替换/模块关闭 → `indeterminate`；旧 allowed 不能复用；拒绝是 `NativeWriteDenied` 而非超时。
- 结算：timeout/reply、close/reply、send 失败/同步 reply 竞争下最多结算一次；迟到回执返回 `false`。
- 容量：三类 pending 数、总 bytes、单 payload bytes 在**发送前**拒绝；被拒请求不触达 transport。
- 错误与诊断只含有限 ID/状态与稳定 `reason`；用例断言错误文本不含 payload 值、绝对路径、私有 material。
- 关闭语义区分 lease（旧 lease no-op；当前 lease 只拒未决 write）与 module（全部 pending/timer 终止、后续请求与 bind 拒绝）。

## 4. 明确未达 / 不作外推

- **B 真实接入 NOT_REACHED**：`apps/runner/src/runner-service.ts` 仍保留 `factWaiters`/`payloadWaiters`/`writeWaiters`（15 处引用）。I12 不标 PASS，仅交付可编译适配器、精确替换点与回归项。
- 未证明：同 Runner 进程双 client、coordinator SIGKILL 后原问题→交付、跨 coordinator 崩溃恢复、durable exactly-once、物理 writer quiescence。
- 测试中的 `DurableSink` 只是**幂等语义 double**（同 id 重放同 receipt、冲突拒绝），不代表 A 的真实持久化 ingress；`ImmutablePayloads`/`FreshGuard` 同理。
- H 的独立复现样例由 I 在自己的测试目录提供；H 在其自身目录的独立执行尚未发生。

## 5. 预算与保留资源

- 自动真实 vendor/model/native 调用：**0**。无新 Driver/CAC/桌面/autoaccept/第二生命周期/DB/账本/server。
- 未启动、未 signal、未停止任何用户进程；十二服务 5180/8796–5191/8807 与全部 data/profile/tar/ledger/B/C/E dirty 未触碰。
- 仅新增四个 owned 路径下的文件；`git status` 显示三处 untracked 目录即全部改动（状态文件随后单独提交）。

## 6. 对 main / B / H 的直接输入

- main：模块已实现且符合 0068 小接口；不需要修改 contracts。若需新增失败类语义，另提最小 RFC。
- B：按 `b-adapter-handoff.zh-CN.md` 的表格替换三处注册 + 四个收帧分支，删除三张 map，再跑原正常链与重绑回归。
- H：按 `h-independent-consumer.zh-CN.md` 复制自包含 consumer；发现缺陷先判归属（模块 / B 接线 / 共享接口）。
