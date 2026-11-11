# D：操作级资源归属、私有目标与个人安装整包

继续原`/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`，仅launcher/distribution/portability。读README/0033并合并最新main。25e5643已发布，但六个独立反例及shared port不兼容仍阻断。真实模型/native0，普通安装独立于恢复/研究。

## D1 先关闭进程误归属，早交只读证明

复跑main `probe-wave10-distribution.mjs <D> <E>`。共同install路径不能替代exact state/config/operation身份；同安装两个state只能停止本次目标。processStart不符的PID不得由journal或后续扫描重新认领。未知活进程保持unknown并阻断，不能过滤成空集合。

先给只读accounting正反例和源码checkpoint，main准入前不跑可能停止其他实例的全量矩阵。probe或测试只清理有本次spawn证明的进程，不pkill。

## D2 直接满足共享Materializer接口

实际implements RecoveryTargetMaterializer，prepare/read/discardStaging均按port异步契约，直接parse shared输入/输出，裸hex digest；核对确认的configurationDigest、准确target.stateRoot、activation/generation与trusted parent关系。拒绝应发生在创建错误材料前。用main合法DTO做消费者，不再只测本包sha256前缀格式。

材料准备不自授启动权，不复制旧DB/queue/session/凭据，也不自行写SQL。main可在准备后的准确root调用A公开Store初始化全新空schema，再交A reader；设计read/replay需容纳后续合法初始化，discardStaging绝不能删已初始化目标。

## D3 父目录生命周期、staging与失败重入

构造时检查不够；prepare/read/discard实际操作时重新绑定trusted parent/root inode/realpath/owner/private/link状态，覆盖parent被换symlink、hardlink、目录替换、half-write、重复同body与异body。清理只移除能证明归本activation的staging；有初始化库/运行身份时拒绝删除。中断记录与准确错误要可重放，不建与main竞争的activation状态机。

## D4 当前source普通个人安装和托管升级

先关闭D1，再用包含当前main context/evidence的干净source构建普通个人安装slice，给main最小可审阅代码/依赖清单。保留personal/fixture、准确profile/state/端口；配置迁移、冷启动/doctor、可迁移路径、备份/只读恢复、同schema rollback与跨schema拒绝分别测。

artifact source/build/schema/平台/ABI/sha/size必须来自真实字节。构建不等E最终verdict或恢复激活，不能把旧6830e38称含新32fc7ae；保留历史tar不改标签。main未集成的candidate与accepted-main source明确分开。

## D5 实际A/main消费者与崩溃恢复

消费A修复reader和main实际target消费者，测材料已准备/空schema完整/当前资源仍未授权三个检查点。main activate未交保持blocked，继续安装独立项；到达后覆盖pointer/spawn/record前后真实进程故障与SIGKILL，按operation/start身份清理。不能借新generation遗忘旧writer，不能切旧source库normal。

## D6 给E冻结字节和可复跑整包

交完整baseline/target tuple及最新ordinary-personal和restored-readonly两条配方；动态隔离端口，真正managed upgrade/--recover/rollback，旧schema开新库应拒绝。维护`tools/distribution/reports/wave10-status.json`，列known gaps、commands/results、main scope和E消费步骤。只push原分支，不提交root lock/改E断言；八组用户服务不动。
