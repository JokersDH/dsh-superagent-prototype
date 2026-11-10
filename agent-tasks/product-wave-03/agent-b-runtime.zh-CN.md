# Agent B：真实原生控制、问题与恢复闭合

继续 `/Users/hh/Desktop/joker/superagent-agent-b` / `codex/g1-runtime`，保留修改、候选与旧任务账本，合并最新 main。读取 AGENTS、START-HERE、product-spec/README、本轮 README 与 0012 集成记录。基线 `c3f018e` 的环境产品已可用，旧 B-R4 的“接线未发布”不再是当前阻断。

本轮拥有 `apps/runner/`、`packages/drivers/codex-native/`、`packages/driver-kit/`、`packages/testing/` 和 `tests/native-acceptance/`。主线暂停这些源码并发编辑，负责 contracts、application/questions、coordinator/HTTP/console 和 root lock。E 的 `tests/product-acceptance/` 不在你的范围。

## B1 稳定控制 interface 和准入事实

审计当前 policy/begin/answer/cancel/recovery、进程库存、Journal 与 payload 路径；保留已有被验收语义。把必须的当前绑定、原生能力、失败/未知状态及 coordinator 需要的 port 一次写 RFC，公共 schema 由主线维护。避免先为第二执行器重建整套框架。

先交可供主线消费的 interface/受控纵向检查点，包含真实可失败的 harness 自测、严格退出和预算记账；一个 case 在所有必要断言后才能结束，合法业务拒绝与 schema 400 分开。提交后继续 B2–B5，不逐修复等待批准。

## B2 活动写进程的准确停止

先在 controlled fixture 完成长期写入/正常后代/忽略 TERM/输出限额/身份缺失/观察失败的矩阵，再对真实 native 做有界证明。已收到 ACK、leader 退出、UI phase 改变或监听端口数不代表所有 writer 已停止；只有可信资源清单和实际组静止才能释放。

真实场景先证明工作区写入/heartbeat 与 PID/启动身份，再通过产品 stop，观察正确进程及正常后代、写入和屏障结果。准备授权等待、中途 installer、已关闭 admission、旧 attempt/epoch 和迟到答案都不能重新开写。未知归属/脱离进程树能力如未证明，要保留 indeterminate，不扩大所声称覆盖范围。

## B3 原生问题、答案与输入控制

完整覆盖业务澄清、权限选项、拒绝、取消/延后、过期、同 RPC ID 的不同 attempt、connection/contract 改变、答案重放及部分 target。回答先持久、response_written 和 native_applied 区别必须保留；权限逐请求，不能按文本相似复用。

运行中补充仅通过当前授权输入，原生不支持时明确拒绝/降级；不能用发送文本冒充已生效。默认 policy 未触发问题不记 native PASS；隔离逐次确认 variant 的通过必须写明 variant，不外推默认配置。所有自动回答仅针对本次私有测试里已授权的无害工作区动作。

## B4 故障恢复与能力证明

测试 coordinator 在开始前、真实运行中、问题/答案投递窗口和完成后故障；只 SIGKILL 自己启动的进程，在同 state 重开。未知发送先核对，取消重用持久 control ID，不用新 ID 偷重跑。分别报告安全性（无第二 begin/writer/过期答案）和可恢复性（允许的继续/停止/重试与物理结果）；永远卡住不算恢复完成。

以同一 Driver/Runner 公开 interface 建立适用的 conformance，不把 profile 元数据检查当生命周期证明。原生版本/config/policy/OS、实际 observed 能力及明确不支持矩阵可供主线 UI 消费。catalog 的 inspection 与 native-test admission 分开；原生版本变化不能继承旧准入。

## B5 跨产品回归与交接

消费主线已提交的公共接线，用真实私有项目补交付/机器 FAIL/候选失效/停止/重开证据，保留原项目/HEAD/index；E 仍独立验产品，不改 E 的期望或生产 UI 让测试变绿。完成包内 Runtime、protocol、Journal、physical ownership 和严格报告回归，给主线最小缺陷复现与下一步。

交 branch/commit/base、owned paths、actual/fixture/readonly/NOT_TESTED、版本与实际命令、模型账本和证据。自有 `reports/execution-status.json` 记录每阶段及剩余项，不能以旧 final 文件掩盖新门槛；只 push 自己分支。

## 明确模型预算与备用工作

默认自测/受控回归 0 模型。**用户下发本新功能包后，最多 4 个显式 `--run-native` 小任务**：优先分别用于真实活动停止、原生问题/权限、coordinator 故障和必要的真实失败/交付缺口。尽量在同一实体中覆盖更多断言，不能按 case 数计任务。历史轮次的已用账本保留，此新包额度不因重启/日期/重试再次增长；不确定是否发送也要记账核对。

额度用完继续全部零模型工作，未触发/不支持的 native 分支 NOT_TESTED，不无限重跑或换账号/模型/全局配置。用户 5180/8796、5181/8797 服务及真实仓库不作为故障场地。遇主线接口阻断先交 RFC/复现，继续 controlled、protocol、进程和报告负例；全部可执行阶段完成或只剩具体外部阻断时统一交接。
