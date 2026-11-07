# 05 稳定性、运行与发布

本章的数值是拟议验收预算，须在 G0 固定硬件/负载后校准；不是已有性能承诺。依赖锁与官方依据见 [09](09-technology-and-evidence.zh-CN.md)。

## 1. 失效模型

首版按单机单用户设计，但将 UI、coordinator、Runner、原生进程和外部服务视为会独立失败的主体。SQLite 提交成功不等于外部执行成功；coordinator 退出不等于 Runner 退出；原生 turn 结束不等于所有工具停止。

| 故障窗口 | 可知事实 | 正确恢复 |
| --- | --- | --- |
| 事务提交前进程退出 | 无受理 receipt | 相同 commandId 重发，不能半接单 |
| 提交后 effect 尚未运行 | receipt/effect 均存在 | 正常重取 effect |
| 启动原生前已准备、未发送 | 可证明 not_sent | 同 key 安全继续 |
| 写出 begin 后丢回执 | 可能已执行 | indeterminate，先只读 reconcile |
| native 问题收到，UI 尚未通知 | 问题 durable fact 存在 | 重建问题投影，不依赖通知送达 |
| 回答写出后断线 | 答案已记录，消费不明 | 不跨连接重用 RPC ID、不自动重放权限 |
| core stopped 后 cancel 未送达 | 授权撤回，writer 可能仍活 | 停止中，重试安全 cancel/核对 |
| 验证执行中出现新输入 | 原 generation 失效 | 丢弃完成提案，重新冻结验证 |
| 文件写成但 DB 未引用 | orphan 文件 | 宽限期 GC；不误删活跃文件 |
| DB commit 后 UI 掉线 | 状态已接受 | snapshot/SSE 恢复，不二次创建工作 |

这些场景均有故障注入用例。不能只测 happy path 后宣称可靠。

## 2. 单 writer、锁与事务

coordinator 独占产品 state directory 和数据库 writer lease。CLI/Runner 通过 IPC/HTTP 通信，不能旁路写 SQLite。第二实例启动应明确指向已有实例或报告 state_in_use；锁文件路径与实际 DB path canonicalize 后一致。

文件锁超时不是 writer 已死的证明。结合进程启动身份、持有 nonce、DB 与监听实例核对；PID 单独可被复用。NFS、同步盘、网络文件系统不作为支持的 state directory。项目代码可另放位置，状态库应本机持久磁盘。

数据库一份连接写，PRAGMA 配置、外键、busy budget、WAL/checkpoint 与 backup 行为在启动自检里记录。拟锁 better-sqlite3 13.0.3、Node 24.22.2；发行入场检查实际 `sqlite_version()` ≥3.51.3 及已知修复清单。版本阈值不是完整缺陷证明；出现新缺陷时提高 admission 要求。

同步 DB 操作保持短小，事务内不 await；外部 I/O 经提交后 effect。不要跨两个独立 DB 宣称原子性。nested savepoint、rollback、afterCommit、同事务队列和 receipt 必须在真实 binding 上测试。

## 3. 外部投递与重试

本地队列保证的是有记录、可重取，不保证原生副作用 exactly-once。四种发送状态保持独立：not_sent、written、native_accepted、indeterminate。错误 code 和发送状态分开。

普通 read/notify 依据各自幂等性重试。launch、prompt、tool action 和权限 response 一旦 unknown，不落入原 Effects 的通用 throw/backoff 重发。原 effect 记录已分类并交给 reconcile；新 reconcile effect 不发送新业务。

退避带上限和 jitter，遵守有效 Retry-After。认证失败转需要登录，版本/配置失败转兼容核对，预算耗尽转需要用户行动。无明确结果时不循环付费重试。

effect key、factId、commandId、native binding、generation 都有不同用途；不能用其中一个全局字符串代替所有身份。

## 4. 取消、崩溃和恢复

用户 stop 在本地事务内撤销 core 授权，排优先取消。控制通道不与长模型调用共用串行等待锁。优先级：cancel/失效通知 > answer/关键 ACK > 业务 begin/deliver > progress。

恢复流程：

1. 获取协调器独占身份，读取未完成 bindings、effects、问题、revision transitions。
2. 逐资源核对 Runner、进程启动身份、native run/session、journal 与原生状态。
3. running 且仍授权：重新绑定、补关键事实；不重复 start。
4. terminal 且静止：按绑定导入事实，必要时由 core 走重试/结束。
5. missing 但无静止证据：保持 indeterminate；不能因为找不到连接就假设外部写消失。
6. stopped/旧 revision：仅做安全 cancel/reconcile，禁止继续业务输入。
7. 屏障成立后才启动新 writer；重建 UI 投影和通知。

Runner journal 只保存它实际收到的必要事实。没有原生 cursor 的事件缺口要明示；不能用完整性未知的 journal 宣称恢复全部历史。

spawned_process 可以操作本产品拥有的进程组；shared_service_session 只取消自己的会话。原生后台子工具若无法登记/控制，该 profile 不能声称支持可靠自动切换。

## 5. 有界负载与预算

初始测试基线建议：1 用户、2 项目、4 并发 attempts、每 attempt 100 progress/s 的合成峰值、关键事实突发 100 条；普通模型时延单独计算。G0 固定机器与压力脚本后调整。

建议入场预算：本地无模型写命令记录 p95 <250ms，停止命令本地记录 p95 <250ms，收到的 native 问题到可见投影 p95 <1s，控制 pump 排队 <500ms。原生取消最终时长不能伪造统一 SLA，报告每 Driver 的 deadline 和实际分布。

