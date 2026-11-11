# WP-16/0032：第九轮 D 全进程一致性、私有目标材料与托管安装

日期2026-11-11；基线`50c3471`，合并main`e4095b9`，本轮source `b295504`。仅`apps/launcher/`、`tools/distribution/`、`packages/portability/`。真实模型0；七组用户服务5180/8796至5186/8802未启停。

## 1. 闭合的阻断

1. **孤儿资源**：`upgrade/recover/rollback`原先只判`record.pid`。现在`accountRegisteredResources`同时核launcher、API子进程、console listener、journal spawn与全部子孙；launcher已死而API活时复用`verifyCoordinatorProcess`证明后停止。活但无法证明属本config/data/target身份的进程记为`unknown_live_resource`阻断，不以“过滤掉不匹配者”得到空proven集合。路径按canonical/realpath与整段token匹配（拒绝共享前缀的兄弟目录），`ps stat=Z`的僵尸不算writer。
2. **spawn/cleanup身份**：spawn后、health前立即把`{pid, processStart}`写入journal（status `starting`）；崩溃/缺记录恢复时按持久化树停止，不相信空候选。`target_record_missing`现在是真实窗口：仅经升级fault注入`PA_SUPPRESS_INSTANCE_RECORD=1`抑制record，target仍health成功，随后证明停止并回退。新增`target_coordinator_exit`在health后停树。`confirmed`/`binary_rolled_back`/`reverted*`为可再用终态；未结算journal在planning前以`upgrade_recover_required`拒绝重入；doctor对`target_stop_unproven`给出唯一`pa upgrade --recover`。
3. **私有目标材料**：`PortabilityRecoveryTargetMaterializer`实现共享端口`prepare/read/discardStaging`。可信private parent由构造时固定（绝对路径、0700、当前用户、非symlink），调用方不能传任意父目录；严格校验`recovery-activation-commit/1`（含receipt command绑定）、项目映射唯一、目标root=parent/activationId且不覆盖源state。创建仅含`recovery-target.json`的0700目标，不建DB、不复制queue/native session/凭据；读回校验owner/mode/`nlink==1`/摘要；重复prepare幂等；篡改、符号链接目录、硬链接manifest、权限/身份漂移全拒绝；`discardStaging`只删证明属该activation的manifest-only staging，已初始化target拒绝删除。`startupAvailable`恒false且不启动任何进程。
4. **安装物与E交付**：从clean推送head `b295504`构建并冻结schema15 target（build `5db9a0d41924a4c6`，sha256 `eaf054…3d364`，6658文件），保留baseline `7e8f6ce6`与旧wave-06/08 tar。D复跑：launcher 56、portability 48、smoke 52、managed binary windows 17/17、schema-change E recipe 9/9、target material recipe PASS（inventory SKIPPED并注明A reader未进main）。

## 2. 实测边界

`R`：17段托管recipe含A/B/C/E1–E12；`C`：schema13→15迁移在target首次start发生，业务行保留、旧二进制对schema15精确拒绝无record、重新切换兼容target健康；`I`：tar+sha256+source+build+schema；`A`：仅D材料准备本身，**无**启动授权。

不声称：激活/启动（main未实现commit/start）、A只读inventory完成（本轮缺席）、personal计费/原生执行、跨平台/ABI、逐步SIGKILL。

## 3. 下一consumer

- **main**：组合`PortabilityRecoveryTargetMaterializer`与A的`RecoveryTargetInventoryReader`；激活前自行重读source事实/receipt/资源/字节，材料或空表不构成授权。
- **A**：交付真实只读`inspect(stateRoot)`（不迁移/不创建），覆盖部分写入、busy/links、schema兼容。
- **E**：按`tools/distribution/recipes/wave09-e-target-upgrade.zh-CN.md`用自己的root跑两份tar；托管升级/恢复/回滚与两次start必须区分。
