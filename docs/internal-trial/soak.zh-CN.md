# 有限运行观察（600 秒 / 1800 秒）

`trial-soak` 运行**一次有限 fixture 场景**：本进程 loopback fixture 提供 readiness 与 SSE，客户端做轮询、SSE 订阅/重连、受控“客户端重开”和资源采样。它不是 daemon，不碰个人 state，不调用模型/原生 CLI，也不从网页重开推断 daemon 恢复。

## wave-26 补充

既有 600/1800 秒原始运行保留，不因 parser/报告修补重跑 40 分钟。wave-26 只增加两个短的有界复验：60 秒 mixed normal 与 30 秒 mixed truncate（主动断流），用于 HTTP 失败/重连/资源归还的新风险；两者 `run-check` 均 `CONSISTENT`。没有显式自有产品目标时，真实产品 readonly/SSE 观察标 `NOT_REACHED`，不读取用户十二服务补样。

## 两个实际场景

| 场景 | 时长 | 负载 | 断流策略 |
| --- | --- | --- | --- |
| baseline | 600 s | poll 1 s、SSE 事件 1 s、客户端重开 60 s、采样 2 s | 正常流 |
| churn | 1800 s | poll 3 s、SSE 事件 2 s、客户端重开 180 s、采样 3 s | fixture 主动在 3 个事件后断开（`--failure-mode truncate`），观察重连与失败计数 |

两个场景**分开**报告：不能用一个场景的样本补另一个，也不能把 1800 s 说成 48 h。

## 命令

```bash
# 600 s baseline
node tools/trial-kit/bin/trial-soak.mjs --scenario mixed --duration-seconds 600 \
  --poll-ms 1000 --poll-timeout-ms 500 --sse-interval-ms 1000 --sse-idle-timeout-ms 5000 \
  --reconnect-backoff-ms 250 --reopen-seconds 60 --sample-ms 2000 --max-errors 50 \
  --failure-mode none --out <全新目录>

# 1800 s churn（主动断流）
node tools/trial-kit/bin/trial-soak.mjs --scenario mixed --duration-seconds 1800 \
  --poll-ms 3000 --poll-timeout-ms 1000 --sse-interval-ms 2000 --sse-idle-timeout-ms 8000 \
  --reconnect-backoff-ms 500 --reopen-seconds 180 --sample-ms 3000 --max-errors 100000 \
  --failure-mode truncate --out <全新目录>
```

每个场景都写：

- `run.json`：实际 `startedAt/endedAt/wallElapsedSeconds`、`requestedDurationSeconds`、`stoppedBy`、请求/事件/重连/重开/失败计数、延迟分位、cleanup、unknowns、resume；
- `samples.ndjson`：资源时间序列（rss/heap/external/event-loop p99/计数）；
- `resume.txt`：续跑命令（替换输出目录即可）。

## 怎么读结果

- `COMPLETED`：到达请求时长、0 失败、fixture socket 全部归还；
- `COMPLETED_WITH_OBSERVED_DEFECT`：这是负向控制，预期缺陷被观察到（例如主动断流导致的 disconnect/reconnect），不代表产品故障；
- `COMPLETED_WITH_FAILURES`：正向场景出现失败，按 `failures.counts` 归因；
- `INTERRUPTED`：被信号或提前停止，按实际 elapsed 报告，绝不补写成满时长；
- `DEADLINE`：总 deadline（时长 + 30 s 余量）触发，说明收尾没有在界内完成。

## 明确不声称

- 不声称 24 h/48 h soak、长期稳定性、内存无泄漏；
- 不声称 daemon 恢复、协调器/SIGKILL 恢复、provider/队列稳定；
- 不声称网页重开等于后端恢复；
- 不把 fixture 延迟/错误当作产品 SLA；
- 不做 live 生命周期或任何进程信号。

## 续跑与并行

长场景可以在后台运行，同时做独立文档/诊断工作，但要**观察完成或准确记录中断**；不要堆叠多个无界后台作业。续跑使用 `resume.txt` 的同一组参数和新的输出目录。
