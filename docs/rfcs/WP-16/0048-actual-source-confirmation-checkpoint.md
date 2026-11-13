# 0048：实际恢复源确认消费者

2026-11-13。主线在697efdc实际inspect/prepare与1169535候选工作台上补齐source确认，不把本轮A/C/D/E缺少这个入口当作整包失败。仅记录恢复源意图，始终`authorization=not_granted/startupAvailable=false`；没有target materialize、数据库创建、私有启动许可、Runner或旧queue消费。

后续6050b4b额外核对当前打开数据库的真实父目录与配置source root一致，拒绝目录替代。最终新测试14项、clean恢复/候选/提案106项通过；下文13/105等早期数字保留对应e32检查点范围。新运行source为6050b4b，无需为了文档更新重启任何旧实例。

## 实际接口

- `POST /v1/recovery/source/prepare`：严格JSON `{preflight:{expectedFingerprint,bindings},targetStateRoot}`。服务端重做现有只读项目/Git/当前executor/artifact预检，要求完整逻辑源、可验证marker和无材料/扫描阻断。历史资源待新核对可继续记录意图，但不会获得物理停止或启动证明。
- 返回`recovery-source-prepared/1`：原plan、从其实际绑定构造的configuration、服务端生成的intent与HMAC token；无凭据。target必须是private parent下尚不存在、与历史源不相交的目录。服务端规范化真实parent，确认时再次核对；准备不会创建target。
- `POST /v1/recovery/source/confirm`：只接`{token}`，不接caller intent/actor/host/resource digest。核对原principal/state、签名、五分钟期限、当前完整源、marker、本机与隔离policy以及项目/executor预检，沿现有`RecoveryIntentCommitter`和A `recoveryActivations`落fact/event/receipt。
- 原`GET /v1/recovery/activations/:id`可审计已记录结果，永远不授启动权。generic`/v1/recovery/commit`和target启动仍不可用；旧inspect/plan的`commitAvailable=false`指执行授权未开放，不冒充源事实确认不存在。

两条新POST均在既有认证/精确Origin/JSON/体积上限之后，仅在recovery_readonly模式作为精确例外；普通业务命令仍被拒绝。normal模式不会提供恢复源确认。当前网页未增加恢复确认表单，老十二实例没有重启或更新。

## 原事实与同事务复核

prepare不写DB、marker、registry或队列。confirm的当前source检查在原source UoW内执行，A事实与原command event/receipt同事务。新增同步postguard在receipt形成后使用A `ignoreCommitted`，只排除这一笔核实过的事实、原回执与两个精确event以及固定heartbeat。其余未记录event的queue/业务变化也会拒绝并回滚整笔source事务。

postguard也通过原UoW同步检查，普通函数返回Promise同样拒绝并观察rejection，不能在guard未完成时提交。事务参与者失败不会遗留确认事实或回执。

丢响应以原token/原command和相同认证渠道核对，已提交的原receipt在过期、后续源变化或runtime/进程重开后仍返回一次原事实，不重新预检授权或开始工作。local_ui/local_cli是原不可变actor的一部分，跨认证渠道confirm重放会保持原冲突语义；原audit GET仍可读取。

## 主机与policy的准确含义

machineDigest由当前私有action key对hostname/platform/arch/UID做HMAC，原始主机标识不公开。它是本次源确认的本机绑定，不是可搬运grant。resourcePolicyDigest绑定当前“旧queues held、新empty state、启动另需私有许可及完整当前物理资源”的隔离约束和本机executor身份；它不证明任何writer已停止。

后续target preparation/activation仍必须重读source receipt、当前源/marker、material/config/empty DB、机器/profile和完整physical resources，并消费main私有许可。此检查点没有启用这些后续能力，也没有把A新snapshot兼容或D新停止实现整包接入。

## 验证

- 实际HTTP/runtime/A18 source确认13项通过：只读prepare、原事实/receipt/audit、无target/业务、来源/marker/profile/target/expiry变化、严格DTO/auth/Origin/media、正常模式拒绝、事务外写和receipt故障全回滚。
- 两项独立产品进程SIGKILL覆盖source事务commit前/后，真实SQLite重开后原command恰一fact/receipt，原held queue保留，target不存在。测试用私有合成数据和可信只读executor fixture，无厂商发送。
- 新模块与原recovery intent、preflight、logical source、target/audit/restored-startup组合先82项PASS，新增两项进程验证另PASS；后续clean checkpoint复验按独立报告记录，不累加重复用例。
- 原contracts230、product/http strict、generated检查通过；冻结Runner/data wire hash保持`74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。数据库schema仍18，没有迁移/新ledger/执行生命周期。
- 狭窄独立review指出的postguard thenable问题已复现并修正，同型回归验证无fact/receipt/event遗留；未发现其他实质问题。旧用户服务、profile、tar与预算不变，真实model/native0。

主要源码：`apps/coordinator/product/recovery-source-confirmation.ts`，`recovery-intents.ts`、runtime/HTTP组合及`packages/contracts/src/recovery-source-confirmation.ts`。A/E下一包直接消费这两个真实入口，source确认不再列为入口未到；私有许可、业务恢复、目标启动和installed release继续分层验收。