进度合并、队列深度、帧/消息大小、stdout/stderr ring、critical journal、磁盘水位和 SSE client backlog 都有硬上限。critical 容量不足时停止接受新业务并告警，不悄悄丢问题或权限。

预算分别限制并发、模型/工具调用、费用、wall time、磁盘和子进程。未知 token/费用记 unknown，不能当零。费用上限需要原生可控机制；平台事后观测不能承诺精确硬截断。

## 6. 工作区与验证隔离

每个写 attempt 使用受控 worktree/快照，并记录 base commit、用户 dirty diff、产物与环境。用户原工作区不可被强制 reset；共享 git index/元数据、hooks、submodule、ignored 文件和预览端口需要单独考虑。worktree 不是安全沙箱，也不隔离网络和远端写。

冻结验证前确认候选资源不再写。验证命令和环境与合同关联，在 scratch 中执行允许的检查，不使用 worker 自述的“测试已通过”。合并到用户分支/发布到外部系统属于独立显式动作；默认交付 patch/branch 与证据，不自动 merge/deploy。

若旧 writer 无法确认停止，新副本仅在原生限制实际有效时允许只读/patch-only；外部服务更新不得重复执行。预览服务需要绑定 attempt、端口和 ownership，结束清理可独立核对。

## 7. 配置漂移与账号

profile、二进制、Driver、wire/schema、SDK、native config、权限和 policy snapshot 形成兼容身份。DSH HMR 或同路径二进制替换均可使 PreparedExecutionPolicy 失效；不仅监听版本号。

默认配置冻结或可观测 watch；无法核对的配置标 unverified，不满足要求原生约束的任务不能 begin。变更先暂停业务输入、核对或重新准备，不在活动 attempt 内静默扩权。

厂商登录使用原生官方流程。产品记录 credential reference 和认证状态，不读取、复制桌面私有 token。专用 home bootstrap 不能 reset 用户 profile。认证失败保持已接工作与问题，展示具体恢复入口。

## 8. 本地安全与诊断

默认 loopback、本地认证、Host/Origin 校验、写请求防 CSRF。绝对文件路径、artifact 下载、诊断导出都经受控 ID 解析，禁止任意路径读写和符号链接逃逸。远程访问不属于首版。

日志包含 command/work/ticket/assignment/attempt/fact/effect IDs、release、Driver 与 schema 版本、错误和证据引用。raw protocol 默认关闭；普通日志排除 token、MCP headers、完整 prompt/context 和账号配置。项目内容也可能敏感，导出先选择范围并提供脱敏预览。

health 分 readiness 与 liveness；数据库不可写、critical journal 满、无法完成必要取消等分别报告。观测至少含队列年龄、unknown dispatch 数、未静止 writer、问题等待、取消耗时、恢复结果、验证失败及磁盘量。告警不自动上传用户材料。

## 9. 备份、保留与迁移

使用 SQLite 官方 backup 机制/等价一致快照，不在运行中只复制 `.db` 丢掉 WAL。备份包含 schema/release manifest、被引用的 artifact 文件和必要 journal；密钥仍由原系统管理。恢复到新 state directory，运行 integrity/foreign_key 检查，再以 reconcile 模式打开；不能立即重发旧业务。

迁移前停止新受理、drain 或停止活动 writer、备份并检查空间。只由 storage owner 持有连续 migration 序号。迁移需要校验 checksum、事务/断点语义和新旧兼容矩阵；不得多个 agent 竞争编辑同一迁移。

应用旧二进制不一定能读取新 schema。破坏性迁移的回滚使用已验证备份；若升级后产生新工作数据，必须先导出/核对，不能用旧备份覆盖后声称无损。artifact GC 遵守引用、活跃任务和备份保留，明确删除会失去哪些重放能力。

## 10. 打包与升级

首发 macOS arm64，x64 通过同等 native-load/恢复测试后启用；其他 OS 为后续支持。Node 与 binding 的组合锁定到 release manifest，原生 prebuild 存在不等于当前发行包已能加载。

Driver 可以独立发版，但只加载产品随包审计和锁定的本地 Driver；不做运行时任意 npm 远程插件。profile 更新和 Driver 升级分别测试，SDK minor 变化也需重新跑受影响 conformance。不能把升级原生 agent 当作自动无风险修复。

CLI 安装产生清晰 state path；`pa doctor` 输出身份、能力、配置漂移、恢复建议，避免含糊“已连接”。后台启动首期显式 `pa start`；launchd 自动启动作为 release 包功能，卸载只移除本产品登记项，不删用户项目和原生 agent 数据。

## 11. 运行手册

| 现象 | 排查与处理 |
| --- | --- |
| 一直停止中 | 查看资源证据；重试安全取消/核对，不能先点“重建”重复外部写 |
| 问题已答但 agent 不动 | 查看逐 target written/applied/unknown；检查当前连接绑定与原生状态 |
| 模型不可用 | 查询/回答/停止仍可用；任务保留，Reasoner 故障不瘫痪控制入口 |
| 登录过期 | 打开该产品原生登录流程，刷新 profile 检查，不复制 token |
| 配置突然不兼容 | 比对 fingerprint/Driver/schema；暂停 begin，恢复已锁配置或重新验收 |
| DB busy/损坏 | 停新受理、保存诊断、核查独占 writer；从验证备份恢复到新路径 |
| 磁盘不足 | 阻止新业务，保留关键事实预算；按引用清理，不删除活动 journal |
| SSE 无进度 | snapshot 核实；cursor_expired 重载；不因此重启原生任务 |

对应验收 REL-01..REL-12、OPS-01..OPS-06 和 RT-01..RT-10。所有实际报告须区分 fixture、fault injection、native smoke 和真实日常使用证据。
