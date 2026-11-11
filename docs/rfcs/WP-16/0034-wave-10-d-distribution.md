# WP-16/0034：第十轮 D 操作级进程归属、共享目标材料与普通个人安装

日期2026-11-11；基线`25e5643`，合并main`104f17e`（含`32fc7ae` context/evidence UI与`677cf26` contracts）。仅`apps/launcher/`、`tools/distribution/`、`packages/portability/`。真实模型/native turn 0；八组用户实例未启停。

## 1. D1 操作级资源归属

- 共同install路径不再等于归属：`accountRegisteredResources`只把**本次private roots**（config/data/logs/cache/workspace，raw与realpath两种形式）作为身份；同安装不同state的进程不会被认领。
- `processStart`不符的PID不会被journal或全量扫描重新认领（`claimed`集合同时排除）；未知活进程保持unknown并阻断，不转空proven集合。
- 只读probe `tools/bootstrap/probe-wave10-distribution.mjs` 8/8 PASS：合法main DTO重复prepare、输出匹配shared schema、准确root绑定、配置digest复核、parent写前重校验、shared-install非跨state、journal start mismatch不可重入。
- stop类矩阵在只读证明通过、checkpoint推送后才运行：17/17 PASS。

## 2. D2/D3 共享Materializer与父目录生命周期

`PortabilityRecoveryTargetMaterializer` 直接满足shared port（异步prepare/read/discardStaging），输出严格`RecoveryTargetMaterialSchema`字段、**裸hex digest**、`stateRoot`来自confirmed `intent.target.stateRoot`且必须是trusted parent的准确子目录；`configurationDigest`按shared canonical重算并与confirmed比对，不符在写前拒绝。每次prepare/read/discard重新校验parent的realpath/dev/ino/owner/0700/no-symlink；写入使用临时文件+fsync+rename，half-write只清理本包temp；foreign内容拒绝；main用A公开Store在准确root初始化全新空schema后`read`仍可重放，`discardStaging`拒绝删除已初始化target。材料不自建SQL、不复制旧库/queue/session/凭据、`startupAvailable`恒false。

## 3. D4/D5 安装与消费者

- `verify-personal-install.mjs`：从当前source构建/冻结slice，冷启动、doctor gates、**personal模式零turn**启动（health/记录mode/access一致）、备份、只读恢复到新root、搬迁后doctor+启动。
- A `RecoveryTargetInventoryReader` 与main target commit/activate本轮仍未发布：材料recipe记录`INVENTORY_READER_UNAVAILABLE`，三个检查点（材料已准备/空schema完整/当前资源未授权）中最后一个保持blocked；不伪造inventory或activation。

## 4. 产物与限制

冻结tuple见`tools/distribution/reports/wave10/artifacts.json`；矩阵17/17、personal 7/7、schema-change E 9/9、材料recipe PASS。未测：跨平台/ABI、真实个人计费turn、逐步SIGKILL、A reader集成、main激活、E独立准入。历史tar/报告保留。
