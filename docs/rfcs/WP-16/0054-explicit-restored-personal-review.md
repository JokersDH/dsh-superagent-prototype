# 0054：恢复personal历史项目的显式只读启动

2026-11-13，基于main2208899/9856124。本检查点提供真实本地CLI消费者，解决缺旧项目注册时恢复personal审阅返回403的明确入口；不是HTTP自动授权、执行重绑定或target激活，没有新迁移/ledger/执行生命周期。

## 操作与产品范围

恢复完成后由当前本机操作者显式选择历史projectId和允许路径，生成私有启动配置：

```sh
node tools/dev/review-restored.mjs --state /absolute/restored-state --project historical-project --allow-path src/ --output /absolute/new-review.json
node tools/dev/workbench.mjs --discussion-only --state /absolute/restored-state --port 5192 --api-port 8808 --review-restored-scope /absolute/new-review.json
```

端口只是示例，使用者应选择空闲端口；本检查点没有创建5192/8808或改变十二旧实例。项目ID从恢复数据/此前记录取得，不是任意仓库路径。`--allow-path`可重复；`--exclude-path`默认.git。命令目前一次选一个项目，内部schema最多20项，为后续实际表单留有限输入，不代表已交多项目UI。

生成命令仅接当前schema且完整的恢复DB，验证marker/完整logicalSource与项目实际存在，读取原数据，写一个尚不存在的600私有配置。它使用当前根的私有action key（必要时沿原localCredentials创建），不写业务DB/queue/marker，也不读取仓库文件、执行器或模型。旧版本数据库需要先经过已验证的升级流程，此工具不自动迁移旧schema。

配置只有显式`--review-restored-scope`传入恢复personal启动才加载；不扫描备份或自动寻找文件。正常启动、fixture启动不能用这份选项。未传时已有行为保留，历史settings/registry不因本检查点获得隐式新权限。

## 绑定与失效

配置HMAC绑定current root/principal、restore marker digest、完整source fingerprint和本机host/platform/arch/UID摘要，scope无externalActions、访问只能historical_data_read_only，startupAvailable=false。加载时必须是private owned regular file，NOFOLLOW/NONBLOCK+fstat拒绝symlink/FIFO/设备、不读取超过128KiB文件。

五分钟是**启动配置的使用窗口**，检查created/expires及当前source/marker/root/principal/key/机器；当前进程获准审阅至停止，不宣称五分钟后自动清除内存授权。后续重开须按当时数据重新准备，旧writer登记/源变化会使旧文件失效。复制文件/旧action key或backup不是跨根/跨机器授权；重建新根key、显式执行命令仍需重新验证。

加载在writer lock之前复核选定Store实际父目录与state root，并将选定project投影为discussionOnly、显式Scope。旧文件内容不能变成命令或profile，源记录的原principal和artifact校验仍由原reader核对。它不复制旧项目settings/路径、凭据或执行grant，也不表示历史writer已停止。

## 实际消费者

`demo.ts`保留personal标识、恢复只读模式、无provider/旧queue启动。`workbench.mjs`将显式文件参数传入同一实际entry，配置正常投影至原网页；没有新增恢复授权UI表单，也没有改D launcher的CLI，D下一包负责接该已交entry。

候选GET仍`untrusted_data/authorization=none/executable=false`；原上下文history/frozen sources通过原principal/Scope/receipt/artifact读验。candidate prepare/confirm、chat/context send、work/answer/stop等业务POST继续被恢复只读guard拒绝。source prepare/confirm仍只是已实现的源事实，不因这份读取选择获得private许可或target启动权。

## 验证

- 新11项：无DB业务变更、源/marker/签名/Scope变更、权限/symlink/FIFO、过期/foreign principal/root/key、未知项目/不安全路径/执行字段拒绝。
- 真实原SDK本机mock生成两次讨论/context结果→真实v1 snapshot→第二根恢复数据→实际personal子进程：未绑定候选403；CLI准备并重新启动后候选/history/frozen原文200，dispatchAllowed=false/profileIds空、业务准备422；provider请求仍原2次，held queue1、work0。无fixture-mode替代。
- 狭窄独立review发现FIFO阻塞后，已加NONBLOCK并以原同型复现确认即时forbidden；不再阻塞启动。其余签名/Scope/源/本机与不授权限路径未见实质问题。
- 新测试与原startup/source/snapshot组合最终按integration状态记录，product strict通过。没有UI改动/新真实模型/native调用，旧十二服务/数据/profile/tar/ledger未重启或迁移。

主要入口：`apps/coordinator/product/restored-review.ts`、`tools/dev/review-restored.mjs`、实际demo/workbench组合和`tests/integration/restored-personal-review.case.mjs`。后续A/C/D/E直接消费CLI与实际personal进程，不再列为缺入口；持久UI授权、撤销/多会话管理、业务恢复/private许可/target继续分开实施。
